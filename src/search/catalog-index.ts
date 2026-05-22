/**
 * Offline BM25 inverted-index for the Agora marketplace catalog.
 *
 * ## Why BM25?
 * BM25 (Best Match 25) is a probabilistic term-frequency / inverse-document-frequency
 * ranking function that handles two key issues with naive TF-IDF:
 *   1. Term-frequency saturation — a token appearing 100× in a doc is not 100× as
 *      relevant as one appearing once; BM25 saturates via (tf / (tf + k1*(1-b+b*dl/avgdl))).
 *   2. Document-length normalization — long documents naturally accumulate more term
 *      hits; the `b` parameter (0–1) penalizes them proportionally.
 *
 * ## Field weighting via token repetition
 * Rather than maintaining separate per-field inverted lists (which complicates the
 * index structure), we inflate the term-frequency bag at index time:
 *   - name token contributes ×3 to TF  (most signal: users search by name)
 *   - tags token contributes ×2         (curated semantic labels)
 *   - id token contributes ×2           (IDs are precise matches)
 *   - description/author/category ×1    (background context)
 *
 * This is equivalent to weighted field merging and requires zero extra complexity in
 * the scoring loop.
 *
 * ## Fully offline, zero dependencies
 * Matches Wave 1 "no external accounts / no network" constraint. The index is
 * rebuilt in-memory from the item list; it never persists to disk and needs no
 * embedding model or API key.
 */

export interface IndexableItem {
  id: string;
  name: string;
  description: string;
  author: string;
  category: string;
  tags: string[];
}

/** Per-document posting entry stored in the inverted list. */
interface Posting {
  id: string;
  tf: number; // weighted term frequency for this document
}

export interface CatalogIndex {
  /** postings[term] = array of {id, tf} for every doc containing that term */
  postings: Map<string, Posting[]>;
  /** df[term] = number of distinct documents containing that term */
  df: Map<string, number>;
  /** docLen[id] = sum of all weighted TF values for that document */
  docLen: Map<string, number>;
  /** average document length across all indexed documents */
  avgDocLen: number;
  /** total number of indexed documents */
  N: number;
}

// ── Stopwords ─────────────────────────────────────────────────────────────────

/**
 * Combined English stopwords + intent/filler words.
 * Intent words are stripped so that queries like
 * "find a tool that talks to postgres" reduce to their content terms.
 */
export const STOPWORDS: Set<string> = new Set([
  // English function words
  'the', 'a', 'an', 'to', 'of', 'for', 'and', 'or', 'with', 'that', 'this',
  'my', 'i', 'in', 'on', 'is', 'are', 'it', 'by', 'at', 'as', 'be', 'was',
  'has', 'have', 'not', 'its', 'from', 'into', 'than', 'but', 'about',
  // Intent / filler words common in natural-language queries
  'find', 'search', 'show', 'get', 'need', 'want', 'looking', 'something',
  'anything', 'tool', 'tools', 'thing', 'things', 'does', 'do', 'help',
  'please', 'can', 'give', 'use', 'using', 'used', 'like', 'also', 'which',
  'how', 'what', 'where', 'when', 'why', 'who', 'some', 'any', 'all',
  'talks', 'talk', 'connect', 'connects', 'access', 'accesses', 'let', 'lets',
  'work', 'works', 'support', 'supports'
]);

// ── Tokenizer ─────────────────────────────────────────────────────────────────

/**
 * Tokenize text for indexing or querying:
 *   - lowercase
 *   - split on non-alphanumeric runs
 *   - drop tokens shorter than 2 characters
 *   - drop STOPWORDS
 *
 * Deterministic: identical input always yields identical output.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

// ── Synonyms (query-side expansion only) ─────────────────────────────────────

/**
 * Developer-term synonym map. Applied ONLY during query tokenization, not at
 * index time, so documents are indexed verbatim (no spurious term inflation).
 *
 * When a query token matches a key, its synonyms are added as additional query
 * terms (deduped). This allows short aliases ("db", "k8s") to match their full
 * forms in document text.
 */
