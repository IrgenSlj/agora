// `agora run -- <command…>` — the supervising shim.
//
// When observation is enabled, Agora rewrites each host config so the MCP
// server is launched through this instead of directly. Agora becomes the
// server's parent process and can watch what it really does, in the real
// environment, during real work — rather than in a container where there is
// something to detect and nothing real to do.
//
// ── THE ONE RULE ────────────────────────────────────────────────────────────
//
// This shim is on the critical path of every MCP server the user runs. If it
// mangles a byte, adds a frame, or swallows an exit code, it does not degrade
// observation — it breaks the user's entire agent setup.
//
// So: bytes are forwarded verbatim, in both directions, and observation is a
// *tee* off that stream which can never alter or delay it. Every observation
// failure is swallowed. Signals and exit codes propagate. If anything at all
// goes wrong in the observation layer, the correct outcome is a perfectly
// working MCP server and no data.

import { type ChildProcess, spawn } from 'node:child_process';
import { createFrameTee } from './protocol.js';
import type { SessionRecorder } from './session.js';

export interface RunOptions {
  /** argv of the real server, already split from `agora run --`. */
  command: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Absent → run fully transparently with no observation at all. */
  recorder?: SessionRecorder;
  /** Injected for tests. */
  spawnFn?: typeof spawn;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

/**
 * Runs the child to completion, proxying stdio, and resolves with its exit
 * code. Never throws for observation reasons.
 */
export async function runSupervised(options: RunOptions): Promise<number> {
  const { command } = options;
  if (command.length === 0) return 2;

  // Typed loosely on purpose: process.stdin and a test double are different
  // concrete stream types and we only ever use `on`.
  const stdin = (options.stdin ?? process.stdin) as unknown as {
    on(event: string, listener: (chunk: Buffer) => void): unknown;
  };
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const spawnFn = options.spawnFn ?? spawn;

  let child: ChildProcess;
  try {
    child = spawnFn(command[0]!, command.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: options.env ?? process.env,
      cwd: options.cwd
    });
  } catch (err) {
    // Spawn failure is the child's problem, not an observation problem —
    // report it the way a shell would rather than silently exiting 0.
    stderr.write(`agora run: cannot start ${command[0]}: ${(err as Error).message}\n`);
    return 127;
  }

  safely(() => options.recorder?.started(command, child.pid));

  // ── stdin: host → server ────────────────────────────────────────────────
  // Piped straight through. The tee sees a copy; it can never gate the write.
  const clientTee = createFrameTee((frame) => safely(() => options.recorder?.clientFrame(frame)));
  stdin.on('data', (chunk: Buffer) => {
    try {
      child.stdin?.write(chunk);
    } catch {
      /* child gone; its exit path handles it */
    }
    clientTee(chunk);
  });
  stdin.on('end', () => {
    try {
      child.stdin?.end();
    } catch {
      /* already closed */
    }
  });

  // ── stdout: server → host ───────────────────────────────────────────────
  const serverTee = createFrameTee((frame) => safely(() => options.recorder?.serverFrame(frame)));
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout.write(chunk);
    serverTee(chunk);
  });

  // stderr is forwarded untouched and never parsed — servers log freely there
  // and it is not protocol.
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr.write(chunk);
  });

  // ── signals: the host expects to control the server, not us ─────────────
  const forward = (signal: NodeJS.Signals) => () => {
    try {
      child.kill(signal);
    } catch {
      /* already dead */
    }
  };
  const onInt = forward('SIGINT');
  const onTerm = forward('SIGTERM');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);

  const code = await new Promise<number>((resolve) => {
    child.on('error', (err) => {
      stderr.write(`agora run: ${err.message}\n`);
      resolve(127);
    });
    child.on('close', (exitCode, signal) => {
      // Match shell convention so the host sees what it would have seen.
      if (signal) return resolve(128 + signalNumber(signal));
      resolve(exitCode ?? 0);
    });
  });

  process.removeListener('SIGINT', onInt);
  process.removeListener('SIGTERM', onTerm);

  try {
    await options.recorder?.finished(code);
  } catch {
    /* observation must never change the outcome */
  }

  return code;
}

/**
 * Runs an observation callback, swallowing anything it throws.
 *
 * Every recorder call site goes through this. The rule at the top of the file
 * is only real if it holds for a recorder that is actively broken — otherwise
 * a bug in the observation layer takes down every MCP server the user has.
 */
function safely(fn: () => void): void {
  try {
    fn();
  } catch {
    /* observation is never allowed to reach the data path */
  }
}

function signalNumber(signal: NodeJS.Signals): number {
  const table: Record<string, number> = { SIGINT: 2, SIGKILL: 9, SIGTERM: 15, SIGHUP: 1 };
  return table[signal] ?? 15;
}
