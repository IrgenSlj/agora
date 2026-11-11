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
import { EventSubject } from '../events/schema.js';
import { appendEvent, closeSession } from '../log/store.js';
import type { ConnectionSample } from './connections.js';
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
  /** Why networkSampled is false, without collapsing unavailable into clean. */
  networkSampling: 'not-requested' | 'sampled' | 'unavailable';
  /** Stable, non-sensitive reason when the sampler was unavailable. */
  networkSamplingError?: string;
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
  sampleConnections?: (pid: number) => Promise<ConnectionSample>;
  now?: () => Date;
  /**
   * Also write AgentEvents into the session log (docs/PLAN.md, phase 1). The
   * shim cannot see the host's own session id, so it keeps a session of its
   * own, named here, and labels tools with `server`.
   */
  eventLog?: { session: string; server: string };
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
    networkSampled: false,
    networkSampling: 'not-requested'
  };

  // Never throws: a broken log must not become a broken server.
  const logEvent = (kind: 'tool_call' | 'net', subject: string) => {
    if (!options.eventLog || !EventSubject.safeParse(subject).success) return;
    try {
      appendEvent(
        options.dataDir,
        options.eventLog.session,
        {
          host: 'mcp-shim',
          kind,
          subject,
          decision: 'allowed'
        },
        now()
      );
    } catch {
      /* a lost event must never surface as a broken server */
    }
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
            .then((result) => {
              if (result.status === 'unavailable') {
                if (!session.networkSampled) {
                  session.networkSampling = 'unavailable';
                  session.networkSamplingError = result.reason;
                }
                return;
              }
              session.networkSampled = true;
              session.networkSampling = 'sampled';
              delete session.networkSamplingError;
              for (const host of result.hosts) hosts.add(host);
            })
            .catch(() => {
              if (!session.networkSampled) {
                session.networkSampling = 'unavailable';
                session.networkSamplingError = 'connection sampler failed';
              }
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
      if (!tool) return;
      session.toolCalls[tool] = (session.toolCalls[tool] ?? 0) + 1;
      logEvent('tool_call', `mcp:${options.eventLog?.server ?? 'unknown'}/${tool}`);
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
      for (const host of session.hostsContacted) logEvent('net', host);
      if (options.eventLog) {
        try {
          closeSession(
            options.dataDir,
            options.eventLog.session,
            `exit:${exitCode}`,
            'mcp-shim',
            ended
          );
        } catch {
          /* see logEvent */
        }
      }

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
