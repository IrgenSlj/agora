// Choosing which recorded sessions a command reads.

import { realpathSync } from 'node:fs';
import type { AgentEvent } from '../events/schema.js';
import { listSessions, readEvents, readMeta } from './store.js';
import { verifySession } from './verify.js';

function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Sessions recorded in `repo` (or every session with `all`, or one by id).
 * Only sessions whose log verifies are returned for use; the rest are named,
 * because a tampered log must never shape a policy or a verdict.
 */
export function sessionsForRepo(
  dataDir: string,
  opts: { repo: string; all?: boolean; session?: string }
): { verified: { id: string; events: AgentEvent[] }[]; invalid: string[] } {
  const root = real(opts.repo);
  const ids = listSessions(dataDir)
    .map((s) => s.session)
    .filter((id) => {
      if (opts.session) return id === opts.session;
      if (opts.all) return true;
      const meta = readMeta(dataDir, id);
      return Boolean(meta?.git_root && real(meta.git_root) === root);
    });
  const verified: { id: string; events: AgentEvent[] }[] = [];
  const invalid: string[] = [];
  for (const id of ids) {
    if (verifySession(dataDir, id).ok) verified.push({ id, events: readEvents(dataDir, id) });
    else invalid.push(id);
  }
  return { verified, invalid };
}
