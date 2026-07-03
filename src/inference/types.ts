/**
 * Inference provider abstraction (P4). Agora owns no inference — it routes to
 * one of three tiers behind this single interface:
 *
 *   - opencode: existing spawnOpencode / OpenCode SDK path. Default; free; zero login.
 *   - claude:   Claude Agent SDK, authenticating with a user-supplied ANTHROPIC_API_KEY.
 *               Subscription / claude.ai login is NOT available to third-party Agent SDK
 *               apps as of 2026-07 (see docs/OPEN_QUESTIONS.md OQ-1) — bring your own key.
 *   - ollama:   OpenAI-compatible local endpoint (default http://localhost:11434).
 *
 * Credentials live in settings, NEVER in agora.toml (profiles must be shareable).
 * All AI-touching features (acquire suggestions, feed summarization, `agora ask`)
 * route through this abstraction.
 */

export type ProviderId = 'opencode' | 'claude' | 'ollama';

export interface CompletionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  messages: CompletionMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface CompletionResult {
  text: string;
  model: string;
  provider: ProviderId;
}

export interface ProviderCapabilities {
  /** Streaming supported. */
  streaming: boolean;
  /** Whether the provider is configured + reachable right now. */
  available: boolean;
  /** Default model id for this provider. */
  defaultModel?: string;
  /** Human note for the Connect UI (e.g. "advanced — bring your own API key"). */
  note?: string;
}

export interface Provider {
  id: ProviderId;
  displayName: string;
  capabilities(env: ProviderEnv): ProviderCapabilities | Promise<ProviderCapabilities>;
  complete(req: CompletionRequest, env: ProviderEnv): Promise<CompletionResult>;
  stream(req: CompletionRequest, env: ProviderEnv): AsyncIterable<string>;
}

export interface ProviderSettings {
  /** Env var name holding the Claude API key + optional default model. */
  claude?: { apiKeyEnv?: string; model?: string };
  /** Ollama endpoint + model. */
  ollama?: { baseUrl?: string; model?: string };
  /** Which provider AI-touching features prefer. */
  preferred?: ProviderId;
}

export interface ProviderEnv {
  home?: string;
  env?: Record<string, string | undefined>;
  settings?: ProviderSettings;
}
