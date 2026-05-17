import process from 'node:process';
import { existsSync, readFileSync } from 'node:fs';
import {
  detectAgoraDataDir,
  loadAgoraState,
  getAuthState,
  getAgoraStatePath,
  writeAgoraState,
  type ResolvedSavedItem
} from '../state.js';
import { ensureFreshAccess } from '../auth/refresh.js';
import { dataRefreshedAt } from '../data.js';
import type { Tutorial } from '../types.js';
import type { SourceOptions, SourceResult } from '../live.js';
import type { CliIo, ParsedArgs, OutputStream } from './flags.js';

// ── I/O helpers ──────────────────────────────────────────────────────────────

export function writeLine(stream: OutputStream, value = ''): void {
  stream.write(value.endsWith('\n') ? value : `${value}\n`);
}

export function writeJson(stream: OutputStream, value: unknown): void {
  writeLine(stream, JSON.stringify(value, null, 2));
}

export function usageError(io: CliIo, message: string): number {
  writeLine(io.stderr, message);
  return 1;
}

/**
 * Returns true only when both stdout and stdin are real interactive TTYs AND the
 * environment supports colour (i.e. not NO_COLOR or TERM=dumb). The gate keeps
 * the interactive menu away from pipes, CI, and the test harness, all of which
 * use non-TTY mock streams.
 */
export function isInteractive(io: CliIo, env: Record<string, string | undefined>): boolean {
  if (env.NO_COLOR != null) return false;
  if (env.TERM === 'dumb') return false;
  const stdoutTTY = Boolean((io.stdout as { isTTY?: boolean }).isTTY);
  const stdinTTY = Boolean((process.stdin as { isTTY?: boolean }).isTTY);
  return stdoutTTY && stdinTTY;
}

// ── Flag helpers ─────────────────────────────────────────────────────────────

export function stringFlag(
  parsed: ParsedArgs,
  longName: string,
  shortName?: string
): string | undefined {
  const value = parsed.flags[longName] ?? (shortName ? parsed.flags[shortName] : undefined);
  return typeof value === 'string' ? value : undefined;
}

export function requiredStringFlag(
  parsed: ParsedArgs,
  longName: string,
  shortName?: string
): string | undefined {
  const value = stringFlag(parsed, longName, shortName);
  return value?.trim() || undefined;
}

