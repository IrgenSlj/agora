import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { formatConfigJson } from '../config.js';
import {
  detectOpenCodeConfigPath,
  doctorOpenCodeConfig,
  loadOpenCodeConfig,
  writeOpenCodeConfig
} from '../config-files.js';
import {
  createInstallPlan,
  getInstallKind,
  getMarketplaceItems,
  getTrendingTags,
  type MarketplaceItem
} from '../marketplace.js';
import { scanProject, generateInitPlan, applyInitPlan, runCommands } from '../init.js';
import { sampleWorkflows, dataRefreshedAt } from '../data.js';
import {
  createDiscussionSource,
  discussionsSource,
  findMarketplaceSource,
  createReviewSource,
  findTutorialSource,
  listReviewsSource,
  profileSource,
  publishPackageSource,
  publishWorkflowSource,
  searchMarketplaceSource,
  trendingMarketplaceSource,
  tutorialsSource,
  type ApiProfile,
  type ApiReview,
  type FetchLike,
  type SourceOptions,
  type SourceResult
} from '../live.js';
import {
  clearAuthState,
  detectAgoraDataDir,
  getAuthState,
  getAgoraStatePath,
  loadAgoraState,
  removeItemFromState,
  resolveSavedItems,
  saveItemToState,
  setAuthState,
  writeAgoraState,
  type ResolvedSavedItem
} from '../state.js';
import type { Tutorial } from '../types.js';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};
const VERSION = pkg.version;

type OutputStream = {
  write(chunk: string): unknown;
};

export interface CliIo {
  stdout: OutputStream;
  stderr: OutputStream;
  env?: Record<string, string | undefined>;
  cwd?: string;
  fetcher?: FetchLike;
}

export interface ParsedArgs {
  command?: string;
  args: string[];
  flags: Record<string, string | boolean>;
}

