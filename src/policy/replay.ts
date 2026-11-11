// Replay: what a policy would have done to sessions that already happened.
//
// Only events that actually ran (`allowed`) are replayed: the question is
// "would this stricter policy have stopped anything that went through?".

import type { AgentEvent } from '../events/schema.js';
import { type Decision, evaluate, type PolicySet } from './engine.js';
import { requestFor, type ToolFacts } from './requests.js';

export interface ReplayGroup {
  action: string;
  subject: string;
  count: number;
  sessions: number;
  /** The policies that denied it; empty means no rule permits it. */
  reasons: string[];
}

export interface ReplayResult {
  events: number;
  evaluated: number;
  denied: number;
  /** Decisions reached with a policy skipped on error: not conclusive. */
  inconclusive: number;
  groups: ReplayGroup[];
}

export async function replay(
  set: PolicySet,
  sessions: ReadonlyArray<{ id: string; events: readonly AgentEvent[] }>,
  facts: ToolFacts = {}
): Promise<ReplayResult> {
  const result: ReplayResult = { events: 0, evaluated: 0, denied: 0, inconclusive: 0, groups: [] };
  const groups = new Map<string, ReplayGroup & { ids: Set<string> }>();
  // Many events repeat; decide each distinct request once.
  const cache = new Map<string, Decision | undefined>();

  for (const session of sessions) {
    for (const event of session.events) {
      result.events++;
      if (event.decision !== 'allowed') continue;
      const req = requestFor(event, facts);
      if (!req) continue;
      const key = `${req.action}\0${req.resource.type}\0${req.resource.id}\0${event.host}`;
      if (!cache.has(key)) cache.set(key, await evaluate(set, req));
      const d = cache.get(key);
      if (!d) throw new Error('the Cedar engine could not be loaded');
      result.evaluated++;
      if (d.errors.length) result.inconclusive++;
      if (d.decision !== 'deny') continue;
      result.denied++;
      const gkey = `${req.action}\0${event.subject}`;
      const g = groups.get(gkey) ?? {
        action: req.action,
        subject: event.subject,
        count: 0,
        sessions: 0,
        reasons: d.reasons,
        ids: new Set<string>()
      };
      g.count++;
      g.ids.add(session.id);
      g.sessions = g.ids.size;
      groups.set(gkey, g);
    }
  }
  result.groups = [...groups.values()]
    .map(({ ids: _ids, ...g }) => g)
    .sort((a, b) => b.count - a.count || a.subject.localeCompare(b.subject));
  return result;
}
