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

export const SKIP_EXECUTABLES = new Set(['npx', 'tsx', 'node', 'bun', 'deno']);

export function extractPackageFromConfig(config: OpenCodeConfig): string[] {
  const packages: string[] = [];

  if (config.mcp) {
    for (const [_name, server] of Object.entries(config.mcp)) {
      // A host config is a file people edit by hand, so an entry with no
      // `command` is ordinary — and it is exactly what `config doctor --fix`
      // exists to clean up. Reading it must not throw, or the doctor crashes on
      // the one config that needs it.
      if (!Array.isArray(server?.command)) continue;
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
