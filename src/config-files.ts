import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
  extractPackageFromConfig,
  formatConfigJson,
  parseOpenCodeConfig,
  type OpenCodeConfig
} from './config.js';

export interface ConfigPathOptions {
  explicitPath?: string;
  cwd?: string;
  home?: string;
  env?: Record<string, string | undefined>;
}

export interface LoadedConfig {
  path: string;
  exists: boolean;
  config: OpenCodeConfig;
  error?: string;
}

export interface ConfigDoctorReport {
  path: string;
  exists: boolean;
  valid: boolean;
  error?: string;
  mcpServers: number;
  plugins: number;
  packages: string[];
}

export function detectOpenCodeConfigPath(options: ConfigPathOptions = {}): string {
  const cwd = options.cwd || process.cwd();
  const home = options.home || homedir();
  const env = options.env || process.env;
  const configured = options.explicitPath || env.OPENCODE_CONFIG || env.OPENCODE_CONFIG_PATH;

  if (configured) {
    return resolvePath(configured, cwd, home);
  }

  const candidates = [
    join(cwd, 'opencode.json'),
    join(home, '.config', 'opencode', 'opencode.json'),
    join(home, '.opencode.json')
  ];

  return candidates.find((candidate) => existsSync(candidate)) || candidates[1];
}

export function loadOpenCodeConfig(configPath: string): LoadedConfig {
  if (!existsSync(configPath)) {
    return {
      path: configPath,
      exists: false,
      config: {}
    };
  }

  try {
    const content = readFileSync(configPath, 'utf8');
    const parsed = parseOpenCodeConfig(content);

    if (!parsed) {
      return {
        path: configPath,
        exists: true,
        config: {},
        error: 'Config file is not valid JSON'
      };
    }

    return {
      path: configPath,
      exists: true,
      config: parsed
    };
  } catch (error) {
    return {
      path: configPath,
      exists: true,
      config: {},
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function writeOpenCodeConfig(configPath: string, config: OpenCodeConfig): void {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${formatConfigJson(config)}\n`, 'utf8');
}

export function doctorOpenCodeConfig(configPath: string): ConfigDoctorReport {
  const loaded = loadOpenCodeConfig(configPath);
  const mcpServers = Object.keys(loaded.config.mcpServers || {}).length;
  const plugins = loaded.config.plugins?.length || 0;

  return {
    path: loaded.path,
    exists: loaded.exists,
    valid: !loaded.error,
    error: loaded.error,
    mcpServers,
    plugins,
    packages: extractPackageFromConfig(loaded.config)
  };
}

function resolvePath(filePath: string, cwd: string, home: string): string {
  const expanded = filePath === '~' || filePath.startsWith('~/')
    ? join(home, filePath.slice(2))
    : filePath;

  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}
