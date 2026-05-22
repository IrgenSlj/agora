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

/**
 * Returns the absolute path of `command` if found by scanning PATH dirs,
 * else null. Respects PATHEXT on win32. Reads env.PATH or process.env.PATH.
 */
export function resolveOnPath(
  command: string,
  env?: Record<string, string | undefined>
): string | null {
  // If already an absolute path, just check existence
  if (command.startsWith('/') || command.startsWith('\\')) {
    return existsSync(command) ? command : null;
  }

  const pathEnv = (env?.PATH ?? process.env.PATH) || '';
  const dirs = pathEnv.split(process.platform === 'win32' ? ';' : ':').filter(Boolean);

  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase())
      : [''];

  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = join(dir, command + ext);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}
