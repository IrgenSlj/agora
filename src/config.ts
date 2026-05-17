import type { Package } from './types.js';

export interface OpenCodeConfig {
  $schema?: string;
  mcp?: Record<
    string,
    {
      type: 'local';
      command: string[];
      environment?: Record<string, string>;
      enabled?: boolean;
      timeout?: number;
    }
  >;
  plugin?: string[];
}

export interface ConfigWriterOptions {
  includeExisting?: boolean;
}

export function generateMcpConfig(
  pkg: Package,
  existingConfig: OpenCodeConfig = {}
): OpenCodeConfig {
  if (!pkg.npmPackage) {
    throw new Error(`${pkg.name} has no npm package to install`);
  }

  const newConfig: OpenCodeConfig = {
    $schema: 'https://opencode.ai/config.json',
    mcp: {
      ...(existingConfig.mcp || {}),
      [pkg.id]: {
        type: 'local',
        command: ['npx', pkg.npmPackage],
        enabled: true
      }
    },
    plugin: existingConfig.plugin || []
  };

  return newConfig;
}

export function formatConfigJson(config: OpenCodeConfig): string {
  return JSON.stringify(config, null, 2);
}

export function parseOpenCodeConfig(content: string): OpenCodeConfig | null {
  try {
    return JSON.parse(content) as OpenCodeConfig;
  } catch {
    return null;
  }
}

const SKIP_EXECUTABLES = new Set(['npx', 'tsx', 'node', 'bun', 'deno']);

export function extractPackageFromConfig(config: OpenCodeConfig): string[] {
  const packages: string[] = [];

  if (config.mcp) {
    for (const [_name, server] of Object.entries(config.mcp)) {
      for (const part of server.command) {
        if (SKIP_EXECUTABLES.has(part)) continue;
        if (part.startsWith('@') || /^[a-z0-9][\w.-]*$/i.test(part)) {
          packages.push(part);
          break;
        }
      }
    }
  }

  return packages;
}


