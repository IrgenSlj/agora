// The PreToolUse handler, reachable without loading the CLI.
//
// `src/cli.ts` routes `agora hook check` straight here. Everything it needs is
// local and synchronous — a config read, a feed read, a lockfile read — so the
// only reason to go through the command layer would be argument parsing, and
// there are no arguments.
//
// Every path returns 0. See `pretooluse.ts` for why a hook that fails closed is
// worse than useless.

import { detectAgoraDataDir } from '../state.js';
import {
  decidePreToolUse,
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

function readStdin(): Promise<string> {
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

export async function runHookCheck(): Promise<number> {
  let payload: PreToolUsePayload;
  try {
    const raw = await readStdin();
    if (!raw.trim()) {
      process.stderr.write('agora hook: no payload on stdin — nothing checked.\n');
      return 0;
    }
    payload = JSON.parse(raw) as PreToolUsePayload;
  } catch (e) {
    process.stderr.write(
      `agora hook: unreadable payload (${e instanceof Error ? e.message : String(e)}) — nothing checked.\n`
    );
    return 0;
  }

  // Before anything is loaded. A hook configured with a broader matcher — or a
  // host that routes every tool through it — would otherwise pay the whole
  // config-and-feed read to be told this was a `Bash` call. The check is a
  // string prefix; the imports below are ~50ms.
  if (!serverFromToolName(payload.tool_name)) return 0;

  try {
    const [
      { checkRevocations },
      { installedPurls },
      { findConfiguredServerDriftBlocks },
      { readAllServers }
    ] = await Promise.all([
      import('../revocation/client.js'),
      import('../revocation/installed.js'),
      import('../stack/drift-blocks.js'),
      import('../stack/registry.js')
    ]);

    const cwd = payload.cwd ?? process.cwd();
    const dataDir = detectAgoraDataDir({ cwd, env: process.env });
    const servers = readAllServers({ cwd, home: process.env.HOME });

    const decision = decidePreToolUse(payload, {
      servers,
      revocations: (purls) => checkRevocations(dataDir, [...purls]),
      driftBlocks: () => findConfiguredServerDriftBlocks(servers, dataDir),
      purlsFor: (server) => installedPurls([server]).addressable.map((a) => a.purl)
    });

    const rendered = renderDecision(decision);
    if (rendered) process.stdout.write(`${rendered}\n`);
    else if (decision.kind === 'no-opinion' && decision.note) {
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