const booleanFlags = new Set([
  'api',
  'help',
  'json',
  'live',
  'offline',
  'version',
  'verbose',
  'write'
]);

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
        return await commandSearch(parsed, io);
      case 'browse':
        return await commandBrowse(parsed, io);
      case 'trending':
        return await commandTrending(parsed, io);
      case 'workflows':
        return await commandWorkflows(parsed, io);
      case 'tutorials':
        return await commandTutorials(parsed, io);
      case 'tutorial':
        return await commandTutorial(parsed, io);
      case 'discussions':
        return await commandDiscussions(parsed, io);
      case 'discuss':
        return await commandDiscuss(parsed, io);
      case 'install':
        return await commandInstall(parsed, io);
      case 'save':
        return await commandSave(parsed, io);
      case 'saved':
        return await commandSaved(parsed, io);
      case 'remove':
        return await commandRemove(parsed, io);
      case 'publish':
        return await commandPublish(parsed, io);
      case 'review':
        return await commandReview(parsed, io);
      case 'reviews':
        return await commandReviews(parsed, io);
      case 'profile':
        return await commandProfile(parsed, io);
      case 'auth':
        return commandAuth(parsed, io);
      case 'config':
        return await commandConfig(parsed, io);
      case 'init':
        return await commandInit(parsed, io);
      case 'use':
        return await commandUse(parsed, io);
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
      } else if (
        !booleanFlags.has(key) &&
        argv[index + 1] &&
        (!argv[index + 1].startsWith('-') || /^-\d/.test(argv[index + 1]))
      ) {
        flags[key] = argv[index + 1];
        index += 1;
      } else {
        flags[key] = true;
      }
      continue;
    }

    if (arg.startsWith('-') && arg.length > 1) {
      const key = shortFlag(arg);
      if (
        !booleanFlags.has(key) &&
        argv[index + 1] &&
        (!argv[index + 1].startsWith('-') || /^-\d/.test(argv[index + 1]))
      ) {
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

async function commandSearch(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const query = parsed.args.join(' ');
  const category = stringFlag(parsed, 'category', 'c') || 'all';
  const limit = numberFlag(parsed, 'limit', 'n') || 10;
  const result = await searchMarketplaceSource({
    ...sourceOptions(parsed, io),
    query,
    category,
    limit
  });
  const results = result.data;
  warnFallback(result, io);

  if (parsed.flags.json) {
    writeJson(
      io.stdout,
      sourcePayload(result, { query, category, count: results.length, items: results })
    );
    return 0;
  }

  if (results.length === 0) {
    writeLine(io.stdout, `No results found for "${query}".`);
    return 0;
  }

  const sourceLabel =
    result.source === 'offline'
      ? `source: offline, refreshed ${dataRefreshedAt}`
      : `source: ${result.source}`;
  writeLine(io.stdout, `Agora search: ${query || 'all'} (${results.length} shown, ${sourceLabel})`);
  writeLine(io.stdout, formatItemList(results));
  return 0;
}

async function commandBrowse(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const id = parsed.args[0];
  if (!id) return usageError(io, 'browse requires an item id');

  const result = await findMarketplaceSource({
    ...sourceOptions(parsed, io),
    id,
    type: stringFlag(parsed, 'type', 't')
  });
  const item = result.data;
  warnFallback(result, io);
  if (!item) return usageError(io, `Item not found: ${id}`);

  if (parsed.flags.json) {
    writeJson(io.stdout, sourcePayload(result, { item }));
    return 0;
  }

  writeLine(io.stdout, formatItemDetail(item));
  return 0;
}

async function commandTrending(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const category = stringFlag(parsed, 'category', 'c') || parsed.args[0] || 'all';
  const limit = numberFlag(parsed, 'limit', 'n') || 5;
  const result = await trendingMarketplaceSource({ ...sourceOptions(parsed, io), category, limit });
  const items = result.data;
  warnFallback(result, io);

  if (parsed.flags.json) {
    writeJson(
      io.stdout,
      sourcePayload(result, { category, count: items.length, tags: getTrendingTags(), items })
    );
    return 0;
  }

  writeLine(io.stdout, `Trending in Agora (${category}, source: ${result.source})`);
  writeLine(io.stdout, formatItemList(items));
  writeLine(io.stdout, `Tags: ${getTrendingTags().join(', ')}`);
  return 0;
}

async function commandWorkflows(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const query = parsed.args.join(' ');
  const limit = numberFlag(parsed, 'limit', 'n') || 10;
  const result = await searchMarketplaceSource({
    ...sourceOptions(parsed, io),
    query,
    category: 'workflow',
    limit
  });
  const workflows = result.data.filter((item) => item.kind === 'workflow');
  warnFallback(result, io);

  if (parsed.flags.json) {
    writeJson(io.stdout, sourcePayload(result, { query, count: workflows.length, workflows }));
    return 0;
  }

  writeLine(io.stdout, `Agora workflows (${workflows.length} shown, source: ${result.source})`);
  writeLine(io.stdout, formatItemList(workflows));
  return 0;
}

async function commandTutorials(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const query = parsed.args.join(' ');
  const level = tutorialLevelFlag(parsed);
  if (!level.ok) return usageError(io, level.error);

  const limit = numberFlag(parsed, 'limit', 'n') || 20;
  const result = await tutorialsSource({
    ...sourceOptions(parsed, io),
    query,
    level: level.value,
    limit
  });
  const tutorials = result.data;
  warnFallback(result, io);

  if (parsed.flags.json) {
    writeJson(
      io.stdout,
      sourcePayload(result, { query, level: level.value, count: tutorials.length, tutorials })
    );
    return 0;
  }

  if (tutorials.length === 0) {
    writeLine(io.stdout, query ? `No tutorials match "${query}".` : 'No tutorials found.');
    return 0;
  }

  writeLine(io.stdout, `Agora tutorials (${tutorials.length} shown, source: ${result.source})`);
  writeLine(io.stdout, formatTutorialList(tutorials));
  return 0;
}

async function commandTutorial(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const id = parsed.args[0];
  if (!id) return usageError(io, 'tutorial requires a tutorial id');

  const step = tutorialStepNumber(parsed);
  if (!step.ok) return usageError(io, step.error);

  const result = await findTutorialSource({ ...sourceOptions(parsed, io), id });
  const tutorial = result.data;
  warnFallback(result, io);
  if (!tutorial) return usageError(io, `Tutorial not found: ${id}`);

  if (parsed.flags.json) {
    writeJson(
      io.stdout,
      sourcePayload(result, {
        tutorial,
        step: tutorialStepPayload(tutorial, step.value)
      })
    );
    return 0;
  }

  writeLine(io.stdout, formatTutorialStep(tutorial, step.value));
  return 0;
}

async function commandDiscussions(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const category = stringFlag(parsed, 'category', 'c') || 'all';
  const query = parsed.args.join(' ');
  const result = await discussionsSource({ ...sourceOptions(parsed, io), category, query });
  const discussions = result.data;
  warnFallback(result, io);

  if (parsed.flags.json) {
    writeJson(
      io.stdout,
      sourcePayload(result, { category, query, count: discussions.length, discussions })
    );
    return 0;
  }

  if (discussions.length === 0) {
    writeLine(io.stdout, 'No discussions found.');
    return 0;
  }

  writeLine(io.stdout, `Agora discussions (${discussions.length}, source: ${result.source})`);
  writeLine(
    io.stdout,
    discussions
      .map((discussion, index) => {
        return [
          `${index + 1}. ${discussion.title} [${discussion.category}]`,
          `   ${truncate(discussion.content, 88)}`,
          `   replies ${discussion.replies} | stars ${discussion.stars} | by ${discussion.author}`
        ].join('\n');
      })
      .join('\n\n')
  );
  return 0;
}

async function commandDiscuss(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const source = writeSourceOptions(parsed, io);
  if (!source.ok) return usageError(io, source.error);

  const title = requiredStringFlag(parsed, 'title');
  const content = contentInput(parsed, io);
  if (!title || !content) {
    return usageError(io, 'discuss requires --title and --content or --content-file');
  }

  const category = discussionCategoryFlag(parsed);
  if (!category.ok) return usageError(io, category.error);

  const result = await createDiscussionSource(source.options, {
    title,
    content,
    category: category.value
  });

  if (parsed.flags.json) {
    writeJson(io.stdout, sourcePayload(result, { discussion: result.data }));
    return 0;
  }

  writeLine(io.stdout, `Created discussion ${result.data.id}`);
  writeLine(io.stdout, `${result.data.title} (${result.source})`);
  return 0;
}

async function commandInstall(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const id = parsed.args[0];
  if (!id) return usageError(io, 'install requires an item id');

  const source = await findMarketplaceSource({
    ...sourceOptions(parsed, io),
    id,
    type: stringFlag(parsed, 'type', 't')
  });
  const item = source.data;
  warnFallback(source, io);
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
      source: source.source,
      apiUrl: source.apiUrl,
      fallbackReason: source.fallbackReason,
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
      writeLine(io.stdout, 'Installing packages...');
      for (const cmd of plan.commands) {
        try {
          execSync(cmd, { stdio: 'pipe', timeout: 120000 });
          writeLine(io.stdout, `  ✓ ${cmd}`);
        } catch {
          writeLine(io.stdout, `  ! Failed: ${cmd} (may already be installed)`);
        }
      }
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
  writeLine(io.stdout, '\nRun with --write to update the config file and install packages.');
  return 0;
}

async function commandInit(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const cwd = io.cwd || process.cwd();
  const scan = scanProject(cwd);
  const plan = generateInitPlan(scan);
  const configPath = detectOpenCodeConfigPath({ cwd, env: io.env });

  if (parsed.flags.json) {
    if (parsed.flags.dryRun) {
      writeJson(io.stdout, {
        projectType: scan.type,
        frameworks: scan.frameworks,
        config: plan.config,
        servers: plan.servers,
        commands: plan.commands,
        dryRun: true
      });
      return 0;
    }

    applyInitPlan(plan, configPath);
    const installResults = plan.commands.length ? runCommands(plan.commands) : [];
    const installed = installResults.filter((r) => r.ok).length;
    const failed = installResults.filter((r) => !r.ok).length;

    writeJson(io.stdout, {
      projectType: scan.type,
      frameworks: scan.frameworks,
      config: plan.config,
      servers: plan.servers,
      commands: plan.commands,
      installResults,
      installed,
      failed
    });
    return 0;
  }

  writeLine(io.stdout, `Scanning ${cwd}...`);
  writeLine(io.stdout, `  Project type: ${scan.type}`);
  if (scan.frameworks.length) writeLine(io.stdout, `  Frameworks: ${scan.frameworks.join(', ')}`);
  if (scan.hasDocker) writeLine(io.stdout, '  Docker: detected');
  if (scan.hasTests) writeLine(io.stdout, '  Tests: detected');
  if (scan.hasDatabase) writeLine(io.stdout, '  Database: detected');

  if (!parsed.flags.dryRun) {
    applyInitPlan(plan, configPath);
    writeLine(io.stdout, `\nWrote config to ${configPath}`);

    if (plan.commands.length) {
      writeLine(io.stdout, '\nInstalling MCP server packages...');
      const installResults = runCommands(plan.commands);
      const installed = installResults.filter((r) => r.ok).length;
      const failed = installResults.filter((r) => !r.ok).length;
      writeLine(
        io.stdout,
        `  Installed ${installed} of ${plan.commands.length} packages${failed ? ` (${failed} failed)` : ''}`
      );
    }

    writeLine(io.stdout, '\n✓ Agora initialized! Restart OpenCode to pick up the changes.');
    writeLine(io.stdout, '  Plugin "opencode-agora" is now registered in your config.');
    writeLine(io.stdout, `  ${plan.servers.length} MCP servers configured.`);
    if (plan.workflows.length)
      writeLine(io.stdout, `  ${plan.workflows.length} workflows available via \`agora use\`.`);
    for (const note of plan.notes) writeLine(io.stdout, `  ${note}`);
  } else {
    writeLine(io.stdout, '\n--- Dry run ---');
    writeLine(io.stdout, `Target config: ${configPath}`);
    writeLine(io.stdout, formatConfigJson(plan.config));
    writeLine(io.stdout, '\nPackages to install:');
    for (const cmd of plan.commands) writeLine(io.stdout, `  ${cmd}`);
    writeLine(io.stdout, '\nRun without --dry-run to apply.');
  }
  return 0;
}

async function commandUse(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const id = parsed.args[0];
  if (!id) return usageError(io, 'use requires a workflow id');

  const workflow = sampleWorkflows.find(
    (w) => w.id === id || w.name.toLowerCase() === id.toLowerCase()
  );
  if (!workflow)
    return usageError(
      io,
      `Workflow not found: ${id}. Run \`agora workflows\` to see available workflows.`
    );

  const cwd = io.cwd || process.cwd();
  const skillsDir = join(cwd, '.opencode', 'skills');
  mkdirSync(skillsDir, { recursive: true });

  const skillId = workflow.id.replace(/^wf-/, 'skill-');
  const skillPath = join(skillsDir, `${skillId}.md`);
  const skillContent = `---
name: ${workflow.name}
description: ${workflow.description}
model: ${workflow.model || ''}
tags: [${workflow.tags.map((t) => `"${t}"`).join(', ')}]
---

${workflow.prompt}
`;

  writeFileSync(skillPath, skillContent, 'utf8');

  const configPath = detectOpenCodeConfigPath({ cwd, env: io.env });
  const loaded = loadOpenCodeConfig(configPath);
  if (loaded.error) return usageError(io, `${loaded.path}: ${loaded.error}`);
  const plugins = new Set(loaded.config.plugin || []);
  plugins.add(skillId);

  const updatedConfig = {
    ...loaded.config,
    plugin: Array.from(plugins)
  };
  writeOpenCodeConfig(configPath, updatedConfig);

  if (parsed.flags.json) {
    writeJson(io.stdout, { workflow: workflow.id, skillPath, registered: true });
    return 0;
  }

  writeLine(io.stdout, `✓ Applied "${workflow.name}" as an OpenCode skill.`);
  writeLine(io.stdout, `  Skill file: ${skillPath}`);
  writeLine(io.stdout, `  Registered in: ${configPath}`);
  writeLine(io.stdout, '  Restart OpenCode to start using it.');
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

function commandAuth(parsed: ParsedArgs, io: CliIo): number {
  const subcommand = parsed.args[0] || 'status';
  const dataDir = detectDataDir(parsed, io);
  const state = loadAgoraState(dataDir);
  const existingAuth = getAuthState(state);

  if (subcommand === 'login') {
    const token = authTokenInput(parsed, io);
    if (!token) {
      return usageError(io, 'auth login requires --token, AGORA_TOKEN, or AGORA_API_TOKEN');
    }

    const apiUrl =
      stringFlag(parsed, 'apiUrl') || envString(io, 'AGORA_API_URL') || existingAuth?.apiUrl;
    const nextState = setAuthState(state, { token, apiUrl });
    const auth = getAuthState(nextState);
    writeAgoraState(dataDir, nextState);

    if (parsed.flags.json) {
      writeJson(io.stdout, authStatusPayload(dataDir, auth));
      return 0;
    }

    writeLine(io.stdout, 'Stored Agora API token');
    writeLine(io.stdout, `API URL: ${auth?.apiUrl || 'not stored'}`);
    writeLine(io.stdout, `State: ${getAgoraStatePath(dataDir)}`);
    return 0;
  }

  if (subcommand === 'status') {
    if (parsed.flags.json) {
      writeJson(io.stdout, authStatusPayload(dataDir, existingAuth));
      return 0;
    }

    writeLine(io.stdout, `Authenticated: ${existingAuth ? 'yes' : 'no'}`);
    if (existingAuth) {
      writeLine(io.stdout, `Token: ${maskToken(existingAuth.token)}`);
      writeLine(io.stdout, `API URL: ${existingAuth.apiUrl || 'not stored'}`);
      writeLine(io.stdout, `Saved: ${formatDate(existingAuth.savedAt)}`);
    }
    writeLine(io.stdout, `State: ${getAgoraStatePath(dataDir)}`);
    return 0;
  }

  if (subcommand === 'logout') {
    if (!existingAuth) {
      if (parsed.flags.json) {
        writeJson(io.stdout, authStatusPayload(dataDir, undefined));
        return 0;
      }

      writeLine(io.stdout, 'No stored Agora API token');
      return 0;
    }

    writeAgoraState(dataDir, clearAuthState(state));

    if (parsed.flags.json) {
      writeJson(io.stdout, authStatusPayload(dataDir, undefined));
      return 0;
    }

    writeLine(io.stdout, 'Removed stored Agora API token');
    return 0;
  }

  return usageError(io, `Unknown auth command: ${subcommand}`);
}

async function commandSave(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const id = parsed.args[0];
  if (!id) return usageError(io, 'save requires an item id');

  const source = await findMarketplaceSource({
    ...sourceOptions(parsed, io),
    id,
    type: stringFlag(parsed, 'type', 't')
  });
  const item = source.data;
  warnFallback(source, io);
  if (!item) return usageError(io, `Item not found: ${id}`);

  const dataDir = detectDataDir(parsed, io);
  const state = loadAgoraState(dataDir);
  const result = saveItemToState(state, item);
  writeAgoraState(dataDir, result.state);

  if (parsed.flags.json) {
    writeJson(io.stdout, {
      source: source.source,
      apiUrl: source.apiUrl,
      fallbackReason: source.fallbackReason,
      dataDir,
      statePath: getAgoraStatePath(dataDir),
      added: result.added,
      item
    });
    return 0;
  }

  writeLine(io.stdout, result.added ? `Saved ${item.id}` : `${item.id} is already saved`);
  writeLine(io.stdout, `State: ${getAgoraStatePath(dataDir)}`);
  return 0;
}

function commandSaved(parsed: ParsedArgs, io: CliIo): number {
  const query = parsed.args.join(' ').trim().toLowerCase();
  const dataDir = detectDataDir(parsed, io);
  const state = loadAgoraState(dataDir);
  const saved = resolveSavedItems(state).filter((entry) => matchesSavedQuery(entry, query));

  if (parsed.flags.json) {
    writeJson(io.stdout, {
      dataDir,
      statePath: getAgoraStatePath(dataDir),
      count: saved.length,
      items: saved
    });
    return 0;
  }

  if (saved.length === 0) {
    writeLine(io.stdout, query ? `No saved items match "${query}".` : 'No saved items yet.');
    writeLine(io.stdout, 'Run agora save <id> to save a package or workflow.');
    return 0;
  }

  writeLine(io.stdout, `Saved Agora items (${saved.length})`);
  writeLine(io.stdout, formatSavedList(saved));
  return 0;
}

function commandRemove(parsed: ParsedArgs, io: CliIo): number {
  const id = parsed.args[0];
  if (!id) return usageError(io, 'remove requires an item id');

  const dataDir = detectDataDir(parsed, io);
  const state = loadAgoraState(dataDir);
  const targetId =
    resolveSavedItems(state).find((entry) => {
      return entry.saved.id === id || entry.item?.id === id || entry.item?.name === id;
    })?.saved.id || id;
  const result = removeItemFromState(state, targetId);
  writeAgoraState(dataDir, result.state);

  if (parsed.flags.json) {
    writeJson(io.stdout, {
      dataDir,
      statePath: getAgoraStatePath(dataDir),
      removed: result.removed,
      id: targetId
    });
    return result.removed ? 0 : 1;
  }

  if (!result.removed) {
    return usageError(io, `Saved item not found: ${id}`);
  }

  writeLine(io.stdout, `Removed ${targetId}`);
  return 0;
}

async function commandPublish(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const kind = parsed.args[0];

  if (kind !== 'package' && kind !== 'workflow') {
    return usageError(io, 'publish requires "package" or "workflow"');
  }

  const source = writeSourceOptions(parsed, io);
  if (!source.ok) return usageError(io, source.error);

  const name = requiredStringFlag(parsed, 'name');
  const description = requiredStringFlag(parsed, 'description', 'd');
  if (!name || !description) {
    return usageError(io, 'publish requires --name and --description');
  }

  if (kind === 'package') {
    const npmPackage = stringFlag(parsed, 'npm') || stringFlag(parsed, 'npmPackage');
    const category = stringFlag(parsed, 'category', 'c') || 'mcp';

    if (category === 'mcp' && !npmPackage) {
      return usageError(io, 'publish package requires --npm for MCP packages');
    }

    const result = await publishPackageSource(source.options, {
      id: stringFlag(parsed, 'id'),
      name,
      description,
      version: stringFlag(parsed, 'version') || '1.0.0',
      category,
      tags: tagsFlag(parsed),
      repository: stringFlag(parsed, 'repo') || stringFlag(parsed, 'repository'),
      npmPackage
    });

    if (parsed.flags.json) {
      writeJson(io.stdout, sourcePayload(result, { item: result.data }));
      return 0;
    }

    writeLine(io.stdout, `Published package ${result.data.id}`);
    writeLine(io.stdout, `${result.data.name} (${result.source})`);
    return 0;
  }

  const prompt = promptInput(parsed, io);
  if (prompt === undefined) {
    return usageError(io, 'publish workflow requires --prompt or --prompt-file');
  }

  const result = await publishWorkflowSource(source.options, {
    id: stringFlag(parsed, 'id'),
    name,
    description,
    prompt,
    model: stringFlag(parsed, 'model'),
    tags: tagsFlag(parsed)
  });

  if (parsed.flags.json) {
    writeJson(io.stdout, sourcePayload(result, { item: result.data }));
    return 0;
  }

  writeLine(io.stdout, `Published workflow ${result.data.id}`);
  writeLine(io.stdout, `${result.data.name} (${result.source})`);
  return 0;
}

async function commandReview(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const itemId = parsed.args[0];
  if (!itemId) return usageError(io, 'review requires an item id');

  const rating = numberFlag(parsed, 'rating', 'r');
  const content = requiredStringFlag(parsed, 'content');
  if (!rating || rating < 1 || rating > 5 || !content) {
    return usageError(io, 'review requires --rating 1-5 and --content');
  }

  const source = writeSourceOptions(parsed, io);
  if (!source.ok) return usageError(io, source.error);

  const result = await createReviewSource(source.options, {
    itemId,
    itemType: itemTypeFlag(parsed, itemId),
    rating,
    content
  });

  if (parsed.flags.json) {
    writeJson(io.stdout, sourcePayload(result, { review: result.data }));
    return 0;
  }

  writeLine(io.stdout, `Reviewed ${result.data.itemId}`);
  writeLine(io.stdout, `${result.data.rating}/5 by ${result.data.author}`);
  return 0;
}

async function commandReviews(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const itemId = parsed.args[0];
  const source = readSourceOptions(parsed, io);
  if (!source.ok) return usageError(io, source.error);

  const result = await listReviewsSource(source.options, itemId, stringFlag(parsed, 'type', 't'));

  if (parsed.flags.json) {
    writeJson(
      io.stdout,
      sourcePayload(result, { count: result.data.length, reviews: result.data })
    );
    return 0;
  }

  if (result.data.length === 0) {
    writeLine(io.stdout, itemId ? `No reviews found for ${itemId}.` : 'No reviews found.');
    return 0;
  }

  writeLine(io.stdout, `Agora reviews (${result.data.length}, source: ${result.source})`);
  writeLine(io.stdout, formatReviewList(result.data));
  return 0;
}

async function commandProfile(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const username = parsed.args[0] || stringFlag(parsed, 'username');
  if (!username) return usageError(io, 'profile requires a username');

  const source = readSourceOptions(parsed, io);
  if (!source.ok) return usageError(io, source.error);

  const result = await profileSource(source.options, username);
  if (!result.data) return usageError(io, `Profile not found: ${username}`);

  if (parsed.flags.json) {
    writeJson(io.stdout, sourcePayload(result, { profile: result.data }));
    return 0;
  }

  writeLine(io.stdout, formatProfileDetail(result.data));
  return 0;
}

function formatItemList(items: MarketplaceItem[]): string {
  return items
    .map((item, index) => {
      const installs = item.kind === 'package' ? ` | installs ${formatCount(item.installs)}` : '';
      return [
        `${index + 1}. ${item.id} [${item.category}]`,
        `   ${item.name}`,
        `   ${truncate(item.description, 88)}`,
        `   stars ${formatCount(item.stars)}${installs} | by ${item.author}`
      ].join('\n');
    })
    .join('\n\n');
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

function formatSavedList(items: ResolvedSavedItem[]): string {
  return items
    .map((entry, index) => {
      if (!entry.item) {
        return [
          `${index + 1}. ${entry.saved.id} [missing]`,
          `   saved ${formatDate(entry.saved.savedAt)}`
        ].join('\n');
      }

      return [
        `${index + 1}. ${entry.item.id} [${entry.item.category}]`,
        `   ${entry.item.name}`,
        `   ${truncate(entry.item.description, 88)}`,
        `   saved ${formatDate(entry.saved.savedAt)}`
      ].join('\n');
    })
    .join('\n\n');
}

function formatReviewList(reviews: ApiReview[]): string {
  return reviews
    .map((review, index) => {
      return [
        `${index + 1}. ${review.itemId} [${review.itemType}]`,
        `   rating ${review.rating}/5 by ${review.author}`,
        `   ${truncate(review.content, 88)}`
      ].join('\n');
    })
    .join('\n\n');
}

function formatProfileDetail(profile: ApiProfile): string {
  const lines = [
    profile.displayName,
    `username: ${profile.username}`,
    `packages: ${formatCount(profile.packages)}`,
    `workflows: ${formatCount(profile.workflows)}`,
    `discussions: ${formatCount(profile.discussions)}`
  ];

  if (profile.bio) lines.splice(2, 0, `bio: ${profile.bio}`);
  if (profile.avatarUrl) lines.push(`avatar: ${profile.avatarUrl}`);
  if (profile.joinedAt) lines.push(`joined: ${formatDate(profile.joinedAt)}`);

  return lines.join('\n');
}

function formatTutorialList(tutorials: Tutorial[]): string {
  return tutorials
    .map((tutorial, index) => {
      return [
        `${index + 1}. ${tutorial.id} [${tutorial.level}]`,
        `   ${tutorial.title}`,
        `   ${truncate(tutorial.description, 88)}`,
        `   ${tutorial.duration} | ${tutorial.steps.length} steps`
      ].join('\n');
    })
    .join('\n\n');
}

function formatTutorialStep(tutorial: Tutorial, stepNumber: number): string {
  const payload = tutorialStepPayload(tutorial, stepNumber);

  if (payload.completed) {
    return [
      `${tutorial.title}`,
      `Completed ${tutorial.steps.length}/${tutorial.steps.length} steps.`,
      'Run agora tutorials for more tutorials.'
    ].join('\n');
  }

  const lines = [
    `${tutorial.title}`,
    `id: ${tutorial.id}`,
    `level: ${tutorial.level}`,
    `duration: ${tutorial.duration}`,
    `step: ${payload.stepNumber}/${tutorial.steps.length}`,
    '',
    payload.title || '',
    payload.content || ''
  ];

  if (payload.code) {
    lines.push('', 'code:', payload.code);
  }

  return lines.join('\n');
}

function usage(): string {
  return [
    'Agora CLI',
    '',
    'Usage:',
    '  agora init [--dry-run] [--json]',
    '  agora use <workflow-id> [--json]',
    '  agora search <query> [--category mcp|prompt|workflow|skill] [--limit 10] [--json]',
    '  agora browse <id> [--type package|workflow] [--json]',
    '  agora trending [all|packages|workflows] [--limit 5] [--json]',
    '  agora workflows [query] [--limit 10] [--json]',
    '  agora tutorials [query] [--level beginner|intermediate|advanced] [--limit 20] [--json]',
    '  agora tutorial <id> [step] [--json]',
    '  agora discussions [query] [--category question|idea|showcase|discussion] [--json]',
    '  agora discuss --title <title> (--content <text>|--content-file path) [--category question|idea|showcase|discussion]',
    '  agora install <id> [--write] [--config path] [--json]',
    '  agora save <id> [--data-dir path] [--json]',
    '  agora saved [query] [--data-dir path] [--json]',
    '  agora remove <id> [--data-dir path] [--json]',
    '  agora auth login --token <token> [--api-url url] [--data-dir path]',
    '  agora auth status [--data-dir path] [--json]',
    '  agora auth logout [--data-dir path]',
    '  agora publish package --name <name> --description <text> --npm <package> [--token token]',
    '  agora publish workflow --name <name> --description <text> --prompt-file <path> [--token token]',
    '  agora review <id> --rating 5 --content <text> [--token token]',
    '  agora reviews [id] [--type package|workflow]',
    '  agora profile <username> [--json]',
    '  agora config doctor [--config path] [--json]',
    '',
    'Data source:',
    '  --api                 Use the live Agora API',
    '  --api-url <url>       Override AGORA_API_URL',
    '  --api-timeout <ms>    API timeout before offline fallback',
    '  --token <token>       API auth token, defaults to env vars or agora auth login',
    '  --offline             Force local bundled marketplace data',
    '',
    'Examples:',
    '  agora init',
    '  agora init --dry-run',
    '  agora use wf-tdd-cycle',
    '  agora search filesystem',
    '  agora search filesystem --api',
    '  agora browse mcp-github',
    '  agora tutorials mcp',
    '  agora tutorial tut-mcp-basics 2',
    '  agora install mcp-github',
    '  agora install mcp-github --write',
    '  agora save wf-security-audit',
    '  agora saved',
    '  agora auth login --token $AGORA_TOKEN --api-url https://agora.example.com',
    '  agora discuss --title "MCP question" --content "How are you composing servers?" --category question',
    '  agora profile alice',
    '  agora publish package --name @you/server --description "MCP server" --npm @you/server',
    '  agora review mcp-github --rating 5 --content "Works well"'
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

function requiredStringFlag(
  parsed: ParsedArgs,
  longName: string,
  shortName?: string
): string | undefined {
  const value = stringFlag(parsed, longName, shortName);
  return value?.trim() || undefined;
}

function numberFlag(parsed: ParsedArgs, longName: string, shortName?: string): number | undefined {
  const value = stringFlag(parsed, longName, shortName);
  if (!value) return undefined;
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

function authTokenInput(parsed: ParsedArgs, io: CliIo): string | undefined {
  return (
    requiredStringFlag(parsed, 'token') ||
    envString(io, 'AGORA_TOKEN') ||
    envString(io, 'AGORA_API_TOKEN')
  );
}

function envString(io: CliIo, name: string): string | undefined {
  const value = io.env?.[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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

function detectDataDir(parsed: ParsedArgs, io: CliIo): string {
  return detectAgoraDataDir({
    explicitDir: stringFlag(parsed, 'dataDir'),
    cwd: io.cwd,
    env: io.env
  });
}

function sourceOptions(parsed: ParsedArgs, io: CliIo): SourceOptions {
  const explicitApiUrl = stringFlag(parsed, 'apiUrl');
  const envApiUrl = envString(io, 'AGORA_API_URL');
  const storedAuth = getAuthState(loadAgoraState(detectDataDir(parsed, io)));
  const storedApiUrl = storedAuth?.apiUrl;
  const apiUrl = explicitApiUrl || envApiUrl || storedApiUrl || '';
  const useApi =
    !parsed.flags.offline &&
    Boolean(
      parsed.flags.api ||
      parsed.flags.live ||
      explicitApiUrl ||
      envApiUrl ||
      storedApiUrl ||
      io.env?.AGORA_USE_API === 'true'
    );

  return {
    useApi,
    apiUrl,
    token: authTokenInput(parsed, io) || storedAuth?.token,
    fetcher: io.fetcher,
    timeoutMs: numberFlag(parsed, 'apiTimeout')
  };
}

function writeSourceOptions(
  parsed: ParsedArgs,
  io: CliIo
): { ok: true; options: SourceOptions } | { ok: false; error: string } {
  const options = sourceOptions(parsed, io);

  if (!options.apiUrl) {
    return {
      ok: false,
      error: 'This command requires --api-url, AGORA_API_URL, or an auth login API URL'
    };
  }

  if (!options.token) {
    return {
      ok: false,
      error: 'This command requires --token, AGORA_TOKEN, AGORA_API_TOKEN, or agora auth login'
    };
  }

  return {
    ok: true,
    options: {
      ...options,
      useApi: true
    }
  };
}

function readSourceOptions(
  parsed: ParsedArgs,
  io: CliIo
): { ok: true; options: SourceOptions } | { ok: false; error: string } {
  const options = sourceOptions(parsed, io);
  if (!options.apiUrl) {
    return {
      ok: false,
      error: 'This command requires --api-url, AGORA_API_URL, or an auth login API URL'
    };
  }
  return { ok: true, options: { ...options, useApi: true } };
}

function tagsFlag(parsed: ParsedArgs): string[] {
  const value = stringFlag(parsed, 'tags');
  if (!value) return [];
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function promptInput(parsed: ParsedArgs, io: CliIo): string | undefined {
  const prompt = stringFlag(parsed, 'prompt');
  if (prompt) return prompt;

  const promptFile = stringFlag(parsed, 'promptFile');
  if (!promptFile) return undefined;

  if (!existsSync(promptFile)) {
    usageError(io, `prompt-file not found: ${promptFile}`);
    return undefined;
  }

  return readFileSync(promptFile, 'utf8');
}

function contentInput(parsed: ParsedArgs, io: CliIo): string | undefined {
  const content = requiredStringFlag(parsed, 'content');
  if (content) return content;

  const contentFile = stringFlag(parsed, 'contentFile');
  if (!contentFile) return undefined;

  if (!existsSync(contentFile)) {
    usageError(io, `content-file not found: ${contentFile}`);
    return undefined;
  }

  return readFileSync(contentFile, 'utf8').trim();
}

function itemTypeFlag(parsed: ParsedArgs, itemId: string): 'package' | 'workflow' {
  const type = stringFlag(parsed, 'type', 't');
  if (type === 'workflow' || itemId.startsWith('wf-')) return 'workflow';
  return 'package';
}

function discussionCategoryFlag(
  parsed: ParsedArgs
): { ok: true; value: string } | { ok: false; error: string } {
  const category = stringFlag(parsed, 'category', 'c') || 'discussion';
  if (
    category === 'question' ||
    category === 'idea' ||
    category === 'showcase' ||
    category === 'discussion'
  ) {
    return { ok: true, value: category };
  }
  return {
    ok: false,
    error: 'discussion category must be question, idea, showcase, or discussion'
  };
}

function tutorialLevelFlag(
  parsed: ParsedArgs
): { ok: true; value: string } | { ok: false; error: string } {
  const level = stringFlag(parsed, 'level') || 'all';
  if (level === 'all' || level === 'beginner' || level === 'intermediate' || level === 'advanced') {
    return { ok: true, value: level };
  }
  return { ok: false, error: 'tutorial level must be beginner, intermediate, advanced, or all' };
}

function tutorialStepNumber(
  parsed: ParsedArgs
): { ok: true; value: number } | { ok: false; error: string } {
  const rawStep = parsed.args[1] || stringFlag(parsed, 'step');
  if (!rawStep) return { ok: true, value: 1 };

  const step = Number(rawStep);
  if (!Number.isInteger(step) || step < 1) {
    return { ok: false, error: 'tutorial step must be a positive integer' };
  }

  return { ok: true, value: step };
}

function tutorialStepPayload(
  tutorial: Tutorial,
  stepNumber: number
): {
  stepNumber: number;
  totalSteps: number;
  completed: boolean;
  title?: string;
  content?: string;
  code?: string;
} {
  const step = tutorial.steps[stepNumber - 1];

  return {
    stepNumber,
    totalSteps: tutorial.steps.length,
    completed: !step,
    title: step?.title,
    content: step?.content,
    code: step?.code
  };
}

function warnFallback<T>(result: SourceResult<T>, io: CliIo): void {
  if (result.fallbackReason) {
    writeLine(
      io.stderr,
      `API unavailable, using offline data (refreshed ${dataRefreshedAt}): ${result.fallbackReason}`
    );
  }
}

function sourcePayload<T extends object, TValue>(
  result: SourceResult<TValue>,
  payload: T
): T & {
  source: string;
  apiUrl?: string;
  fallbackReason?: string;
} {
  return {
    source: result.source,
    apiUrl: result.apiUrl,
    fallbackReason: result.fallbackReason,
    ...payload
  };
}

function authStatusPayload(
  dataDir: string,
  auth: ReturnType<typeof getAuthState>
): {
  dataDir: string;
  statePath: string;
  authenticated: boolean;
  apiUrl?: string;
  tokenPreview?: string;
  savedAt?: string;
} {
  return {
    dataDir,
    statePath: getAgoraStatePath(dataDir),
    authenticated: Boolean(auth),
    apiUrl: auth?.apiUrl,
    tokenPreview: auth ? maskToken(auth.token) : undefined,
    savedAt: auth?.savedAt
  };
}

function maskToken(token: string): string {
  const value = token.trim();
  if (value.length <= 4) return '****';
  if (value.length <= 8) return `${'*'.repeat(value.length - 4)}${value.slice(-4)}`;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function matchesSavedQuery(entry: ResolvedSavedItem, query: string): boolean {
  if (!query) return true;

  const searchable = entry.item
    ? [
        entry.item.id,
        entry.item.name,
        entry.item.description,
        entry.item.author,
        entry.item.category,
        ...entry.item.tags
      ].join(' ')
    : entry.saved.id;

  return searchable.toLowerCase().includes(query);
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

function formatDate(value: string): string {
  return value.slice(0, 10);
}

export function listKnownItems(): MarketplaceItem[] {
  return getMarketplaceItems();
}
