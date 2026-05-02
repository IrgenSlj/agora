import { formatConfigJson } from '../config.js';
import {
  detectOpenCodeConfigPath,
  doctorOpenCodeConfig,
  loadOpenCodeConfig,
  writeOpenCodeConfig
} from '../config-files.js';
import {
  createInstallPlan,
  findMarketplaceItem,
  getDiscussions,
  getInstallKind,
  getMarketplaceItems,
  getTrendingItems,
  getTrendingTags,
  searchMarketplaceItems,
  type MarketplaceItem
} from '../marketplace.js';

const VERSION = '0.1.0';

type OutputStream = {
  write(chunk: string): unknown;
};

export interface CliIo {
  stdout: OutputStream;
  stderr: OutputStream;
  env?: Record<string, string | undefined>;
  cwd?: string;
}

export interface ParsedArgs {
  command?: string;
  args: string[];
  flags: Record<string, string | boolean>;
}

const booleanFlags = new Set(['help', 'json', 'offline', 'version', 'verbose', 'write']);

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const parsed = parseArgs(argv);

  if (parsed.flags.version) {
    writeLine(io.stdout, VERSION);
    return 0;
  }

  if (!parsed.command || parsed.flags.help) {
    writeLine(io.stdout, usage());
    return 0;
  }

  try {
    switch (parsed.command) {
      case 'search':
        return commandSearch(parsed, io);
      case 'browse':
        return commandBrowse(parsed, io);
      case 'trending':
        return commandTrending(parsed, io);
      case 'workflows':
        return commandWorkflows(parsed, io);
      case 'discussions':
        return commandDiscussions(parsed, io);
      case 'install':
        return commandInstall(parsed, io);
      case 'config':
        return commandConfig(parsed, io);
      case 'help':
        writeLine(io.stdout, usage());
        return 0;
      default:
        writeLine(io.stderr, `Unknown command: ${parsed.command}`);
        writeLine(io.stderr, 'Run agora help for usage.');
        return 1;
    }
  } catch (error) {
    writeLine(io.stderr, error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (arg.startsWith('--')) {
      const [rawKey, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
      const key = normalizeFlag(rawKey);

      if (inlineValue !== undefined) {
        flags[key] = inlineValue;
      } else if (!booleanFlags.has(key) && argv[index + 1] && !argv[index + 1].startsWith('-')) {
        flags[key] = argv[index + 1];
        index += 1;
      } else {
        flags[key] = true;
      }
      continue;
    }

    if (arg.startsWith('-') && arg.length > 1) {
      const key = shortFlag(arg);
      if (!booleanFlags.has(key) && argv[index + 1] && !argv[index + 1].startsWith('-')) {
        flags[key] = argv[index + 1];
        index += 1;
      } else {
        flags[key] = true;
      }
      continue;
    }

    positionals.push(arg);
  }

  return {
    command: positionals[0],
    args: positionals.slice(1),
    flags
  };
}

function commandSearch(parsed: ParsedArgs, io: CliIo): number {
  const query = parsed.args.join(' ');
  const category = stringFlag(parsed, 'category', 'c') || 'all';
  const limit = numberFlag(parsed, 'limit', 'n') || 10;
  const results = searchMarketplaceItems({ query, category, limit });

  if (parsed.flags.json) {
    writeJson(io.stdout, { query, category, count: results.length, items: results });
    return 0;
  }

  if (results.length === 0) {
    writeLine(io.stdout, `No results found for "${query}".`);
    return 0;
  }

  writeLine(io.stdout, `Agora search: ${query || 'all'} (${results.length} shown)`);
  writeLine(io.stdout, formatItemList(results));
  return 0;
}

function commandBrowse(parsed: ParsedArgs, io: CliIo): number {
  const id = parsed.args[0];
  if (!id) return usageError(io, 'browse requires an item id');

  const item = findMarketplaceItem(id, { type: stringFlag(parsed, 'type', 't') });
  if (!item) return usageError(io, `Item not found: ${id}`);

  if (parsed.flags.json) {
    writeJson(io.stdout, item);
    return 0;
  }

  writeLine(io.stdout, formatItemDetail(item));
  return 0;
}

function commandTrending(parsed: ParsedArgs, io: CliIo): number {
  const category = stringFlag(parsed, 'category', 'c') || parsed.args[0] || 'all';
  const limit = numberFlag(parsed, 'limit', 'n') || 5;
  const items = getTrendingItems({ category, limit });

  if (parsed.flags.json) {
    writeJson(io.stdout, { category, count: items.length, tags: getTrendingTags(), items });
    return 0;
  }

  writeLine(io.stdout, `Trending in Agora (${category})`);
  writeLine(io.stdout, formatItemList(items));
  writeLine(io.stdout, `Tags: ${getTrendingTags().join(', ')}`);
  return 0;
}

function commandWorkflows(parsed: ParsedArgs, io: CliIo): number {
  const query = parsed.args.join(' ');
  const limit = numberFlag(parsed, 'limit', 'n') || 10;
  const workflows = searchMarketplaceItems({ query, category: 'workflow', limit })
    .filter((item) => item.kind === 'workflow');

  if (parsed.flags.json) {
    writeJson(io.stdout, { query, count: workflows.length, workflows });
    return 0;
  }

  writeLine(io.stdout, `Agora workflows (${workflows.length} shown)`);
  writeLine(io.stdout, formatItemList(workflows));
  return 0;
}

function commandDiscussions(parsed: ParsedArgs, io: CliIo): number {
  const category = stringFlag(parsed, 'category', 'c') || 'all';
  const query = parsed.args.join(' ');
  const discussions = getDiscussions(category, query);

  if (parsed.flags.json) {
    writeJson(io.stdout, { category, query, count: discussions.length, discussions });
    return 0;
  }

  if (discussions.length === 0) {
    writeLine(io.stdout, 'No discussions found.');
    return 0;
  }

  writeLine(io.stdout, `Agora discussions (${discussions.length})`);
  writeLine(io.stdout, discussions.map((discussion, index) => {
    return [
      `${index + 1}. ${discussion.title} [${discussion.category}]`,
      `   ${truncate(discussion.content, 88)}`,
      `   replies ${discussion.replies} | stars ${discussion.stars} | by ${discussion.author}`
    ].join('\n');
  }).join('\n\n'));
  return 0;
}

function commandInstall(parsed: ParsedArgs, io: CliIo): number {
  const id = parsed.args[0];
  if (!id) return usageError(io, 'install requires an item id');

  const item = findMarketplaceItem(id, { type: stringFlag(parsed, 'type', 't') });
  if (!item) return usageError(io, `Item not found: ${id}`);

  const configPath = detectOpenCodeConfigPath({
    explicitPath: stringFlag(parsed, 'config'),
    cwd: io.cwd,
    env: io.env
  });
  const loaded = loadOpenCodeConfig(configPath);
  if (loaded.error) return usageError(io, `${loaded.path}: ${loaded.error}`);

  const plan = createInstallPlan(item, loaded.config);
  if (!plan.installable) return usageError(io, plan.reason || `${item.name} is not installable`);

  if (parsed.flags.json) {
    writeJson(io.stdout, {
      item,
      configPath,
      write: Boolean(parsed.flags.write),
      commands: plan.commands,
      notes: plan.notes,
      config: plan.config
    });
    return 0;
  }

  if (parsed.flags.write) {
    writeOpenCodeConfig(configPath, plan.config);
    writeLine(io.stdout, `Installed ${item.name}`);
    writeLine(io.stdout, `Updated ${configPath}`);
    if (plan.commands.length) {
      writeLine(io.stdout, 'Run package install command separately if it is not already available:');
      writeLine(io.stdout, plan.commands.join('\n'));
    }
    return 0;
  }

  writeLine(io.stdout, `Install preview: ${item.name}`);
  writeLine(io.stdout, `Target config: ${configPath}`);
  if (plan.commands.length) {
    writeLine(io.stdout, '\nCommands:');
    writeLine(io.stdout, plan.commands.join('\n'));
  }
  writeLine(io.stdout, '\nopencode.json preview:');
  writeLine(io.stdout, formatConfigJson(plan.config));
  writeLine(io.stdout, '\nRun with --write to update the config file.');
  return 0;
}

function commandConfig(parsed: ParsedArgs, io: CliIo): number {
  const subcommand = parsed.args[0] || 'doctor';

  if (subcommand !== 'doctor') {
    return usageError(io, `Unknown config command: ${subcommand}`);
  }

  const configPath = detectOpenCodeConfigPath({
    explicitPath: stringFlag(parsed, 'config'),
    cwd: io.cwd,
    env: io.env
  });
  const report = doctorOpenCodeConfig(configPath);

  if (parsed.flags.json) {
    writeJson(io.stdout, report);
    return report.valid ? 0 : 1;
  }

  writeLine(io.stdout, `Config path: ${report.path}`);
  writeLine(io.stdout, `Exists: ${report.exists ? 'yes' : 'no'}`);
  writeLine(io.stdout, `Valid: ${report.valid ? 'yes' : 'no'}`);
  if (report.error) writeLine(io.stdout, `Error: ${report.error}`);
  writeLine(io.stdout, `MCP servers: ${report.mcpServers}`);
  writeLine(io.stdout, `Plugins: ${report.plugins}`);
  writeLine(io.stdout, `Packages: ${report.packages.length ? report.packages.join(', ') : 'none'}`);
  return report.valid ? 0 : 1;
}

function formatItemList(items: MarketplaceItem[]): string {
  return items.map((item, index) => {
    const installs = item.kind === 'package' ? ` | installs ${formatCount(item.installs)}` : '';
    return [
      `${index + 1}. ${item.id} [${item.category}]`,
      `   ${item.name}`,
      `   ${truncate(item.description, 88)}`,
      `   stars ${formatCount(item.stars)}${installs} | by ${item.author}`
    ].join('\n');
  }).join('\n\n');
}

function formatItemDetail(item: MarketplaceItem): string {
  const lines = [
    `${item.name}`,
    `id: ${item.id}`,
    `type: ${item.kind}`,
    `category: ${item.category}`,
    `author: ${item.author}`,
    `stars: ${formatCount(item.stars)}`,
    `install: ${getInstallKind(item)}`,
    '',
    item.description,
    '',
    `tags: ${item.tags.join(', ')}`
  ];

  if (item.kind === 'package') {
    lines.splice(5, 0, `version: ${item.version}`);
    lines.push(`installs: ${formatCount(item.installs)}`);
    if (item.repository) lines.push(`repository: ${item.repository}`);
    if (item.npmPackage) lines.push(`npm: ${item.npmPackage}`);
  }

  if (item.kind === 'workflow') {
    lines.push(`forks: ${item.forks}`);
    if (item.model) lines.push(`model: ${item.model}`);
    lines.push('', 'prompt:', item.prompt);
  }

  return lines.join('\n');
}

function usage(): string {
  return [
    'Agora CLI',
    '',
    'Usage:',
    '  agora search <query> [--category mcp|prompt|workflow|skill] [--limit 10] [--json]',
    '  agora browse <id> [--type package|workflow] [--json]',
    '  agora trending [all|packages|workflows] [--limit 5] [--json]',
    '  agora workflows [query] [--limit 10] [--json]',
    '  agora discussions [query] [--category question|idea|showcase|discussion] [--json]',
    '  agora install <id> [--write] [--config path] [--json]',
    '  agora config doctor [--config path] [--json]',
    '',
    'Examples:',
    '  agora search filesystem',
    '  agora browse mcp-github',
    '  agora install mcp-github',
    '  agora install mcp-github --write'
  ].join('\n');
}

function usageError(io: CliIo, message: string): number {
  writeLine(io.stderr, message);
  return 1;
}

function stringFlag(parsed: ParsedArgs, longName: string, shortName?: string): string | undefined {
  const value = parsed.flags[longName] ?? (shortName ? parsed.flags[shortName] : undefined);
  return typeof value === 'string' ? value : undefined;
}

function numberFlag(parsed: ParsedArgs, longName: string, shortName?: string): number | undefined {
  const value = stringFlag(parsed, longName, shortName);
  if (!value) return undefined;
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

function shortFlag(arg: string): string {
  const flag = arg.slice(1);
  if (flag === 'h') return 'help';
  if (flag === 'j') return 'json';
  if (flag === 'c') return 'c';
  if (flag === 'n') return 'n';
  if (flag === 't') return 't';
  return flag;
}

function normalizeFlag(flag: string): string {
  return flag.trim().replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

function writeJson(stream: OutputStream, value: unknown): void {
  writeLine(stream, JSON.stringify(value, null, 2));
}

function writeLine(stream: OutputStream, value = ''): void {
  stream.write(value.endsWith('\n') ? value : `${value}\n`);
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

function formatCount(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(value);
}

export function listKnownItems(): MarketplaceItem[] {
  return getMarketplaceItems();
}
