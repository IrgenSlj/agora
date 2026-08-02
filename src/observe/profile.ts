// Aggregates recorded sessions into a per-server picture, and works out where
// observed behaviour diverges from what the server declared.
//
// The divergence vocabulary is shared with the older sandbox design
// (`src/model/observed.ts`). Runtime sessions and sandbox profiles are distinct
// evidence shapes; a future backend may share policy attributes, but must use a
// versioned predicate that matches the data it actually records.

import type { Divergence } from '../model/observed.js';
import type { ObservedSession } from './session.js';

export interface ServerObservation {
  key: string;
  command: string[];
  sessions: number;
  totalDurationMs: number;
  lastSeen?: string;
  /** Tool name → total calls across sessions. */
  toolCalls: Record<string, number>;
  /** Union of tool names the server ever advertised. */
  toolsAdvertised: string[];
  /** Union of peers seen. Meaningless unless `networkSampled`. */
  hostsContacted: string[];
  /**
   * True when at least one session sampled connections. False means network
   * behaviour was never looked at — not that there was none.
   */
  networkSampled: boolean;
  /** Non-zero exits seen, which often precede a rug-pull investigation. */
  failures: number;
}

export function aggregate(sessions: readonly ObservedSession[]): ServerObservation[] {
  const byKey = new Map<string, ServerObservation>();

  for (const session of sessions) {
    const existing = byKey.get(session.key) ?? {
      key: session.key,
      command: session.command,
      sessions: 0,
      totalDurationMs: 0,
      toolCalls: {},
      toolsAdvertised: [],
      hostsContacted: [],
      networkSampled: false,
      failures: 0
    };

    existing.sessions += 1;
    existing.totalDurationMs += session.durationMs ?? 0;
    if (!existing.lastSeen || (session.endedAt ?? '') > existing.lastSeen) {
      existing.lastSeen = session.endedAt;
    }
    for (const [tool, count] of Object.entries(session.toolCalls)) {
      existing.toolCalls[tool] = (existing.toolCalls[tool] ?? 0) + count;
    }
    existing.toolsAdvertised = [
      ...new Set([...existing.toolsAdvertised, ...session.toolsAdvertised])
    ].sort();
    existing.hostsContacted = [
      ...new Set([...existing.hostsContacted, ...session.hostsContacted])
    ].sort();
    existing.networkSampled = existing.networkSampled || session.networkSampled;
    if (session.exitCode !== undefined && session.exitCode !== 0) existing.failures += 1;

    byKey.set(session.key, existing);
  }

  return [...byKey.values()].sort((a, b) => b.sessions - a.sessions);
}

export interface DeclaredCapabilities {
  /** Hosts the artifact declared it would contact, from its permission manifest. */
  net?: string[];
}

/** Strips the port so a declared host matches whatever port it was reached on. */
function hostOnly(peer: string): string {
  const colon = peer.lastIndexOf(':');
  return colon > 0 ? peer.slice(0, colon) : peer;
}

/**
 * Compares what was observed against what was declared.
 *
 * Only emits a divergence when the evidence actually supports one. If network
 * sampling never ran, no `undeclared-egress` is reported — an unobserved
 * server is not a well-behaved one, and saying otherwise is the failure this
 * codebase keeps having to design against.
 */
export function divergences(
  observation: ServerObservation,
  declared: DeclaredCapabilities = {}
): Divergence[] {
  const found: Divergence[] = [];

  if (observation.networkSampled && observation.hostsContacted.length > 0) {
    const declaredHosts = declared.net ?? [];
    // A declared "*" is a blanket egress claim; nothing can be undeclared.
    if (!declaredHosts.includes('*')) {
      const undeclared = observation.hostsContacted.filter(
        (peer) => !declaredHosts.includes(hostOnly(peer))
      );
      if (undeclared.length > 0) {
        found.push({
          kind: 'undeclared-egress',
          detail:
            declaredHosts.length === 0
              ? `contacted ${undeclared.join(', ')} while declaring no network access`
              : `contacted ${undeclared.join(', ')}, not among declared hosts (${declaredHosts.join(', ')})`,
          severity: declaredHosts.length === 0 ? 'critical' : 'warn'
        });
      }
    }
  }

  return found;
}
