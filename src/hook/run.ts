// The PreToolUse handler, reachable without loading the CLI.
//
// `src/cli.ts` routes `agora hook check` straight here. Everything it needs is
// local and synchronous — a config read and a feed read — so the
// only reason to go through the command layer would be argument parsing, and
// there are no arguments.
//
// Every path returns 0. See `pretooluse.ts` for why a hook that fails closed is
// worse than useless.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CANARY_STATE } from '../canary/canary.js';
import type { HookPayload } from '../events/hook-payload.js';
import { detectAgoraDataDir } from '../state.js';
import {
  decidePreToolUse,
  type HookDecision,
  type PreToolUsePayload,
  renderDecision,
  serverFromToolName
} from './pretooluse.js';

/**
 * Read the payload, or give up.
 *
 * Claude Code writes the JSON and closes stdin, so the timeout should never
 * fire in practice. It exists because the failure it prevents is the worst one
 * available here: if stdin is never closed — a TTY, a misconfigured wrapper, a
 * host that pipes differently — an unbounded read hangs this process, and this
 * process is in front of a tool call the user is waiting on. Found by running
 * `agora hook check` from a shell with no redirect, where it waited forever.
 *
 * Resolves empty on timeout, which the caller treats as "no payload" and
 * therefore no opinion.
 */
const STDIN_TIMEOUT_MS = 2000;

export function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const done = (value: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => {
      process.stderr.write(
        'agora hook: stdin stayed open with no payload — nothing checked, the call was not blocked.\n'
      );
      done('');
    }, STDIN_TIMEOUT_MS);
    // Not the reason to keep the process alive: if everything else has
    // finished, this timer should not be what holds the event loop open.
    timer.unref?.();

    process.stdin.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    process.stdin.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => done(''));
  });
}

async function canaryCheck(
  payload: HookPayload,
  root: string
): Promise<{ file: string; decision: HookDecision } | undefined> {
  const [{ canaryHit, readCanaries }, { normaliseHook }] = await Promise.all([
    import('../canary/canary.js'),
    import('../events/hook-payload.js')
  ]);
  const command = payload.tool_input?.command;
  const file = canaryHit(
    readCanaries(root),
    normaliseHook({ ...payload, cwd: root }),
    typeof command === 'string' ? command : undefined
  );
  if (!file) return undefined;
  return {
    file,
    decision: {
      kind: 'deny',
      reason:
        `${file} is a canary planted by \`agora canary install\`: no task needs it. ` +
        'This attempt was recorded, and `agora ci` will flag the commit.'
    }
  };
}

export async function runHookCheck(): Promise<number> {
  let payload: PreToolUsePayload & HookPayload;
  try {
    const raw = await readStdin();
    if (!raw.trim()) {
      process.stderr.write('agora hook: no payload on stdin — nothing checked.\n');
      return 0;
    }
    payload = JSON.parse(raw) as PreToolUsePayload & HookPayload;
  } catch (e) {
    process.stderr.write(
      `agora hook: unreadable payload (${e instanceof Error ? e.message : String(e)}) — nothing checked.\n`
    );
    return 0;
  }

  // Before anything is loaded: a non-MCP call in a repository without an
  // agora.cedar has nothing to be checked against, and this hook runs on
  // every tool call. Two existsSync calls; the imports below are ~50ms.
  const cwd = payload.cwd ?? process.cwd();
  const { findGitRoot } = await import('../log/store.js');
  const root = findGitRoot(cwd) ?? cwd;
  const hasPolicy = existsSync(join(root, 'agora.cedar'));
  const hasCanary = existsSync(join(root, CANARY_STATE));
  const isMcp = Boolean(serverFromToolName(payload.tool_name));
  if (!isMcp && !hasPolicy && !hasCanary) return 0;

  try {
    const dataDir = detectAgoraDataDir({ cwd, env: process.env });
    // A decoy first: no task needs it, and the hit must be recorded as one.
    if (hasCanary) {
      const hit = await canaryCheck(payload, root);
      if (hit) {
        process.stdout.write(`${renderDecision(hit.decision)}\n`);
        try {
          const { recordCanary } = await import('./record.js');
          recordCanary(payload, hit.file);
        } catch {
          process.stderr.write('agora hook: the canary hit was not recorded in the session log.\n');
        }
        return 0;
      }
    }
    let decision: HookDecision = { kind: 'no-opinion' };
    if (isMcp) {
      // Only MCP calls need the revocation list and the host configs.
      const [{ checkRevocations }, { installedPurls }, { readAllServers }] = await Promise.all([
        import('../revocation/client.js'),
        import('../revocation/installed.js'),
        import('../stack/registry.js')
      ]);
      decision = decidePreToolUse(payload, {
        servers: readAllServers({ cwd, home: process.env.HOME }),
        revocations: (purls) => checkRevocations(dataDir, [...purls]),
        purlsFor: (server) => installedPurls([server]).addressable.map((a) => a.purl)
      });
    }
    // Revocation first: it carries the advisory. Then the repository's policy.
    if (decision.kind !== 'deny' && hasPolicy) {
      const { decidePolicy } = await import('./policy.js');
      const byPolicy = await decidePolicy(payload as never, {
        root,
        dataDir,
        home: process.env.HOME
      });
      if (byPolicy.kind === 'deny' || byPolicy.note) decision = byPolicy;
    }

    const rendered = renderDecision(decision);
    if (rendered) process.stdout.write(`${rendered}\n`);
    if (decision.kind === 'deny') {
      // The call never reaches PostToolUse, so this is the only place the
      // denial can enter the session log. Recording must not change the answer.
      try {
        const { recordDrafts } = await import('./record.js');
        recordDrafts(payload, 'denied');
      } catch {
        process.stderr.write('agora hook: the denial was not recorded in the session log.\n');
      }
    } else if (decision.kind === 'no-opinion' && decision.note) {
      process.stderr.write(`agora hook: ${decision.note}\n`);
    }
    return 0;
  } catch (e) {
    process.stderr.write(
      `agora hook: check failed (${e instanceof Error ? e.message : String(e)}) — the call was ` +
        'not blocked. Run `agora doctor` when convenient.\n'
    );
    return 0;
  }
}
