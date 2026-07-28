// Claude Code as an inference provider.
//
// **This deliberately does not touch credentials.** `docs/OPEN_QUESTIONS.md`
// OQ-1 originally concluded Agora would need a user-supplied
// `ANTHROPIC_API_KEY`, but that was reasoning about the Agent *SDK* — a library
// that reads the key from the environment and cannot see Claude Code's login.
// Agora spawns the *binary* instead, and `claude --bare` documents itself as
// making auth "strictly ANTHROPIC_API_KEY or apiKeyHelper … (OAuth and keychain
// are never read)". Without `--bare`, OAuth and keychain *are* read — so
// spawning `claude -p` uses whatever the developer already set up, Pro/Max
// subscription included, and Agora never sees a secret.
//
// Model **aliases** are used rather than pinned ids. OQ-1 recorded
// `claude-opus-4-8` as current; it is already stale. Aliases do not rot.

import { type ChildProcess, type SpawnOptions, spawn } from 'node:child_process';
import { resolveOnPath } from '../stack/path-resolve.js';
import type { InferenceProvider, RunPromptInput, StreamTranslator } from './types.js';

const MODELS = ['sonnet', 'opus', 'haiku', 'fable'] as const;

export function buildClaudeRunArgs(input: RunPromptInput): string[] {
  const args = [
    '--print',
    '--output-format',
    'stream-json',
    // stream-json emits only the final result without this; the incremental
    // assistant messages the renderer draws come from verbose mode.
    '--verbose',
    '--model',
    input.model ?? 'sonnet'
  ];
  if (input.sessionId) args.push('--resume', input.sessionId);
  else if (input.continueSession) args.push('--continue');
  args.push(input.prompt);
  return args;
}

interface PendingTool {
  name: string;
  input: unknown;
  startedAt: number;
}

/**
 * Claude reports a tool call and its result in *separate* messages — the call
 * on an `assistant` message, the result on the following `user` message — so
 * the translator holds the call until the result arrives and emits one event
 * with both. The renderer only prints tools that reached a terminal status, so
 * emitting on the call alone would print nothing.
 */
export function createClaudeTranslator(): StreamTranslator {
  const pending = new Map<string, PendingTool>();
  let sessionID: string | undefined;

  return (line: string): unknown[] => {
    const trimmed = line.trim();
    if (!trimmed) return [];

    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return [];
    }

    const sid = ev['session_id'];
    if (typeof sid === 'string') sessionID = sid;

    const type = ev['type'];
    const out: unknown[] = [];

    if (type === 'system' && ev['subtype'] === 'init') {
      return [{ type: 'step_start', sessionID }];
    }

    if (type === 'assistant') {
      const message = ev['message'] as { content?: unknown[] } | undefined;
      for (const block of message?.content ?? []) {
        const part = block as Record<string, unknown>;
        if (part['type'] === 'text' && typeof part['text'] === 'string') {
          out.push({ type: 'text', sessionID, part: { text: part['text'] } });
        } else if (part['type'] === 'tool_use' && typeof part['id'] === 'string') {
          pending.set(part['id'], {
            name: typeof part['name'] === 'string' ? part['name'] : 'tool',
            input: part['input'],
            startedAt: Date.now()
          });
        }
        // `thinking` blocks are intentionally dropped: the renderer shows its
        // own thinking indicator, and echoing raw reasoning would bury the answer.
      }
      return out;
    }

    if (type === 'user') {
      const message = ev['message'] as { content?: unknown[] } | undefined;
      for (const block of message?.content ?? []) {
        const part = block as Record<string, unknown>;
        if (part['type'] !== 'tool_result') continue;
        const id = part['tool_use_id'];
        if (typeof id !== 'string') continue;
        const call = pending.get(id);
        pending.delete(id);
        const end = Date.now();
        out.push({
          type: 'tool_use',
          sessionID,
          part: {
            callID: id,
            tool: call?.name ?? 'tool',
            state: {
              status: part['is_error'] === true ? 'error' : 'completed',
              input: call?.input ?? {},
              output: part['content'] ?? '',
              time: { start: call?.startedAt ?? end, end }
            }
          }
        });
      }
      return out;
    }

    if (type === 'result') {
      const usage = (ev['usage'] ?? {}) as Record<string, unknown>;
      const input = typeof usage['input_tokens'] === 'number' ? usage['input_tokens'] : 0;
      const output = typeof usage['output_tokens'] === 'number' ? usage['output_tokens'] : 0;
      const cost = ev['total_cost_usd'];
      return [
        {
          type: 'step_finish',
          sessionID,
          part: {
            tokens: { output, total: input + output },
            cost: typeof cost === 'number' ? cost : 0
          }
        }
      ];
    }

    // system/thinking_tokens, rate_limit_event, and anything Claude adds later
    // are not part of the rendered transcript.
    return [];
  };
}

export function resolveClaude(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): string | null {
  return resolveOnPath('claude', env);
}

export const claudeProvider: InferenceProvider = {
  id: 'claude',
  label: 'Claude Code',
  installHint: 'Install Claude Code: https://claude.com/claude-code',
  defaultModel: 'sonnet',
  models: MODELS,
  // Draws on the developer's own Claude plan, so it is never the silent default.
  free: false,
  isAvailable(env = process.env) {
    return resolveClaude(env) !== null;
  },
  buildArgs: buildClaudeRunArgs,
  spawn(args: string[], options: SpawnOptions = {}): ChildProcess {
    const resolved = resolveClaude(options.env ?? process.env);
    if (!resolved) throw new Error('claude binary not found');
    return spawn(resolved, args, { ...options, shell: false });
  },
  createTranslator: createClaudeTranslator
};
