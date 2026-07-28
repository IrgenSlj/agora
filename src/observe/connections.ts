// Best-effort network observation for a supervised process.
//
// Uses `lsof -p <pid> -i -n -P`, which needs no elevated privileges for a
// process you own. That buys real evidence for free, but the honesty caveat is
// large enough to be part of the API rather than a footnote:
//
//   **This SAMPLES. A connection opened and closed between two polls is
//   invisible to it.** An empty result therefore means "nothing seen", never
//   "nothing happened", and every consumer must render it that way — hence
//   `networkSampled` on the session record rather than an empty array standing
//   in for a clean bill of health.
//
// A short-lived exfiltration POST is exactly the thing this can miss. It is
// still worth having: a server that beacons, polls, or holds a connection open
// is caught, and that covers the common undeclared-egress case. Anything
// stronger needs eBPF or a proxy, which is a later backend.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Hosts that are never interesting — loopback chatter, not egress. */
const IGNORED_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '*']);

/**
 * Parses `lsof -i -n -P` output into host:port strings.
 *
 * A line looks like:
 *   node  1234 user 23u IPv4 0x… 0t0 TCP 192.168.1.5:52341->140.82.114.6:443 (ESTABLISHED)
 * We take the right-hand side of the arrow — the peer.
 */
export function parseLsofHosts(output: string): string[] {
  const hosts = new Set<string>();

  for (const line of output.split('\n')) {
    const arrow = line.indexOf('->');
    if (arrow === -1) continue;

    const after = line.slice(arrow + 2).trim();
    const peer = after.split(/\s+/)[0];
    if (!peer) continue;

    // Split host:port from the right so IPv6 literals survive.
    const colon = peer.lastIndexOf(':');
    if (colon <= 0) continue;
    const host = peer.slice(0, colon).replace(/^\[|\]$/g, '');
    const port = peer.slice(colon + 1);
    if (!host || IGNORED_HOSTS.has(host)) continue;

    hosts.add(`${host}:${port}`);
  }

  return [...hosts].sort();
}

/**
 * Samples the peers a pid currently holds connections to.
 *
 * Resolves to `[]` when lsof is missing or errors — the caller distinguishes
 * "sampling never ran" from "sampled and saw nothing" via the session's
 * `networkSampled` flag, because those are very different claims.
 */
export async function sampleConnections(pid: number): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('lsof', ['-p', String(pid), '-i', '-n', '-P'], {
      timeout: 4000,
      maxBuffer: 2_000_000
    });
    return parseLsofHosts(stdout);
  } catch {
    return [];
  }
}
