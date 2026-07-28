// OpenCode as an inference provider — the zero-cost default.
//
// Agora ships a working chat on first run with no key and no account, which is
// why opencode is preferred over any provider that spends the user's money.
// The launch mechanics live in `src/opencode-exec.ts` (Windows `.cmd`
// handling, PATH resolution with caching); this file is the adapter onto the
// provider contract.

import type { ChildProcess, SpawnOptions } from 'node:child_process';
import {
  buildOpencodeRunArgs,
  FREE_MODELS,
  isOpencodeAvailable,
  spawnOpencode
} from '../opencode-exec.js';
import type { InferenceProvider, StreamTranslator } from './types.js';

/**
 * OpenCode already emits the event shape the renderer reads, so translation is
 * a parse. It stays a translator rather than a special case so the renderer
 * never needs to know which provider produced a line.
 */
export function createOpencodeTranslator(): StreamTranslator {
  return (line: string): unknown[] => {
    const trimmed = line.trim();
    if (!trimmed) return [];
    try {
      return [JSON.parse(trimmed)];
    } catch {
      return [];
    }
  };
}

export const opencodeProvider: InferenceProvider = {
  id: 'opencode',
  label: 'OpenCode',
  installHint: 'Install OpenCode: https://opencode.ai',
  defaultModel: FREE_MODELS[0]!,
  models: FREE_MODELS,
  free: true,
  isAvailable(env = process.env) {
    return isOpencodeAvailable(env);
  },
  buildArgs: buildOpencodeRunArgs,
  spawn(args: string[], options: SpawnOptions = {}): ChildProcess {
    return spawnOpencode(args, options);
  },
  createTranslator: createOpencodeTranslator
};
