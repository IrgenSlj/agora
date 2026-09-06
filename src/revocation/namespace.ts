// Enumerating the artifacts the feed is responsible for.
//
// The revocation feed used to be scoped to whatever happened to be in the
// bundled sample catalog — about thirty servers — which meant coverage was an
// accident of a hand-maintained file rather than a property of the ecosystem.
// Ten entries came out the other end. A feed that only knows about thirty
// packages cannot be asked "is this artifact known-bad?" by anyone, because the
// answer is "I have never heard of it" for almost everything.
//
// So the universe is now the official MCP registry, paginated through in full.
// That is the closest thing the ecosystem has to a census: it is canonical, it
// verifies namespace ownership before it will index anything, and it is
// enumerable, which none of the larger aggregators are.
//
// ── The rule that governs every failure path here ──────────────────────────
//
// A partial enumeration must never look like a complete one. If page 40 of 96
// fails, the packages on pages 41 onward were not *checked and found clean* —
// they were never asked about. Publishing that difference as if it were the
// same thing would drop advisories for packages that still have them, which is
// precisely the "clean bill of health for a compromised package" failure the
// rest of the revocation plane is built to avoid.
//
// `complete` therefore travels with the result, and callers are expected to
// treat `complete: false` as "these purls are all I could confirm", never as
// "these purls are all there are".

import { fetchOfficialPage } from '../federation/adapters/official.js';
import type { FederationEnv } from '../federation/types.js';
import { npmPurl } from './installed.js';

export interface NamespaceResult {
  /** npm purls, deduplicated, in a stable order. */
  purls: string[];
  /** How many registry pages were read. */
  pages: number;
  /** Servers seen, including ones that ship no npm package. */
  servers: number;
  /**
   * True only when pagination ran to the end. False means the set is a floor,
   * not a census, and must not be used to conclude anything about absence.
   */
  complete: boolean;
  /** Why enumeration stopped early. Present only when `complete` is false. */
  reason?: string;
}

export interface EnumerateOptions {
  env: FederationEnv;
  /** Registry page size. Clamped to [1, 100] by the adapter. */
  pageSize?: number;
  /**
   * Stop after this many pages. A guard against an unbounded or looping cursor,
   * not a tuning knob — hitting it yields `complete: false`.
   */
  maxPages?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /**
   * Attempts per page before the walk gives up. Cursor pagination cannot skip:
   * page N+1's cursor arrives in page N's response, so one transient failure
   * ends the walk unless it is retried. Observed in practice — the registry
   * returned a single HTTP 500 on page 135 of 135.
   */
  pageRetries?: number;
  /** Injected so tests do not wait. Defaults to a real backoff. */
  sleep?: (ms: number) => Promise<void>;
  /** Called after each page, for progress output in a long-running job. */
  onPage?: (pages: number, purls: number) => void;
}

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 500;
const DEFAULT_PAGE_RETRIES = 3;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Walk the official registry and collect every npm artifact it lists.
 *
 * Servers that expose only a remote endpoint, or that ship through a registry
 * other than npm, produce no purl — they are counted in `servers` but cannot be
 * queried against OSV, which is keyed by package identity. That gap is real and
 * is better left visible in the numbers than papered over with a synthetic
 * identifier nothing else would recognise.
 */
export async function enumerateNamespace(opts: EnumerateOptions): Promise<NamespaceResult> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;

  const purls = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let pages = 0;
  let servers = 0;

  const retries = opts.pageRetries ?? DEFAULT_PAGE_RETRIES;
  const sleep = opts.sleep ?? wait;

  while (pages < maxPages) {
    let page: Awaited<ReturnType<typeof fetchOfficialPage>> | undefined;
    let lastError = '';

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        page = await fetchOfficialPage(
          { limit: pageSize, cursor, version: 'latest' },
          { timeoutMs: opts.timeoutMs, signal: opts.signal },
          opts.env
        );
        break;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        // Backoff before retrying the same cursor. Giving up here would discard
        // a walk that is already 134 pages deep over one transient 500, and a
        // job that goes red most nights for a reason nobody can act on is a job
        // people learn to ignore — which is how the feed went stale unnoticed
        // for five weeks once already.
        if (attempt < retries) await sleep(attempt * 1000);
      }
    }

    if (!page) {
      return {
        purls: [...purls].sort(),
        pages,
        servers,
        complete: false,
        reason: `registry page ${pages + 1} failed after ${retries} attempts: ${lastError}`
      };
    }

    pages++;
    servers += page.items.length;
    for (const item of page.items) {
      const pkg = (item as { npmPackage?: string }).npmPackage;
      if (pkg) purls.add(npmPurl(pkg));
    }
    opts.onPage?.(pages, purls.size);

    if (!page.nextCursor) {
      return { purls: [...purls].sort(), pages, servers, complete: true };
    }

    // A cursor that repeats means the registry is handing back a loop. Stopping
    // is right; claiming completeness is not, because the pages beyond the loop
    // were never read.
    if (seenCursors.has(page.nextCursor)) {
      return {
        purls: [...purls].sort(),
        pages,
        servers,
        complete: false,
        reason: 'registry returned a repeated cursor — pagination is looping'
      };
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }

  return {
    purls: [...purls].sort(),
    pages,
    servers,
    complete: false,
    reason: `stopped at the ${maxPages}-page guard before pagination ended`
  };
}
