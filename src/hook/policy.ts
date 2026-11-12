// The PreToolUse policy decision: does agora.cedar permit this call?
//
// Rule 3: deny or no opinion, never allow. Rule 4: fail open. A policy that
// does not parse, a rule that errored, or an engine that will not load is no
// opinion with a note, never a block.

import type { HookPayload } from '../events/hook-payload.js';
import type { HookDecision } from './pretooluse.js';

export async function decidePolicy(
  payload: HookPayload,
  ctx: { root: string; dataDir: string; home?: string }
): Promise<HookDecision> {
  const [{ normaliseHook }, { evaluate, loadPolicySet, POLICY_FILE }, { requestFor }] =
    await Promise.all([
      import('../events/hook-payload.js'),
      import('../policy/engine.js'),
      import('../policy/requests.js')
    ]);

  const set = await loadPolicySet({ repo: ctx.root });
  if (!set)
    return { kind: 'no-opinion', note: 'the Cedar engine could not be loaded; nothing checked.' };
  if (set.errors.length) {
    return {
      kind: 'no-opinion',
      note: `${POLICY_FILE} does not parse; nothing checked. Run \`agora policy check\`.`
    };
  }
  // Revocation status matters only for MCP tools, and looking it up reads the
  // revocation list and every host config; skip it for everything else.
  const facts = payload.tool_name?.startsWith('mcp__')
    ? (await import('../policy/facts.js')).revocationFacts({
        cwd: ctx.root,
        home: ctx.home,
        env: process.env,
        dataDir: ctx.dataDir
      })
    : {};

  for (const draft of normaliseHook(payload)) {
    const req = requestFor(draft, facts);
    if (!req) continue;
    const d = await evaluate(set, req);
    if (!d)
      return { kind: 'no-opinion', note: 'the Cedar engine could not be loaded; nothing checked.' };
    if (d.errors.length) {
      return {
        kind: 'no-opinion',
        note: `a rule in ${POLICY_FILE} errored (${d.errors[0]}); this call was not checked.`
      };
    }
    if (d.decision === 'deny') {
      const why = d.reasons.length
        ? `denied by ${d.reasons.join(', ')}`
        : 'no rule in it permits this';
      return {
        kind: 'deny',
        reason:
          `${POLICY_FILE} does not permit ${req.action} ${draft.subject} (${why}).\n` +
          `  If it should be allowed, add a rule to ${POLICY_FILE}; \`agora replay\` shows what a change would affect.`
      };
    }
  }
  return { kind: 'no-opinion' };
}