export function numberFlag(
  parsed: ParsedArgs,
  longName: string,
  shortName?: string
): number | undefined {
  const value = stringFlag(parsed, longName, shortName);
  if (!value) return undefined;
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

export function envString(io: CliIo, name: string): string | undefined {
  const value = io.env?.[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function authTokenInput(parsed: ParsedArgs, io: CliIo): string | undefined {
  return (
    requiredStringFlag(parsed, 'token') ||
    envString(io, 'AGORA_TOKEN') ||
    envString(io, 'AGORA_API_TOKEN')
  );
}

// ── Options helpers ──────────────────────────────────────────────────────────

export function detectDataDir(parsed: ParsedArgs, io: CliIo): string {
  return detectAgoraDataDir({
    explicitDir: stringFlag(parsed, 'dataDir'),
    cwd: io.cwd,
    env: io.env
  });
}

export async function sourceOptions(parsed: ParsedArgs, io: CliIo): Promise<SourceOptions> {
  const explicitApiUrl = stringFlag(parsed, 'apiUrl');
  const envApiUrl = envString(io, 'AGORA_API_URL');
  const dataDir = detectDataDir(parsed, io);
  let state = loadAgoraState(dataDir);
  state = await ensureFreshAccess(state, { dataDir, fetcher: io.fetcher });
  const storedAuth = getAuthState(state);
  const storedApiUrl = storedAuth?.apiUrl;
  const apiUrl = explicitApiUrl || envApiUrl || storedApiUrl || '';
  const useApi =
    explicitApiUrl !== undefined ||
    envApiUrl !== undefined ||
    storedApiUrl !== undefined ||
    Boolean(parsed.flags.api) ||
    Boolean(parsed.flags.live);
  return {
    useApi,
    apiUrl,
    token: authTokenInput(parsed, io) || storedAuth?.accessToken,
    fetcher: io.fetcher,
    timeoutMs: numberFlag(parsed, 'apiTimeout')
  };
}

export async function writeSourceOptions(
  parsed: ParsedArgs,
  io: CliIo
): Promise<{ ok: true; options: SourceOptions } | { ok: false; error: string }> {
  const options = await sourceOptions(parsed, io);
  if (!options.apiUrl) {
    return {
      ok: false,
      error: 'This command requires --api-url, AGORA_API_URL, or an auth login API URL'
    };
  }
  if (!options.token) {
    return {
      ok: false,
      error: 'This command requires --token, AGORA_TOKEN, AGORA_API_TOKEN, or agora auth login'
    };
  }
  return { ok: true, options: { ...options, useApi: true } };
}

export async function readSourceOptions(
  parsed: ParsedArgs,
  io: CliIo
): Promise<{ ok: true; options: SourceOptions } | { ok: false; error: string }> {
  const options = await sourceOptions(parsed, io);
  if (!options.apiUrl) {
    return {
      ok: false,
      error: 'This command requires --api-url, AGORA_API_URL, or an auth login API URL'
    };
  }
  return { ok: true, options: { ...options, useApi: true } };
}

// ── Source display helpers ──────────────────────────────────────────────────

export function sourceLabel(result: { source: string }): string {
  return result.source === 'offline'
    ? `source: offline · refreshed ${dataRefreshedAt}`
    : `source: ${result.source}`;
}

export function warnFallback<T>(result: SourceResult<T>, io: CliIo): void {
  if (result.fallbackReason) {
    writeLine(io.stderr, `Warning: API unavailable — using offline data (cached ${dataRefreshedAt})`);
    writeLine(io.stderr, `  Reason: ${result.fallbackReason}`);
  }
}

export function sourcePayload<T extends object, TValue>(
  result: SourceResult<TValue>,
  payload: T
): T & {
  source: string;
  apiUrl?: string;
  fallbackReason?: string;
} {
  return {
    source: result.source,
    apiUrl: result.apiUrl,
    fallbackReason: result.fallbackReason,
    ...payload
  };
}

// ── Auth display helpers ────────────────────────────────────────────────────

export function maskToken(token: string): string {
  const value = token.trim();
  if (value.length <= 4) return '****';
  if (value.length <= 8) return `${'*'.repeat(value.length - 4)}${value.slice(-4)}`;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function formatRelativeExp(exp: number, nowSec: number): string {
  if (exp === 0) return 'unknown';
  const diff = exp - nowSec;
  if (diff <= 0) return 'expired';
  if (diff < 3600) return `${Math.round(diff / 60)}m`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h`;
  return `${Math.round(diff / 86400)}d`;
}

export function authStatusPayload(
  dataDir: string,
  auth: ReturnType<typeof getAuthState>
): {
  dataDir: string;
  statePath: string;
  authenticated: boolean;
  accessTokenPreview?: string;
  accessExp?: number;
  refreshTokenPreview?: string;
  refreshExp?: number;
  apiUrl?: string;
  savedAt?: string;
} {
  return {
    dataDir,
    statePath: getAgoraStatePath(dataDir),
    authenticated: Boolean(auth),
    accessTokenPreview: auth ? maskToken(auth.accessToken) : undefined,
    accessExp: auth?.accessExp,
    refreshTokenPreview: auth?.refreshToken ? maskToken(auth.refreshToken) : undefined,
    refreshExp: auth?.refreshExp,
    apiUrl: auth?.apiUrl,
    savedAt: auth?.savedAt
  };
}

// ── Search helpers ──────────────────────────────────────────────────────────

export function matchesSavedQuery(entry: ResolvedSavedItem, query: string): boolean {
  if (!query) return true;

  const searchable = entry.item
    ? [
        entry.item.id,
        entry.item.name,
        entry.item.description,
        entry.item.author,
        entry.item.category,
        ...entry.item.tags
      ].join(' ')
    : entry.saved.id;

  return searchable.toLowerCase().includes(query);
}

// ── Tutorial helpers ────────────────────────────────────────────────────────

export function tutorialLevelFlag(
  parsed: ParsedArgs
): { ok: true; value: string } | { ok: false; error: string } {
  const level = stringFlag(parsed, 'level') || 'all';
  if (level === 'all' || level === 'beginner' || level === 'intermediate' || level === 'advanced') {
    return { ok: true, value: level };
  }
  return { ok: false, error: 'tutorial level must be beginner, intermediate, advanced, or all' };
}

export function tutorialStepNumber(
  parsed: ParsedArgs
): { ok: true; value: number } | { ok: false; error: string } {
  const rawStep = parsed.args[1] || stringFlag(parsed, 'step');
  if (!rawStep) return { ok: true, value: 1 };

  const step = Number(rawStep);
  if (!Number.isInteger(step) || step < 1) {
    return { ok: false, error: 'tutorial step must be a positive integer' };
  }

  return { ok: true, value: step };
}

export function tutorialStepPayload(
  tutorial: Tutorial,
  stepNumber: number
): {
  stepNumber: number;
  totalSteps: number;
  completed: boolean;
  title?: string;
  content?: string;
  code?: string;
} {
  const step = tutorial.steps[stepNumber - 1];

  return {
    stepNumber,
    totalSteps: tutorial.steps.length,
    completed: !step,
    title: step?.title,
    content: step?.content,
    code: step?.code
  };
}

// ── Input helpers ───────────────────────────────────────────────────────────

export function tagsFlag(parsed: ParsedArgs): string[] {
  const value = stringFlag(parsed, 'tags');
  if (!value) return [];
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function promptInput(parsed: ParsedArgs, io: CliIo): string | undefined {
  const prompt = stringFlag(parsed, 'prompt');
  if (prompt) return prompt;

  const promptFile = stringFlag(parsed, 'promptFile');
  if (!promptFile) return undefined;

  if (!existsSync(promptFile)) {
    usageError(io, `prompt-file not found: ${promptFile}`);
    return undefined;
  }

  return readFileSync(promptFile, 'utf8');
}

export function contentInput(parsed: ParsedArgs, io: CliIo): string | undefined {
  const content = requiredStringFlag(parsed, 'content');
  if (content) return content;

  const contentFile = stringFlag(parsed, 'contentFile');
  if (!contentFile) return undefined;

  if (!existsSync(contentFile)) {
    usageError(io, `content-file not found: ${contentFile}`);
    return undefined;
  }

  return readFileSync(contentFile, 'utf8').trim();
}

export function itemTypeFlag(parsed: ParsedArgs, itemId: string): 'package' | 'workflow' {
  const type = stringFlag(parsed, 'type', 't');
  if (type === 'workflow' || itemId.startsWith('wf-')) return 'workflow';
  return 'package';
}

export function discussionCategoryFlag(
  parsed: ParsedArgs
): { ok: true; value: string } | { ok: false; error: string } {
  const category = stringFlag(parsed, 'category', 'c') || 'discussion';
  if (
    category === 'question' ||
    category === 'idea' ||
    category === 'showcase' ||
    category === 'discussion'
  ) {
    return { ok: true, value: category };
  }
  return {
    ok: false,
    error: 'discussion category must be question, idea, showcase, or discussion'
  };
}

// ── Chat helpers ────────────────────────────────────────────────────────────

export function extractSessionId(line: string): string | null {
  try {
    const ev = JSON.parse(line);
    if (ev.sessionID && typeof ev.sessionID === 'string') return ev.sessionID;
  } catch {
    /* not JSON, skip */
  }
  return null;
}

export function persistChatSession(dataDir: string, sessionId: string): void {
  try {
    const state = loadAgoraState(dataDir);
    const updated = {
      ...state,
      _meta: { ...((state as any)._meta || {}), lastChatSession: sessionId }
    };
    writeAgoraState(dataDir, updated);
  } catch {
    // best-effort
  }
}

export function loadLastChatSession(dataDir: string): string | undefined {
  try {
    const state = loadAgoraState(dataDir);
    return (state as any)._meta?.lastChatSession;
  } catch {
    return undefined;
  }
}
