// The inference provider contract.
//
// Agora owns no inference. It *spawns* a coding CLI the user already has, which
// is why the shell can offer chat with no API key, no account, and no
// credential ever touching Agora's disk. Adding a provider means teaching this
// interface how to launch one binary and how to read its stream — nothing else
// in the codebase changes.

import type { ChildProcess, SpawnOptions } from 'node:child_process';

export type ProviderId = 'opencode' | 'claude';

export interface RunPromptInput {
  /** Provider-specific model id or alias. Omit for the provider default. */
  model?: string;
  prompt: string;
  /** Resume a specific prior session. */
  sessionId?: string | null;
  /** Resume the most recent session in this directory. */
  continueSession?: boolean;
}

/**
 * Translates one line of provider stdout into zero or more renderer events.
 *
 * Stateful: providers that report a tool call and its result in separate
 * messages need to pair them, so a translator is created per run rather than
 * being a pure function.
 *
 * The event vocabulary is opencode's (`step_start` / `text` / `tool_use` /
 * `step_finish`, with a `part` payload), because `src/cli/chat-renderer.ts`
 * already speaks it. Providers translate *into* that shape; the renderer stays
 * provider-agnostic and untouched.
 */
export type StreamTranslator = (line: string) => unknown[];

export interface InferenceProvider {
  id: ProviderId;
  /** Shown in the shell when reporting which provider answered. */
  label: string;
  /** How the user gets it, shown when no provider is installed. */
  installHint: string;
  defaultModel: string;
  models: readonly string[];
  /**
   * Whether this provider costs the user nothing to run. `opencode` routes to
   * zero-cost models; `claude` draws on the developer's own plan. The shell
   * uses this to pick a default that never silently spends someone's money.
   */
  free: boolean;
  /** True when the binary is resolvable on PATH. */
  isAvailable(env?: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean;
  buildArgs(input: RunPromptInput): string[];
  spawn(args: string[], options?: SpawnOptions): ChildProcess;
  createTranslator(): StreamTranslator;
}