export const SYNONYMS: Record<string, string[]> = {
  db: ['database'],
  k8s: ['kubernetes'],
  k8: ['kubernetes'],
  postgres: ['postgresql', 'database'],
  pg: ['postgresql', 'database'],
  js: ['javascript'],
  ts: ['typescript'],
  ai: ['llm'],
  auth: ['authentication'],
  vcs: ['git'],
  ml: ['machine', 'learning'],
  api: ['integration'],
  cli: ['command'],
  ui: ['interface'],
  gh: ['github'],
  gl: ['gitlab'],
  aws: ['amazon'],
  gcp: ['google'],
  kv: ['cache'],
  nosql: ['database'],
  sql: ['database']
};

/**
 * Tokenize a query string and expand synonyms.
 * Returns a deduplicated array of tokens (original + synonym expansions).
 */
export function tokenizeQuery(text: string): string[] {
  const base = tokenize(text);
  const expanded = new Set<string>(base);
  for (const token of base) {
    const syns = SYNONYMS[token];
    if (syns) {
      for (const syn of syns) {
        expanded.add(syn);
      }
    }
  }
  return Array.from(expanded);
}

// ── Index builder ─────────────────────────────────────────────────────────────

/**
 * Build a BM25 inverted index from a list of indexable items.
 *
 * Field weighting is achieved by repeating tokens in the TF bag:
 *   name ×3, tags ×2, id ×2, description ×1, author ×1, category ×1
 */
export function buildIndex(items: IndexableItem[]): CatalogIndex {
  const postings: Map<string, Posting[]> = new Map();
  const df: Map<string, number> = new Map();
  const docLen: Map<string, number> = new Map();

  let totalLen = 0;

  for (const item of items) {
    // Build weighted TF bag for this document
    const tfBag: Map<string, number> = new Map();

    function addTokens(text: string, weight: number): void {
      for (const token of tokenize(text)) {
        tfBag.set(token, (tfBag.get(token) ?? 0) + weight);
      }
    }

    addTokens(item.name, 3);
    for (const tag of item.tags) {
      addTokens(tag, 2);
    }
    addTokens(item.id, 2);
    addTokens(item.description, 1);
    addTokens(item.author, 1);
    addTokens(item.category, 1);

    // Document length = sum of weighted TFs
    let dl = 0;
    for (const tf of tfBag.values()) {
      dl += tf;
    }
    docLen.set(item.id, dl);
    totalLen += dl;

    // Update postings and DF
    for (const [term, tf] of tfBag.entries()) {
      // DF: count this document once per term
      df.set(term, (df.get(term) ?? 0) + 1);

      // Postings list
      let list = postings.get(term);
      if (!list) {
        list = [];
        postings.set(term, list);
      }
      list.push({ id: item.id, tf });
    }
  }

  const N = items.length;
  const avgDocLen = N > 0 ? totalLen / N : 1;

  return { postings, df, docLen, avgDocLen, N };
}

// ── BM25 scorer ───────────────────────────────────────────────────────────────

/**
 * Search the index with BM25 scoring.
 *
 * @param index   - built by buildIndex()
 * @param query   - raw query string (will be tokenized + synonym-expanded)
 * @param opts    - BM25 hyperparameters (defaults: k1=1.5, b=0.75)
 * @returns       - scored results sorted by score descending; empty array if
 *                  query is blank or no documents match
 */
export function searchIndex(
  index: CatalogIndex,
  query: string,
  opts?: { k1?: number; b?: number }
): { id: string; score: number }[] {
  if (!query || !query.trim()) return [];

  const k1 = opts?.k1 ?? 1.5;
  const b = opts?.b ?? 0.75;
  const { postings, df, docLen, avgDocLen, N } = index;

  const queryTokens = tokenizeQuery(query);
  if (queryTokens.length === 0) return [];

  // Accumulate scores per document
  const scores: Map<string, number> = new Map();

  for (const term of queryTokens) {
    const list = postings.get(term);
    if (!list) continue;

    const termDf = df.get(term) ?? 0;
    // IDF with smoothing (Robertson-Sparck Jones):
    //   idf = log((N - df + 0.5) / (df + 0.5) + 1)
    const idf = Math.log((N - termDf + 0.5) / (termDf + 0.5) + 1);

    for (const { id, tf } of list) {
      const dl = docLen.get(id) ?? avgDocLen;
      const norm = tf / (tf + k1 * (1 - b + b * (dl / avgDocLen)));
      const contribution = idf * norm;
      scores.set(id, (scores.get(id) ?? 0) + contribution);
    }
  }

  if (scores.size === 0) return [];

  return Array.from(scores.entries())
    .filter(([, score]) => score > 0)
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}
