import { detectAgoraDataDir } from '../state.js';
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

// ── Flag helpers ─────────────────────────────────────────────────────────────

export function stringFlag(
  parsed: ParsedArgs,
  longName: string,
  shortName?: string
): string | undefined {
  const value = parsed.flags[longName] ?? (shortName ? parsed.flags[shortName] : undefined);
  return typeof value === 'string' ? value : undefined;
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

// ── Options helpers ──────────────────────────────────────────────────────────

export function detectDataDir(parsed: ParsedArgs, io: CliIo): string {
  return detectAgoraDataDir({
    explicitDir: stringFlag(parsed, 'dataDir'),
    cwd: io.cwd,
    env: io.env
  });
}
