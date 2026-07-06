import type { Hooks, PluginInput, PluginOptions } from '@opencode-ai/plugin';
import { readCapabilityCache } from '../stack/capability-cache.js';
import { groupServersByName, readAllServers } from '../stack/registry.js';
import type { ConfiguredServer, StackEnv } from '../stack/types.js';
import { detectAgoraDataDir } from '../state.js';

export interface AgoraPluginConfig {
  suggestAcquire: boolean;
  stackMemory: boolean;
}

export interface CapabilitySuggestion {
  id: string;
  query: string;
  reason: string;
}

function optionEnabled(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true' || value === '1' || value === 'yes';
  return fallback;
}

export function parsePluginOptions(options?: PluginOptions): AgoraPluginConfig {
  return {
    suggestAcquire: optionEnabled(
      options?.suggestAcquire ?? options?.acquireSuggestions ?? options?.capabilitySuggestions,
      false
    ),
    stackMemory: optionEnabled(options?.stackMemory, true)
  };
}

function extractCommand(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const record = args as Record<string, unknown>;
  for (const key of ['command', 'cmd', 'script', 'input']) {
    const value = record[key];
    if (typeof value === 'string') return value;
  }
  return '';
}

function hasInstalledServer(servers: ConfiguredServer[], candidates: string[]): boolean {
  const names = servers.map((server) => server.name.toLowerCase());
  return candidates.some((candidate) => {
    const needle = candidate.toLowerCase();
    return names.some((name) => name === needle || name.includes(needle));
  });
}

export function detectCapabilitySuggestion(
  toolID: string,
  args: unknown,
  installedServers: ConfiguredServer[]
): CapabilitySuggestion | null {
  if (toolID.startsWith('agora_')) return null;
  const haystack = `${toolID} ${extractCommand(args)}`.toLowerCase();
  const checks: Array<CapabilitySuggestion & { pattern: RegExp; installed: string[] }> = [
    {
      pattern: /\bpsql\b|postgres|postgresql/,
      installed: ['mcp-postgres', 'postgres'],
      id: 'mcp-postgres',
      query: 'postgres database',
      reason: 'this looks like PostgreSQL access'
    },
    {
      pattern: /\bmongosh?\b|mongodb/,
      installed: ['mcp-mongodb', 'mongodb'],
      id: 'mcp-mongodb',
      query: 'mongodb database',
      reason: 'this looks like MongoDB access'
    },
    {
      pattern: /\bsqlite3\b|sqlite/,
      installed: ['mcp-sqlite', 'sqlite'],
      id: 'mcp-sqlite',
      query: 'sqlite database',
      reason: 'this looks like SQLite access'
    },
    {
      pattern: /\bgh\s+|github/,
      installed: ['mcp-github', 'github'],
      id: 'mcp-github',
      query: 'github',
      reason: 'this looks like GitHub API work'
    },
    {
      pattern: /\bcurl\s+https?:\/\/|\bweb\b|\bsearch\b/,
      installed: ['mcp-brave-search', 'brave', 'tavily', 'firecrawl', 'playwright'],
      id: 'mcp-brave-search',
      query: 'web search',
      reason: 'this looks like web retrieval'
    },
    {
      pattern: /browser|playwright|puppeteer/,
      installed: ['mcp-playwright', 'playwright', 'puppeteer'],
      id: 'mcp-playwright',
      query: 'browser automation',
      reason: 'this looks like browser automation'
    }
  ];

  for (const check of checks) {
    if (check.pattern.test(haystack) && !hasInstalledServer(installedServers, check.installed)) {
      const { pattern: _pattern, installed: _installed, ...suggestion } = check;
      return suggestion;
    }
  }
  return null;
}

function suggestionText(suggestion: CapabilitySuggestion): string {
  return [
    `Agora noticed a possible capability gap: ${suggestion.reason}.`,
    `Preview the scan-gated install with \`/agora acquire ${suggestion.id}\` or search with \`/agora search ${suggestion.query}\`.`,
    'No install was performed.'
  ].join(' ');
}

function stackEnv(directory: string, env: Record<string, string | undefined>): StackEnv {
  return { cwd: directory, home: env.HOME, env };
}

export function buildStackMemoryContext(input: {
  directory: string;
  dataDir?: string;
  env?: Record<string, string | undefined>;
}): string {
  const env = input.env ?? process.env;
  const servers = readAllServers(stackEnv(input.directory, env));
  if (servers.length === 0) return '';

  const dataDir = input.dataDir ?? detectAgoraDataDir({ cwd: input.directory, env });
  const capabilities = readCapabilityCache(dataDir);
  const capsByName = new Map(capabilities.map((entry) => [entry.name, entry]));
  const lines = ['Agora current MCP stack and capabilities:'];

  for (const [name, instances] of groupServersByName(servers)) {
    const tools = [...new Set(instances.map((server) => server.tool))].join(', ');
    const disabled = instances.every((server) => server.enabled === false) ? 'disabled' : 'enabled';
    const transports = [...new Set(instances.map((server) => server.transport))].join('/');
    const cap = capsByName.get(name);
    const capNames = cap?.ok ? cap.tools.slice(0, 6).map((tool) => tool.name) : [];
    const capText = capNames.length ? ` · tools: ${capNames.join(', ')}` : '';
    const drift = cap?.liveDescriptionDigest ? ' · DRIFT detected by Agora doctor' : '';
    lines.push(`- ${name} (${tools}; ${transports}; ${disabled})${capText}${drift}`);
  }

  lines.push(
    'Newly acquired MCP servers usually require an agent restart or new session before tools load.'
  );
  return lines.join('\n');
}

export function createAgoraHooks(input: PluginInput, options?: PluginOptions): Omit<Hooks, 'tool'> {
  const config = parsePluginOptions(options);
  const hooks: Omit<Hooks, 'tool'> = {};

  if (config.suggestAcquire) {
    hooks['tool.execute.before'] = async (hookInput, output) => {
      const servers = readAllServers(stackEnv(input.directory, process.env));
      const suggestion = detectCapabilitySuggestion(hookInput.tool, output.args, servers);
      if (!suggestion) return;

      const text = suggestionText(suggestion);
      await input.client.app
        .log({
          body: {
            service: 'agora',
            level: 'info',
            message: text,
            extra: { tool: hookInput.tool, callID: hookInput.callID, suggestion }
          }
        })
        .catch(() => undefined);

      await input.client.session
        .prompt({
          path: { id: hookInput.sessionID },
          query: { directory: input.directory },
          body: {
            noReply: true,
            parts: [{ type: 'text', text, synthetic: true, metadata: { source: 'agora' } }]
          }
        })
        .catch(() => undefined);
    };
  }

  if (config.stackMemory) {
    hooks['experimental.session.compacting'] = async (_hookInput, output) => {
      const context = buildStackMemoryContext({ directory: input.directory, env: process.env });
      if (context) output.context.push(context);
    };
  }

  return hooks;
}
