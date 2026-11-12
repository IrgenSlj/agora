// Git hooks that make receipts automatic: post-commit writes the receipt for
// the new commit, pre-push sends refs/notes/agora along with the push.
//
// Both fail open (AGENTS.md rule 4): a missing `agora`, a log that does not
// verify or a rejected notes push never blocks a commit or a push. Agora's
// lines live in a marked block, so a hook someone else wrote (husky, lefthook)
// is kept, and `core.hooksPath` is honoured.

import { chmodSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFile } from '../atomic-write.js';
import { git } from './git.js';

const BEGIN = '# BEGIN agora';
const END = '# END agora';

export const GIT_HOOKS: Record<'post-commit' | 'pre-push', string> = {
  'post-commit': [
    '# Write the receipt for this commit. Never blocks the commit.',
    'if command -v agora >/dev/null 2>&1; then agora receipt write HEAD >/dev/null 2>&1 || true; fi'
  ].join('\n'),
  'pre-push': [
    '# Send receipts with the push. Never blocks the push.',
    'if [ -z "$AGORA_PUSHING_NOTES" ] && git show-ref -q --verify refs/notes/agora; then',
    '  AGORA_PUSHING_NOTES=1 git push --no-verify -q "$1" refs/notes/agora >/dev/null 2>&1 || true',
    'fi'
  ].join('\n')
};

export function hooksDir(repo: string): string {
  const p = git(repo, ['rev-parse', '--git-path', 'hooks']);
  return p.startsWith('/') ? p : join(repo, p);
}

const block = (body: string) => `${BEGIN}\n${body}\n${END}`;
const SHELL = /^#!.*\b(sh|bash|zsh|dash)\b/;

export type HookChange = {
  hook: string;
  path: string;
  result: 'created' | 'updated' | 'unchanged' | 'skipped';
  why?: string;
};

export function installGitHooks(repo: string): HookChange[] {
  const dir = hooksDir(repo);
  return Object.entries(GIT_HOOKS).map(([hook, body]) => {
    const path = join(dir, hook);
    const ours = block(body);
    if (!existsSync(path)) {
      atomicWriteFile(path, `#!/bin/sh\n${ours}\n`, 0o755);
      return { hook, path, result: 'created' };
    }
    const text = readFileSync(path, 'utf8');
    const at = text.indexOf(BEGIN);
    if (at >= 0) {
      const end = text.indexOf(END, at);
      const next = `${text.slice(0, at)}${ours}${end >= 0 ? text.slice(end + END.length) : '\n'}`;
      if (next === text) return { hook, path, result: 'unchanged' };
      atomicWriteFile(path, next, 0o755);
      return { hook, path, result: 'updated' };
    }
    if (!SHELL.test(text.split('\n')[0] ?? '')) {
      return { hook, path, result: 'skipped', why: 'not a shell script; add the lines yourself' };
    }
    atomicWriteFile(path, `${text.replace(/\n*$/, '\n')}\n${ours}\n`, 0o755);
    chmodSync(path, 0o755);
    return { hook, path, result: 'updated' };
  });
}

export function uninstallGitHooks(repo: string): string[] {
  const dir = hooksDir(repo);
  const removed: string[] = [];
  for (const hook of Object.keys(GIT_HOOKS)) {
    const path = join(dir, hook);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    const at = text.indexOf(BEGIN);
    if (at < 0) continue;
    const end = text.indexOf(END, at);
    const rest = `${text.slice(0, at).replace(/\n+$/, '\n')}${end >= 0 ? text.slice(end + END.length).replace(/^\n+/, '') : ''}`;
    if (rest.trim() === '#!/bin/sh' || rest.trim() === '') rmSync(path);
    else atomicWriteFile(path, rest, 0o755);
    removed.push(hook);
  }
  return removed;
}

export function gitHooksInstalled(repo: string): boolean {
  const dir = hooksDir(repo);
  return Object.keys(GIT_HOOKS).every((h) => {
    const p = join(dir, h);
    return existsSync(p) && readFileSync(p, 'utf8').includes(BEGIN);
  });
}
