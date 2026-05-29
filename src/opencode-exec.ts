import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { extname } from 'node:path';
import process from 'node:process';
import { resolveOnPath } from './stack/path-resolve.js';

export interface BuildOpencodeRunArgsInput {
  model: string;
  prompt: string;
  sessionId?: string | null;
  format?: 'json' | 'text';
  continueSession?: boolean;
}

export class OpencodeNotFoundError extends Error {
  constructor() {
    super('opencode binary not found');
    this.name = 'OpencodeNotFoundError';
  }
}

const resolveCache = new Map<string, string | null>();

function envValue(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  names: string[]
): string {
  for (const name of names) {
    const value = env[name];
    if (value !== undefined) return value;
  }
  if (process.platform === 'win32') {
    const lowerNames = new Set(names.map((name) => name.toLowerCase()));
    for (const [key, value] of Object.entries(env)) {
      if (lowerNames.has(key.toLowerCase())) return value ?? '';
    }
  }
  return '';
}

function resolveCacheKey(env: NodeJS.ProcessEnv | Record<string, string | undefined>): string {
  return [
    process.platform,
    envValue(env, ['PATH', 'Path', 'path']),
    envValue(env, ['PATHEXT', 'PathExt', 'pathext'])
  ].join('\0');
}

export function normalizeOpencodeModel(model: string): string {
  return model.includes('/') ? model : `opencode/${model}`;
}

export function buildOpencodeRunArgs(input: BuildOpencodeRunArgsInput): string[] {
  const args = [
    'run',
    '--format',
    input.format ?? 'json',
    '--model',
    normalizeOpencodeModel(input.model)
  ];
  if (input.sessionId) {
    args.push('--session', input.sessionId);
  } else if (input.continueSession) {
    args.push('--continue');
  }
  args.push(input.prompt);
  return args;
}

export function resolveOpencode(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): string | null {
  const key = resolveCacheKey(env);
  if (resolveCache.has(key)) return resolveCache.get(key)!;
  const resolved = resolveOnPath('opencode', env);
  resolveCache.set(key, resolved);
  return resolved;
}

export function isOpencodeAvailable(
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
): boolean {
  return resolveOpencode(env) !== null;
}

export function quoteWinArg(arg: string): string {
  if (arg.length === 0) return '""';
  if (!/[\s"^&|<>()%!]/.test(arg)) return arg;
  return `"${arg.replace(/(["^&|<>()%!])/g, '^$1')}"`;
}

export function spawnOpencode(args: string[], options: SpawnOptions = {}): ChildProcess {
  const env = options.env ?? process.env;
  const resolved = resolveOpencode(env);
  if (!resolved) throw new OpencodeNotFoundError();

  if (process.platform === 'win32') {
    const ext = extname(resolved).toLowerCase();
    if (ext === '.cmd' || ext === '.bat') {
      const comspec = envValue(env, ['ComSpec', 'COMSPEC']) || 'cmd.exe';
      return spawn(
        comspec,
        ['/d', '/s', '/v:off', '/c', quoteWinArg(resolved), ...args.map(quoteWinArg)],
        {
          ...options,
          shell: false,
          windowsVerbatimArguments: true
        }
      );
    }
  }

  return spawn(resolved, args, { ...options, shell: false });
}
