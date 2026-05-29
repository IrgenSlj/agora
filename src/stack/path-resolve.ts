import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const KNOWN_RUNNERS = new Set([
  'npx',
  'bunx',
  'uvx',
  'node',
  'python',
  'python3',
  'deno',
  'uv'
]);

function envValue(
  env: Record<string, string | undefined> | undefined,
  names: string[]
): string | undefined {
  const source = env ?? process.env;
  for (const name of names) {
    const value = source[name];
    if (value !== undefined) return value;
  }
  if (process.platform === 'win32') {
    const lowerNames = new Set(names.map((name) => name.toLowerCase()));
    for (const [key, value] of Object.entries(source)) {
      if (lowerNames.has(key.toLowerCase())) return value;
    }
  }
  return undefined;
}

function isAbsoluteCommand(command: string): boolean {
  return command.startsWith('/') || command.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(command);
}

function normalizeWinPath(path: string): string {
  if (process.platform !== 'win32') return path;
  const msys = path.match(/^\/([A-Za-z])\/(.*)$/);
  if (!msys) return path;
  return `${msys[1]}:/${msys[2]}`;
}

/**
 * Returns the absolute path of `command` if found by scanning PATH dirs,
 * else null. Respects PATHEXT on win32. Reads env.PATH or process.env.PATH.
 */
export function resolveOnPath(
  command: string,
  env?: Record<string, string | undefined>
): string | null {
  const extensions =
    process.platform === 'win32'
      ? [
          '',
          ...(envValue(env, ['PATHEXT']) || '.EXE;.CMD;.BAT')
            .split(';')
            .filter(Boolean)
            .map((e) => e.toLowerCase())
        ]
      : [''];

  // If already an absolute path, just check existence.
  if (isAbsoluteCommand(command)) {
    const normalized = normalizeWinPath(command);
    for (const ext of extensions) {
      const candidate = normalized + ext;
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }

  const pathEnv = envValue(env, ['PATH', 'Path', 'path']) || '';
  const dirs = pathEnv.split(process.platform === 'win32' ? ';' : ':').filter(Boolean);

  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = join(normalizeWinPath(dir), command + ext);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}
