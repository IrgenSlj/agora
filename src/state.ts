import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export interface StatePathOptions {
  explicitDir?: string;
  cwd?: string;
  home?: string;
  env?: Record<string, string | undefined>;
}

/** Agora's data directory: `$AGORA_HOME`, else `$XDG_CONFIG_HOME/agora`, else `~/.config/agora`. */
export function detectAgoraDataDir(options: StatePathOptions = {}): string {
  const cwd = options.cwd || process.cwd();
  const home = options.home || homedir();
  const env = options.env || process.env;
  const configured = options.explicitDir || env.AGORA_HOME;
  if (configured) return resolvePath(configured, cwd, home);
  const xdg = env.XDG_CONFIG_HOME
    ? resolvePath(env.XDG_CONFIG_HOME, cwd, home)
    : join(home, '.config');
  return join(xdg, 'agora');
}

function resolvePath(value: string, cwd: string, home: string): string {
  if (value === '~') return home;
  if (value.startsWith('~/')) return join(home, value.slice(2));
  return isAbsolute(value) ? value : resolve(cwd, value);
}
