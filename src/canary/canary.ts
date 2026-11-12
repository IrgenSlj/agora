// Canaries: decoys no legitimate task needs, so any touch is a signal.
//
// `agora canary install` plants a credential file with fresh fake keys and
// hides it from git through `.git/info/exclude`, so it is never committed or
// pushed. The hook denies any tool call that reads or writes it, or any shell
// command that names it, and records a `canary` event; a receipt counts those
// and `agora ci` fails on them.
//
// Limits, stated: a program that opens the file without naming it on the
// command line (a script, `cat .env*`) is not seen, because hooks see a shell
// command's text and not the files it opens.

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { atomicWriteFile } from '../atomic-write.js';

export const CANARY_STATE = '.agora/canaries.json';
export const DEFAULT_CANARY_FILE = '.env.production.local';

export interface CanaryState {
  /** Repository-relative path of the decoy credential file. */
  file?: string;
  installed?: string;
}

export function readCanaries(root: string): CanaryState {
  try {
    const parsed = JSON.parse(readFileSync(join(root, CANARY_STATE), 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function token(n: number, alphabet = ALNUM): string {
  const bytes = randomBytes(n);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

/** Fake but plausible credentials, unique per install so a leak can be traced. */
export function decoyContent(): string {
  const lower = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return [
    '# Production deploy credentials',
    `AWS_ACCESS_KEY_ID=AKIA${token(16)}`,
    `AWS_SECRET_ACCESS_KEY=${token(40, `${ALNUM}${lower}`)}`,
    `DATABASE_URL=postgres://deploy:${token(24, lower)}@db.internal:5432/prod`,
    `STRIPE_SECRET_KEY=sk_live_${token(32, `${ALNUM}${lower}`)}`,
    ''
  ].join('\n');
}

function excludeFile(root: string): string {
  const rel = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], {
    cwd: root,
    encoding: 'utf8'
  }).trim();
  return rel.startsWith('/') ? rel : join(root, rel);
}

function setExcluded(root: string, file: string, on: boolean): void {
  const path = excludeFile(root);
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split('\n') : [];
  const entry = `/${file}`;
  const has = lines.includes(entry);
  if (on === has) return;
  const next = on
    ? [...lines.filter((l, i) => l || i < lines.length - 1), entry, '']
    : lines.filter((l) => l !== entry);
  atomicWriteFile(path, next.join('\n'), 0o644);
}

export type InstallResult =
  | { status: 'installed'; file: string }
  | { status: 'exists'; file: string };

export function installCanary(root: string, file = DEFAULT_CANARY_FILE): InstallResult {
  const state = readCanaries(root);
  if (state.file && existsSync(join(root, state.file)))
    return { status: 'exists', file: state.file };
  if (existsSync(join(root, file))) return { status: 'exists', file };
  atomicWriteFile(join(root, file), decoyContent(), 0o600);
  setExcluded(root, file, true);
  atomicWriteFile(
    join(root, CANARY_STATE),
    `${JSON.stringify({ ...state, file, installed: new Date().toISOString() }, null, 2)}\n`,
    0o644
  );
  return { status: 'installed', file };
}

export function removeCanary(root: string): string | undefined {
  const state = readCanaries(root);
  if (!state.file) return undefined;
  rmSync(join(root, state.file), { force: true });
  setExcluded(root, state.file, false);
  rmSync(join(root, CANARY_STATE), { force: true });
  return state.file;
}

/**
 * The canary a tool call touches, if any: a file event on the decoy, or a
 * shell command whose text names it. `subjects` are normalised event subjects;
 * `command` is the raw command text, read here and never stored.
 */
export function canaryHit(
  state: CanaryState,
  subjects: readonly { kind: string; subject: string }[],
  command: string | undefined
): string | undefined {
  const file = state.file;
  if (!file) return undefined;
  for (const s of subjects) {
    if ((s.kind === 'file_read' || s.kind === 'file_write') && s.subject === file) return file;
  }
  if (command?.includes(basename(file))) return file;
  return undefined;
}
