import type { Package, Workflow } from './types.js';

export interface OpenCodeConfig {
  $schema?: string;
  mcpServers?: Record<string, {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
  plugins?: string[];
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
    mcpServers: {
      ...(existingConfig.mcpServers || {}),
      [pkg.id]: {
        command: 'npx',
        args: [pkg.npmPackage],
        env: {}
      }
    },
    plugins: existingConfig.plugins || []
  };

  return newConfig;
}

export function generateWorkflowConfig(
  wf: Workflow,
  existingConfig: OpenCodeConfig = {}
): OpenCodeConfig {
  const skillName = wf.id.replace('wf-', 'skill-');
  
  return {
    $schema: 'https://opencode.ai/config.json',
    mcpServers: existingConfig.mcpServers || {},
    plugins: [...(existingConfig.plugins || []), skillName]
  };
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

export function extractPackageFromConfig(config: OpenCodeConfig): string[] {
  const packages: string[] = [];
  
  if (config.mcpServers) {
    for (const [_name, server] of Object.entries(config.mcpServers)) {
      if (server.args?.[0]?.startsWith('@')) {
        packages.push(server.args[0]);
      }
    }
  }
  
  return packages;
}

export function validatePackageName(name: string): { valid: boolean; error?: string } {
  if (!name) {
    return { valid: false, error: 'Package name is required' };
  }
  
  if (name.startsWith('@')) {
    const scoped = name.split('/');
    if (scoped.length !== 2) {
      return { valid: false, error: 'Invalid scoped package name' };
    }
  } else if (!/^[a-zA-Z0-9-_]+$/.test(name)) {
    return { valid: false, error: 'Package name contains invalid characters' };
  }
  
  return { valid: true };
}

export function getInstallInstructions(pkg: Package): string[] {
  const instructions: string[] = [];
  
  if (pkg.npmPackage) {
    instructions.push(`npm install -g ${pkg.npmPackage}`);
  }
  
  const config = generateMcpConfig(pkg);
  instructions.push(`\nAdd to opencode.json:\n${formatConfigJson(config)}`);
  
  return instructions;
}
