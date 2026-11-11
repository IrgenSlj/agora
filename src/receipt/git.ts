// The few git operations receipts need, through the git binary.

import { execFileSync } from 'node:child_process';

export function git(cwd: string, args: string[], input?: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024
  }).trimEnd();
}

export function tryGit(cwd: string, args: string[], input?: string): string | undefined {
  try {
    return git(cwd, args, input);
  } catch {
    return undefined;
  }
}

export function repoRoot(cwd: string): string | undefined {
  return tryGit(cwd, ['rev-parse', '--show-toplevel']);
}

export function resolveCommit(cwd: string, rev: string): string | undefined {
  const sha = tryGit(cwd, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
  return sha && /^[0-9a-f]{40}$/.test(sha) ? sha : undefined;
}

/** Committer time in ms, and the first parent's (undefined for a root commit). */
export function commitWindow(cwd: string, sha: string): { from?: number; to: number } {
  const to = Number(git(cwd, ['show', '-s', '--format=%ct', sha])) * 1000;
  const parent = tryGit(cwd, ['rev-parse', '--verify', '--quiet', `${sha}^1`]);
  const from = parent ? Number(git(cwd, ['show', '-s', '--format=%ct', parent])) * 1000 : undefined;
  return { ...(from !== undefined ? { from } : {}), to };
}

/** A file's bytes at a commit, or undefined when it does not exist there. */
export function fileAt(cwd: string, sha: string, path: string): Buffer | undefined {
  try {
    return execFileSync('git', ['show', `${sha}:${path}`], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore']
    });
  } catch {
    return undefined;
  }
}

export const NOTES_REF = 'refs/notes/agora';

export function readNote(cwd: string, sha: string): string | undefined {
  return tryGit(cwd, ['notes', `--ref=${NOTES_REF}`, 'show', sha]);
}

export function writeNote(cwd: string, sha: string, body: string): void {
  git(cwd, ['notes', `--ref=${NOTES_REF}`, 'add', '-f', '-F', '-', sha], body);
}

/** Commits in `base..head`, oldest first. */
export function commitsIn(cwd: string, range: string): string[] {
  const out = git(cwd, ['rev-list', '--reverse', range]);
  return out ? out.split('\n') : [];
}
