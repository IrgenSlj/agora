import { existsSync, readFileSync } from 'node:fs';

/** The part of `opencode.json` Agora reads. */
export interface OpenCodeConfig {
  $schema?: string;
  mcp?: Record<
    string,
    {
      type: 'local' | 'remote';
      command?: string[];
      url?: string;
      environment?: Record<string, string>;
      enabled?: boolean;
      timeout?: number;
    }
  >;
  plugin?: string[];
}

export interface LoadedConfig {
  path: string;
  exists: boolean;
  config: OpenCodeConfig;
  error?: string;
}

/** Reads an opencode.json. A missing or unparseable file yields an empty config and a reason. */
export function loadOpenCodeConfig(configPath: string): LoadedConfig {
  if (!existsSync(configPath)) return { path: configPath, exists: false, config: {} };
  try {
    return { path: configPath, exists: true, config: JSON.parse(readFileSync(configPath, 'utf8')) };
  } catch (error) {
    return {
      path: configPath,
      exists: true,
      config: {},
      error: error instanceof Error ? error.message : 'Config file is not valid JSON'
    };
  }
}
