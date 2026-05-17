/**
 * Pure search helpers — extracted so they can be unit-tested without any I/O.
 */

const SNIPPET_HALF = 60;
const SNIPPET_MAX = 120;

/**
 * Extract a ~120-char snippet from `content` centred on the first
 * case-insensitive occurrence of `query`.
 *
 * - If a match is found, the matched substring is wrapped with `[` and `]`.
 * - A leading `…` is prepended when the window doesn't start at position 0.
 * - A trailing `…` is appended when the window doesn't reach the end.
 * - If no match is found, returns the first SNIPPET_MAX chars of content
 *   (no markers).
 */
export function extractSnippet(content: string, query: string): string {
  if (!content) return '';

  const lower = content.toLowerCase();
  const lowerQ = query.toLowerCase();
  const idx = lower.indexOf(lowerQ);

  if (idx === -1) {
    // No match in content — return first SNIPPET_MAX chars plain
    const plain = content.slice(0, SNIPPET_MAX);
    return plain.length < content.length ? plain + '…' : plain;
  }

  const start = Math.max(0, idx - SNIPPET_HALF);
  const end = Math.min(content.length, idx + query.length + SNIPPET_HALF);

  const before = content.slice(start, idx);
  const matched = content.slice(idx, idx + query.length);
  const after = content.slice(idx + query.length, end);

  let snippet = before + '[' + matched + ']' + after;
  if (start > 0) snippet = '…' + snippet;
  if (end < content.length) snippet = snippet + '…';

  return snippet;
}

/**
 * Validate search query parameters.
 * Returns null on success, or an error string on failure.
 */
export function validateSearchQuery(
  q: unknown,
  board: unknown,
  validBoards: readonly string[]
): string | null {
  if (typeof q !== 'string' || q.length < 2) {
    return 'q must be at least 2 characters';
  }
  if (q.length > 200) {
    return 'q must be at most 200 characters';
  }
  if (board !== undefined && board !== '' && !validBoards.includes(board as string)) {
    return 'board must be one of: ' + validBoards.join(', ');
  }
  return null;
}
