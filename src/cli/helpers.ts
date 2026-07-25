import process from 'node:process';
import { dataRefreshedAt } from '../data.js';
import type { SourceOptions, SourceResult } from '../live.js';
import { detectAgoraDataDir, type ResolvedSavedItem } from '../state.js';
import { ExitCode } from './exit-codes.js';
import type { CliIo, OutputStream, ParsedArgs } from './flags.js';

// ── I/O helpers ──────────────────────────────────────────────────────────────

export function writeLine(stream: OutputStream, value = ''): void {
  stream.write(value.endsWith('\n') ? value : `${value}\n`);
}

export function writeJson(stream: OutputStream, value: unknown): void {
  writeLine(stream, JSON.stringify(value, null, 2));
}

export function usageError(io: CliIo, message: string): number {
  writeLine(io.stderr, message);
  return ExitCode.USAGE;
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

/**
 * Token for the optional `AGORA_API_URL` catalog mirror. Read from flags/env
 * only — Agora has no accounts, no login, and stores no credentials.
 */
export function apiTokenInput(parsed: ParsedArgs, io: CliIo): string | undefined {
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
  const apiUrl = explicitApiUrl || envApiUrl || '';
  const useApi =
    explicitApiUrl !== undefined ||
    envApiUrl !== undefined ||
    Boolean(parsed.flags.api) ||
    Boolean(parsed.flags.live);
  return {
    useApi,
    apiUrl,
    token: apiTokenInput(parsed, io),
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
      error: 'This command requires --api-url or AGORA_API_URL'
    };
  }
  if (!options.token) {
    return {
      ok: false,
      error: 'This command requires --token, AGORA_TOKEN, or AGORA_API_TOKEN'
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
      error: 'This command requires --api-url or AGORA_API_URL'
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
    writeLine(
      io.stderr,
      `Warning: API unavailable — using offline data (cached ${dataRefreshedAt})`
    );
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
