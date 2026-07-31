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
import type { OsvQueryResponse, OsvVulnerability } from './types.js';

export const OSV_QUERY_URL = 'https://api.osv.dev/v1/query';
export const OSV_BATCH_URL = 'https://api.osv.dev/v1/querybatch';

/** Batch queries above this size are split; OSV accepts large batches but slow ones time out. */
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
 * Sequential rather than parallel on purpose: OSV publishes no rate limit, and
 * a tool whose entire argument is good supply-chain citizenship should not be
 * the reason a free public service starts needing one.
 */
export async function queryPurls(
  purls: readonly string[],
  options: OsvOptions = {}
): Promise<OsvLookup[]> {
  const unique = [...new Set(purls)];
  const out: OsvLookup[] = [];

  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    for (const purl of unique.slice(i, i + BATCH_SIZE)) {
      out.push(await queryPurl(purl, options));
    }
  }
  return out;
}
