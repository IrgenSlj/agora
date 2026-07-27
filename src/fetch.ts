/**
 * The injectable fetch used everywhere Agora talks to a network.
 *
 * Every network-touching function takes one of these rather than calling the
 * global `fetch`, so the test suite stays hermetic: a test that forgets to
 * inject a fetcher fails loudly instead of silently reaching the internet.
 *
 * This lived in `src/live/types.ts` until that module — a client for a hosted
 * API that never existed — was deleted. It is a plumbing type with no domain
 * meaning, which is why it gets its own file rather than a home in one of the
 * planes that happens to use it.
 */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
