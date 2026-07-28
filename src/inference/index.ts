// Provider selection.
//
// Order matters and is not arbitrary: the free provider wins by default, so
// `agora` never quietly spends someone's Claude quota because it happened to
// be installed. Choosing Claude is an explicit act — `AGORA_INFERENCE=claude`.

import { claudeProvider } from './claude.js';
import { opencodeProvider } from './opencode.js';
import type { InferenceProvider } from './types.js';

export const PROVIDERS: readonly InferenceProvider[] = [opencodeProvider, claudeProvider];

export interface SelectProviderOptions {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /** Explicit choice, e.g. from a `--provider` flag. Beats the env var. */
  preferred?: string;
}

export interface ProviderSelection {
  provider: InferenceProvider | null;
  /**
   * Set when a provider was explicitly asked for but cannot be used. The caller
   * must surface this rather than silently falling back — quietly answering
   * with a different model than the one requested is its own kind of lie.
   */
  problem?: string;
}

/**
 * Picks the provider to run a prompt with.
 *
 * An explicit request that is unavailable is reported, never substituted. With
 * no request, the first *available* provider in `PROVIDERS` order wins, which
 * puts the zero-cost one first.
 */
export function selectProvider(options: SelectProviderOptions = {}): ProviderSelection {
  const env = options.env ?? process.env;
  const requested = options.preferred ?? env['AGORA_INFERENCE'];

  if (requested) {
    const provider = PROVIDERS.find((p) => p.id === requested);
    if (!provider) {
      const known = PROVIDERS.map((p) => p.id).join(', ');
      return {
        provider: null,
        problem: `Unknown inference provider "${requested}". Use: ${known}.`
      };
    }
    if (!provider.isAvailable(env)) {
      return {
        provider: null,
        problem: `${provider.label} is not installed. ${provider.installHint}`
      };
    }
    return { provider };
  }

  const available = PROVIDERS.find((p) => p.isAvailable(env));
  if (available) return { provider: available };

  return {
    provider: null,
    problem: `No inference provider found. ${PROVIDERS.map((p) => p.installHint).join(' · ')}`
  };
}

export { claudeProvider } from './claude.js';
export { opencodeProvider } from './opencode.js';
export type {
  InferenceProvider,
  ProviderId,
  RunPromptInput,
  StreamTranslator
} from './types.js';
