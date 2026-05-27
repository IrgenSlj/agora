import { execSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';

export const SHELL_BUILTINS = new Set(['cd', 'export', 'alias', 'source', 'unset', 'umask', 'exec']);
export const MAX_BASH_BUFFER = 16 * 1024;

export function makeExecutableChecker(pathEnv: string | undefined): (name: string) => boolean {
  const cache = new Map<string, boolean>();
  const dirs = (pathEnv ?? '').split(':').filter(Boolean);

  return function isExecutable(name: string): boolean {
    if (cache.has(name)) return cache.get(name)!;
    if (name.includes('/')) {
      cache.set(name, false);
      return false;
    }
    for (const dir of dirs) {
      const full = join(dir, name);
      try {
        if (existsSync(full)) {
          const st = statSync(full);
          if (st.isFile() && (st.mode & 0o111) !== 0) {
            cache.set(name, true);
            return true;
          }
        }
      } catch {
        // skip
      }
    }
    cache.set(name, false);
    return false;
  };
}

export function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

export function tailBuffer(buf: string, maxBytes: number): string {
  if (buf.length <= maxBytes) return buf;
  return buf.slice(buf.length - maxBytes);
}

export function shortCwd(p: string): string {
  const home = homedir();
  const withTilde = p.startsWith(home) ? '~' + p.slice(home.length) : p;
  if (withTilde.length <= 30) return withTilde;
  const parts = withTilde.split(sep).filter(Boolean);
  if (parts.length <= 2) return withTilde;
  return '…' + sep + parts.slice(-2).join(sep);
}

export function checkOpencodeAvailable(): boolean {
  try {
    execSync('which opencode', { stdio: 'pipe', timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

export function extractFirstBashBlock(text: string): string | null {
  const match = text.match(/```(?:bash|sh|shell)\n([\s\S]*?)```/);
  return match ? match[1].trim() : null;
}

export function readOneKey(): Promise<string> {
  return new Promise<string>((resolve) => {
    const stdin = process.stdin;
    const wasRaw = (stdin as any).isRaw ?? false;
    if ((stdin as any).setRawMode) (stdin as any).setRawMode(true);
    stdin.resume();
    function onData(buf: Buffer) {
      stdin.removeListener('data', onData);
      if ((stdin as any).setRawMode) (stdin as any).setRawMode(wasRaw);
      resolve(buf.toString()[0] ?? '');
    }
    stdin.on('data', onData);
  });
}

export function copyToClipboard(text: string): void {
  try {
    const cmd = process.platform === 'darwin' ? 'pbcopy' : 'xclip -selection clipboard';
    execSync(cmd, { input: text, stdio: ['pipe', 'ignore', 'ignore'], timeout: 3000 });
  } catch {
    // fall back silently
  }
}
