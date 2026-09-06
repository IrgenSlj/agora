// Querying OSV.dev for advisories against MCP servers.
//
// OSV is the piece that makes the revocation feed maintainable: Google curates
// the data, it is free, there is no API key and no rate limit, and it is keyed
// by **purl** — the same identifier Agora's data model already uses, so there
// is no mapping layer to drift.
//
// Why this is worth doing at all, given OSV is public and anyone can query it:
// MCP servers are not dependencies. They live in host configs as spawned
// commands (`npx @modelcontextprotocol/server-filesystem`) and appear in no
// package.json anywhere, so `npm audit`, Dependabot and Snyk cannot see them by
// construction. Agora knows which packages are MCP servers, so it can ask a
// question nothing else is positioned to ask.
//
// Honest limits, both of which must survive into the UI:
//   - This is *known-bad*, never *safe*. A malicious server nobody has reported
//     will not appear here, and an empty result means "nothing published",
//     never "nothing wrong".
//   - An unreachable OSV is reported as unreachable. It must never collapse
//     into an empty result, which would read as a clean bill of health.

import type { FetchLike } from '../fetch.js';
import type { OsvBatchResponse, OsvQueryResponse, OsvVulnerability } from './types.js';

export const OSV_QUERY_URL = 'https://api.osv.dev/v1/query';
export const OSV_BATCH_URL = 'https://api.osv.dev/v1/querybatch';

/** OSV's documented ceiling for a single `querybatch` request. */
const BATCH_SIZE = 100;

export interface OsvOptions {
  fetcher?: FetchLike;
  timeoutMs?: number;
}

export type OsvLookup =
  | { status: 'ok'; purl: string; vulns: OsvVulnerability[] }
  | { status: 'unreachable'; purl: string; reason: string };

async function postJson(
  url: string,
  body: unknown,
  options: OsvOptions
): Promise<{ ok: true; json: unknown } | { ok: false; reason: string }> {
  const fetcher = options.fetcher ?? globalThis.fetch;
  try {
    const res = await fetcher(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000)
    });
    if (!res.ok) return { ok: false, reason: `OSV responded ${res.status}` };
    return { ok: true, json: await res.json() };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'OSV unreachable' };
  }
}

/**
 * Full advisory records for one purl.
 *
 * The batch endpoint returns ids only, so anything that needs severity or
 * version ranges — which is everything that writes a revocation entry — has to
 * come through here.
 */
export async function queryPurl(purl: string, options: OsvOptions = {}): Promise<OsvLookup> {
  const result = await postJson(OSV_QUERY_URL, { package: { purl } }, options);
  if (!result.ok) return { status: 'unreachable', purl, reason: result.reason };

  const vulns = (result.json as OsvQueryResponse)?.vulns ?? [];
  // Withdrawn advisories are retracted claims. Carrying one into a revocation
  // feed would revoke a package on the strength of something its own database
  // has taken back.
  return { status: 'ok', purl, vulns: vulns.filter((v) => !v.withdrawn) };
}

/**
 * Advisories for many purls.
 *
 * Two phases, because the shape of the data makes one request per package the
 * wrong trade at scale. When the artifact universe was thirty hand-listed
 * servers, asking OSV thirty separate questions was fine. Against the whole
 * registry it is thousands of sequential round trips, and the overwhelming
 * majority of them return nothing — there are a few thousand MCP packages and
 * roughly ten live advisories between them.
 *
 * So: `querybatch` first, a hundred packages per request, which answers "does
 * this have anything at all" for everything. Then the full record for only the
 * few that said yes, because batch returns ids and nothing a revocation entry
 * needs — no severity, no version ranges.
 *
 * This is both faster and better citizenship. OSV publishes no rate limit, and
 * a tool whose whole argument is good supply-chain behaviour should not be the
 * reason a free public service starts needing one. Two dozen batched requests
 * ask less of them than two thousand individual ones, so the two goals point
 * the same way here rather than trading off.
 *
 * A failed batch marks every purl in it unreachable. It must never collapse
 * into "no advisories" — that is a clean bill of health for packages nobody
 * actually asked about.
 */
export async function queryPurls(
  purls: readonly string[],
  options: OsvOptions = {}
): Promise<OsvLookup[]> {
  const unique = [...new Set(purls)];
  const out: OsvLookup[] = [];

  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const chunk = unique.slice(i, i + BATCH_SIZE);
    const result = await postJson(
      OSV_BATCH_URL,
      { queries: chunk.map((purl) => ({ package: { purl } })) },
      options
    );

    if (!result.ok) {
      for (const purl of chunk) {
        out.push({ status: 'unreachable', purl, reason: result.reason });
      }
      continue;
    }

    // Results are positional, never keyed by package. A response that does not
    // line up with the queries cannot be matched to a package safely, so the
    // whole chunk is unreachable rather than silently mis-attributed.
    const results = (result.json as OsvBatchResponse)?.results;
    if (!Array.isArray(results) || results.length !== chunk.length) {
      for (const purl of chunk) {
        out.push({
          status: 'unreachable',
          purl,
          reason: `OSV batch returned ${Array.isArray(results) ? results.length : 'no'} results for ${chunk.length} queries`
        });
      }
      continue;
    }

    for (let j = 0; j < chunk.length; j++) {
      const purl = chunk[j]!;
      const hits = results[j]?.vulns ?? [];
      if (hits.length === 0) {
        out.push({ status: 'ok', purl, vulns: [] });
        continue;
      }
      // Something is there; go get the record that can actually be turned into
      // a revocation entry.
      out.push(await queryPurl(purl, options));
    }
  }
  return out;
}
