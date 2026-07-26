// Records what a supervised server did, to disk, locally.
//
// ── WHAT IS DELIBERATELY NOT RECORDED ───────────────────────────────────────
//
// This code sits in the path of the user's real work, so it sees real data:
// the contents of files an agent read, the text of prompts, API responses,
// arguments containing secrets. **None of that is written down.**
//
// Recorded: which tools were called and how often, which tool names the server
// advertised, when the session ran, how it ended, and which hosts the process
// held connections to. That is enough to answer "is this server doing
// something it never declared?" — the only question this plane exists to ask.
//
// Not recorded: tool arguments, tool results, prompt text, file contents, or
// anything else derived from them. A trust tool that quietly built a log of
// everything its user did would be a worse liability than the servers it is
// meant to watch, and no amount of local-only storage would fix that.
//
// Nothing here leaves the machine. There is no upload path.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calledToolName, type Frame, toolNamesFromResult } from './protocol.js';

export interface ObservedSession {
  /** Stable key for the server: its purl when derivable, else the command. */
  key: string;
  command: string[];
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  exitCode?: number;
  pid?: number;
  /** Tool name → call count. Names only; never arguments. */
  toolCalls: Record<string, number>;
  /** Tool names the server advertised via tools/list. */
  toolsAdvertised: string[];
  /** Hosts the process held connections to, sampled — see connections.ts. */
  hostsContacted: string[];
  /** True when sampling ran; false means "not observed", not "none". */
  networkSampled: boolean;
}

export function sessionsPath(dataDir: string): string {
  return join(dataDir, 'observed-sessions.jsonl');
}

export interface SessionRecorder {
  started(command: string[], pid?: number): void;
  clientFrame(frame: Frame): void;
  serverFrame(frame: Frame): void;
  finished(exitCode: number): Promise<void>;
}

export interface RecorderOptions {
  dataDir: string;
  key: string;
  /** Samples network connections for a pid; omitted → no network observation. */
  sampleConnections?: (pid: number) => Promise<string[]>;
  now?: () => Date;
}

/**
 * Builds a recorder. Every method is failure-tolerant: a recorder that threw
 * would take down the MCP server it is observing, which is a strictly worse
 * outcome than losing a session record.
 */
export function createSessionRecorder(options: RecorderOptions): SessionRecorder {
  const now = options.now ?? (() => new Date());
  const startedAt = now();

  const session: ObservedSession = {
    key: options.key,
    command: [],
    startedAt: startedAt.toISOString(),
    toolCalls: {},
    toolsAdvertised: [],
    hostsContacted: [],
    networkSampled: false
  };

  let pid: number | undefined;
  let sampler: ReturnType<typeof setInterval> | undefined;
  const hosts = new Set<string>();

  return {
    started(command, childPid) {
      session.command = command;
      session.pid = childPid;
      pid = childPid;

      if (pid !== undefined && options.sampleConnections) {
        const sample = () => {
          if (pid === undefined) return;
          options
            .sampleConnections?.(pid)
            .then((found) => {
              session.networkSampled = true;
              for (const host of found) hosts.add(host);
            })
            .catch(() => {
              /* sampling is best-effort */
            });
        };
        sample();
        // Long-lived servers are the norm; poll rather than spin.
        sampler = setInterval(sample, 15_000);
        sampler.unref?.();
      }
    },

    clientFrame(frame) {
      const tool = calledToolName(frame);
      if (tool) session.toolCalls[tool] = (session.toolCalls[tool] ?? 0) + 1;
    },

    serverFrame(frame) {
      const names = toolNamesFromResult(frame.result);
      if (names.length > 0) session.toolsAdvertised = names;
    },

    async finished(exitCode) {
      if (sampler) clearInterval(sampler);
      pid = undefined;

      const ended = now();
      session.endedAt = ended.toISOString();
      session.durationMs = ended.getTime() - startedAt.getTime();
      session.exitCode = exitCode;
      session.hostsContacted = [...hosts].sort();

      try {
        mkdirSync(options.dataDir, { recursive: true });
        appendFileSync(sessionsPath(options.dataDir), `${JSON.stringify(session)}\n`, {
          mode: 0o600
        });
      } catch {
        /* a lost record must never surface as a broken server */
      }
    }
  };
}

/** Reads every recorded session. Malformed lines are skipped, not fatal. */
export function readSessions(dataDir: string): ObservedSession[] {
  const path = sessionsPath(dataDir);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as ObservedSession;
        } catch {
          return null;
        }
      })
      .filter((s): s is ObservedSession => s !== null);
  } catch {
    return [];
  }
}
