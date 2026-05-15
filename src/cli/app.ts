import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { formatConfigJson } from '../config.js';
import { formatNumber } from '../format.js';
import { COMMANDS, renderManual } from './commands-meta.js';
import { runInteractiveMenu } from './menu.js';
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
import { installAgoraCommand } from '../commands.js';
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
import {
  createStyler,
  renderBanner,
  renderBox,
  renderMeander,
  shouldUseColor,
  supportsTrueColor,
  type Styler
} from '../ui.js';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};
export const AGORA_VERSION = pkg.version;
const VERSION = AGORA_VERSION;

// Active terminal styler. Reassigned once per `runCli` invocation from the
// caller's stream + env; defaults to plain so any direct formatter use is safe.
let style: Styler = createStyler(false);

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
  'continue',
  'dryRun',
  'help',
  'json',
  'live',
  'mcp',
  'offline',
  'version',
  'verbose',
  'write'
]);

/**
 * Returns true only when both stdout and stdin are real interactive TTYs AND the
 * environment supports colour (i.e. not NO_COLOR or TERM=dumb). The gate keeps
 * the interactive menu away from pipes, CI, and the test harness, all of which
 * use non-TTY mock streams.
 */
function isInteractive(io: CliIo, env: Record<string, string | undefined>): boolean {
  if (env.NO_COLOR != null) return false;
  if (env.TERM === 'dumb') return false;
  const stdoutTTY = Boolean((io.stdout as { isTTY?: boolean }).isTTY);
  const stdinTTY = Boolean((process.stdin as { isTTY?: boolean }).isTTY);
  return stdoutTTY && stdinTTY;
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const parsed = parseArgs(argv);
  const env = io.env ?? {};
  const useColor = shouldUseColor(
    io.stdout as { isTTY?: boolean },
    env,
    Boolean(parsed.flags.json)
  );
  style = createStyler(useColor, supportsTrueColor(env));

  if (parsed.flags.version) {
    writeLine(io.stdout, VERSION);
    return 0;
  }

  if (parsed.flags.help) {
    if (parsed.command && COMMANDS.some((c) => c.name === parsed.command)) {
      writeLine(io.stdout, commandManual(parsed.command));
    } else {
      writeLine(io.stdout, usage());
    }
    return 0;
  }

  if (!parsed.command) {
    if (isInteractive(io, env)) {
      const { runShell } = await import('./shell.js');
      return runShell(io, style);
    }
    writeLine(io.stdout, welcome(useColor, supportsTrueColor(env)));
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
        return await commandAuth(parsed, io);
      case 'login':
        return await commandAuth({ ...parsed, args: ['login', ...parsed.args], command: 'auth' }, io);
      case 'logout':
        return await commandAuth({ ...parsed, args: ['logout'], command: 'auth' }, io);
      case 'whoami':
        return await commandAuth({ ...parsed, args: ['status'], command: 'auth', flags: { ...parsed.flags, json: true } }, io);
      case 'config':
        return await commandConfig(parsed, io);
      case 'mcp':
        return await commandMcp(parsed, io);
      case 'chat':
        return await commandChat(parsed, io);
      case 'init':
        return await commandInit(parsed, io);
      case 'use':
        return await commandUse(parsed, io);
      case 'menu':
        return await runInteractiveMenu(io, style);
      case 'help': {
        const helpTarget = parsed.args[0];
        if (helpTarget) {
          const meta = COMMANDS.find((c) => c.name === helpTarget);
          if (!meta) {
            writeLine(io.stderr, `Unknown command: ${helpTarget}`);
            writeLine(io.stderr, 'Run `agora help` for a list of commands.');
            return 1;
          }
          writeLine(io.stdout, commandManual(helpTarget));
        } else {
          writeLine(io.stdout, usage());
        }
        return 0;
      }
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

  writeLine(
    io.stdout,
    header('agora search', [`"${query || 'all'}"`, `${results.length} results`, sourceLabel(result)])
  );
  writeLine(io.stdout, '');
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

  writeLine(io.stdout, header('agora trending', [category, sourceLabel(result)]));
  writeLine(io.stdout, '');
  writeLine(io.stdout, formatItemList(items));
  writeLine(io.stdout, '');
  writeLine(io.stdout, `${style.dim('tags')}  ${getTrendingTags().join(', ')}`);
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
  const workflows = result.data;
  warnFallback(result, io);

  if (parsed.flags.json) {
    writeJson(io.stdout, sourcePayload(result, { query, count: workflows.length, workflows }));
    return 0;
  }

  writeLine(
    io.stdout,
    header('agora workflows', [`${workflows.length} results`, sourceLabel(result)])
  );
  writeLine(io.stdout, '');
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

  writeLine(
    io.stdout,
    header('agora tutorials', [`${tutorials.length} results`, sourceLabel(result)])
  );
  writeLine(io.stdout, '');
  writeLine(io.stdout, formatTutorialList(tutorials));
  return 0;
}

async function commandTutorial(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const id = parsed.args[0];
  if (!id) {
    const { sampleTutorials } = await import('../data.js');
    writeLine(io.stdout, header('agora tutorial', [`${sampleTutorials.length} available tutorials`]));
    writeLine(io.stdout, '');
    writeLine(io.stdout, sampleTutorials.map((t) => `  ${style.accent(t.id.padEnd(22))} ${style.dim(t.title)} ${style.dim('[' + t.level + ']')}`).join('\n'));
    writeLine(io.stdout, '');
    writeLine(io.stdout, style.dim('Run `agora tutorial <id>` to start a tutorial.'));
    return 0;
  }

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

  writeLine(
    io.stdout,
    header('agora discussions', [`${discussions.length} results`, sourceLabel(result)])
  );
  writeLine(io.stdout, '');
  writeLine(
    io.stdout,
    discussions
      .map((discussion, index) => {
        return [
          `${index + 1}. ${style.accent(discussion.title)} ${style.dim('[' + discussion.category + ']')}`,
          `   ${truncate(discussion.content, 88)}`,
          `   ${style.dim('replies ' + discussion.replies + ' · stars ' + discussion.stars + ' · by ' + discussion.author)}`
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

  writeLine(io.stdout, `Created discussion ${style.accent(result.data.id)}`);
  writeLine(io.stdout, `${result.data.title} (${sourceLabel(result)})`);
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
    writeLine(io.stdout, `Installed ${style.accent(item.name)}`);
    writeLine(io.stdout, `${style.dim('Config')} ${configPath}`);
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

async function commandMcp(_parsed: ParsedArgs, io: CliIo): Promise<number> {
  const { runMcpServer } = await import('./mcp-server.js');
  try {
    await runMcpServer();
  } catch (error) {
    writeLine(io.stderr, error instanceof Error ? error.message : String(error));
    return 1;
  }
  return 0;
}

export const FREE_MODELS = ['deepseek-v4-flash-free', 'minimax-m2.5-free', 'nemotron-3-super-free'];

/** Regexp to extract session ID from a JSON opencode event line. */
function extractSessionId(line: string): string | null {
  try {
    const ev = JSON.parse(line);
    if (ev.sessionID && typeof ev.sessionID === 'string') return ev.sessionID;
  } catch {
    /* not JSON, skip */
  }
  return null;
}

/**
 * Persist the most recent chat session ID to the Agora state file so
 * `--continue` can pick it up.
 */
function persistChatSession(dataDir: string, sessionId: string): void {
  try {
    const state = loadAgoraState(dataDir);
    const updated = {
      ...state,
      _meta: { ...((state as any)._meta || {}), lastChatSession: sessionId }
    };
    writeAgoraState(dataDir, updated);
  } catch {
    // best-effort
  }
}

function loadLastChatSession(dataDir: string): string | undefined {
  try {
    const state = loadAgoraState(dataDir);
    return (state as any)._meta?.lastChatSession;
  } catch {
    return undefined;
  }
}

async function commandChat(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const message = parsed.args.join(' ');
  const model = stringFlag(parsed, 'model', 'm') || FREE_MODELS[0];
  const continueMode = parsed.flags.continue === true;
  const explicitSession = stringFlag(parsed, 'session', 's');
  const rawJson = parsed.flags.json === true;
  const modelArg = model.includes('/') ? model : `opencode/${model}`;

  if (!message) {
    // TUI mode — hand off to opencode with inherit stdio
    process.stderr.write(`Agora Chat (${model}) — press Ctrl+C to exit.\n`);

    const child = spawn('opencode', ['--model', modelArg], {
      env: io.env as Record<string, string>,
      stdio: 'inherit',
      shell: false
    });
    return new Promise((resolve) => {
      child.on('close', (code) => resolve(code ?? 0));
      child.on('error', (err) => {
        writeLine(io.stderr, `Failed to run opencode: ${err.message}`);
        resolve(1);
      });
    });
  }

  // One-shot mode — single message via opencode run
  return new Promise<number>((resolve) => {
    const args = ['run', '--format', 'json'];
    args.push('--model', modelArg);

    if (explicitSession) {
      args.push('--session', explicitSession);
    } else if (continueMode) {
      const dataDir = detectDataDir(parsed, io);
      const lastSession = loadLastChatSession(dataDir);
      if (lastSession) {
        args.push('--session', lastSession);
      } else {
        args.push('--continue');
      }
    }

    args.push(message);

    const stderrChunks: string[] = [];
    let sessionId: string | null = null;
    let wroteNewline = false;

    const child = spawn('opencode', args, {
      env: io.env as Record<string, string>,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      for (const line of text.split('\n').filter(Boolean)) {
        if (!sessionId) sessionId = extractSessionId(line);

        if (rawJson) {
          process.stdout.write(line + '\n');
          continue;
        }

        try {
          const ev = JSON.parse(line);
          if (ev.type === 'text' && ev.part?.text) {
            process.stdout.write(ev.part.text);
            wroteNewline = false;
          }
          if (ev.type === 'step_finish') {
            const tokens = ev.part?.tokens;
            if (tokens && !rawJson) {
              const cost = typeof tokens.cost === 'number' ? ` · $${tokens.cost.toFixed(6)}` : '';
              process.stdout.write(`\n\x1b[2m[${tokens.output} tokens${cost}]\x1b[0m\n`);
              wroteNewline = true;
            }
          }
        } catch {
          /* skip malformed lines */
        }
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk.toString());
    });

    child.on('close', (code) => {
      if (!wroteNewline) process.stdout.write('\n');

      if (sessionId) {
        const dataDir = detectDataDir(parsed, io);
        persistChatSession(dataDir, sessionId);
        if (!rawJson) {
          process.stdout.write(`\x1b[2mSession: ${sessionId.slice(0, 24)}…  `);
          process.stdout.write(`Continue: agora chat --session ${sessionId} "..."\x1b[0m\n`);
        }
      }

      if (code !== 0) {
        const errText = stderrChunks.join('');
        const modelError = errText.match(/Model not found:.*?Did you mean:\s*(.+?)\?/);
        if (modelError) {
          const suggestions = modelError[1];
          writeLine(io.stderr, `\nModel not available. Try: ${suggestions}`);
          writeLine(io.stderr, `Example: agora chat -m deepseek-v4-flash-free "your question"`);
        } else if (errText.includes('not found')) {
          writeLine(io.stderr, '\n' + errText.replace(/^.*?ERROR\s+/gm, '').trim());
        }
      }
      resolve(code ?? 0);
    });

    child.on('error', (err) => {
      writeLine(io.stderr, `Failed to run opencode: ${err.message}`);
      writeLine(io.stderr, 'Is opencode installed and in your PATH?');
      resolve(1);
    });
  });
}

async function commandInit(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const cwd = io.cwd || process.cwd();
  const scan = scanProject(cwd);
  const plan = generateInitPlan(scan);
  const configPath = detectOpenCodeConfigPath({ cwd, env: io.env });
  const withMcp = parsed.flags.mcp === true;

  if (withMcp) {
    plan.config.mcp = plan.config.mcp || {};
    plan.config.mcp.agora = {
      type: 'local',
      command: ['agora', 'mcp'],
      enabled: true
    };
    plan.servers.push('agora');
    plan.notes.push('Agora MCP server registered — OpenCode can discover marketplace tools.');
  }

  if (parsed.flags.json) {
    if (parsed.flags.dryRun) {
      writeJson(io.stdout, {
        projectType: scan.type,
        frameworks: scan.frameworks,
        config: plan.config,
        servers: plan.servers,
        commands: plan.commands,
        slashCommand: join(cwd, '.opencode', 'command', 'agora.md'),
        dryRun: true
      });
      return 0;
    }

    applyInitPlan(plan, configPath);
    const commandPath = installAgoraCommand(cwd);
    const installResults = plan.commands.length ? runCommands(plan.commands) : [];
    const installed = installResults.filter((r) => r.ok).length;
    const failed = installResults.filter((r) => !r.ok).length;

    writeJson(io.stdout, {
      projectType: scan.type,
      frameworks: scan.frameworks,
      config: plan.config,
      servers: plan.servers,
      commands: plan.commands,
      slashCommand: commandPath,
      installResults,
      installed,
      failed
    });
    return 0;
  }

  writeLine(io.stdout, `Scanning ${cwd}...`);
  writeLine(io.stdout, `  ${style.dim('Project type')} ${scan.type}`);
  if (scan.frameworks.length) writeLine(io.stdout, `  ${style.dim('Frameworks')} ${scan.frameworks.join(', ')}`);
  if (scan.hasDocker) writeLine(io.stdout, `  ${style.dim('Docker')} detected`);
  if (scan.hasTests) writeLine(io.stdout, `  ${style.dim('Tests')} detected`);
  if (scan.hasDatabase) writeLine(io.stdout, `  ${style.dim('Database')} detected`);

  if (!parsed.flags.dryRun) {
    applyInitPlan(plan, configPath);
    writeLine(io.stdout, `\nWrote config to ${configPath}`);

    const commandPath = installAgoraCommand(cwd);
    writeLine(io.stdout, `Installed /agora slash command at ${commandPath}`);

    if (plan.commands.length) {
      writeLine(io.stdout, '\nInstalling MCP server packages...');
      const isTTY = Boolean((io.stdout as { isTTY?: boolean }).isTTY);
      const n = plan.commands.length;
      const installResults: { command: string; ok: boolean }[] = [];
      for (let i = 0; i < n; i++) {
        const [result] = runCommands([plan.commands[i]]);
        installResults.push(result);
        if (isTTY && n > 1) {
          const pct = ((i + 1) / n) * 100;
          const bar = renderMeander({
            trueColor: supportsTrueColor(io.env ?? {}),
            mode: 'progress',
            pct
          });
          const line = `  ${bar}`;
          if (i < n - 1) {
            process.stdout.write(`\r\x1b[K${line}`);
          } else {
            process.stdout.write(`\r\x1b[K${line}\n`);
          }
        }
      }
      const installed = installResults.filter((r) => r.ok).length;
      const failed = installResults.filter((r) => !r.ok).length;
      writeLine(
        io.stdout,
        `  Installed ${installed} of ${plan.commands.length} packages${failed ? ` (${failed} failed)` : ''}`
      );
    }

    writeLine(io.stdout, '\n✓ Agora initialized! Restart OpenCode to pick up the changes.');
    writeLine(io.stdout, '  Plugin "opencode-agora" is now registered in your config.');
    writeLine(io.stdout, '  Type `/agora` in OpenCode to use the marketplace.');
    writeLine(io.stdout, `  ${plan.servers.length} MCP servers configured.`);
    if (withMcp)
      writeLine(
        io.stdout,
        '  Agora MCP server registered — `agora mcp` is available as an MCP tool.'
      );
    if (plan.workflows.length)
      writeLine(io.stdout, `  ${plan.workflows.length} workflows available via \`agora use\`.`);
    for (const note of plan.notes) writeLine(io.stdout, `  ${note}`);
  } else {
    writeLine(io.stdout, '\n--- Dry run ---');
    writeLine(io.stdout, `Target config: ${configPath}`);
    writeLine(io.stdout, formatConfigJson(plan.config));
    writeLine(io.stdout, `\nSlash command: ${join(cwd, '.opencode', 'command', 'agora.md')}`);
    writeLine(io.stdout, '\nPackages to install:');
    for (const cmd of plan.commands) writeLine(io.stdout, `  ${cmd}`);
    writeLine(io.stdout, '\nRun without --dry-run to apply.');
  }
  return 0;
}

async function commandUse(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const id = parsed.args[0];
  if (!id) {
    writeLine(io.stdout, header('agora use', [`${sampleWorkflows.length} available workflows`]));
    writeLine(io.stdout, '');
    writeLine(io.stdout, sampleWorkflows.map((wf) => `  ${style.accent(wf.id.padEnd(22))} ${style.dim(wf.name)}`).join('\n'));
    writeLine(io.stdout, '');
    writeLine(io.stdout, style.dim('Run `agora use <id>` to apply a workflow as a skill.'));
    return 0;
  }

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

  writeLine(io.stdout, `${style.dim('Config path')} ${report.path}`);
  writeLine(io.stdout, `${style.dim('Exists')} ${report.exists ? 'yes' : 'no'}`);
  writeLine(io.stdout, `${style.dim('Valid')} ${report.valid ? 'yes' : 'no'}`);
  if (report.error) writeLine(io.stdout, `${style.dim('Error')} ${report.error}`);
  writeLine(io.stdout, `${style.dim('MCP servers')} ${report.mcpServers}`);
  writeLine(io.stdout, `${style.dim('Plugins')} ${report.plugins}`);
  writeLine(io.stdout, `${style.dim('Packages')} ${report.packages.length ? report.packages.join(', ') : 'none'}`);
  return report.valid ? 0 : 1;
}

async function commandAuth(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const subcommand = parsed.args[0] || 'status';
  const dataDir = detectDataDir(parsed, io);
  const state = loadAgoraState(dataDir);
  const existingAuth = getAuthState(state);

  if (subcommand === 'login') {
    const explicitToken = authTokenInput(parsed, io);

    if (explicitToken) {
      // Token-paste flow (existing behaviour, for CI/automation)
      const apiUrl =
        stringFlag(parsed, 'apiUrl') || envString(io, 'AGORA_API_URL') || existingAuth?.apiUrl;
      const nextState = setAuthState(state, { token: explicitToken, apiUrl });
      const auth = getAuthState(nextState);
      writeAgoraState(dataDir, nextState);

      if (parsed.flags.json) {
        writeJson(io.stdout, authStatusPayload(dataDir, auth));
        return 0;
      }

      writeLine(io.stdout, 'Stored Agora API token');
      writeLine(io.stdout, `${style.dim('API URL')} ${auth?.apiUrl || 'not stored'}`);
      writeLine(io.stdout, `${style.dim('State')} ${getAgoraStatePath(dataDir)}`);
      return 0;
    }

    // ── Device-code flow ─────────────────────────────────────────────────
    const apiUrl =
      stringFlag(parsed, 'apiUrl') || envString(io, 'AGORA_API_URL') || existingAuth?.apiUrl;

    if (!apiUrl) {
      return usageError(io, 'auth login requires --api-url, AGORA_API_URL, or stored apiUrl');
    }

    const baseUrl = apiUrl.replace(/\/+$/, '');

    process.stdout.write(`\n${style.accent('Agora Login')}\n`);
    process.stdout.write(`${style.dim('Connecting to')} ${baseUrl}...\n`);

    try {
      const codeRes = await fetch(`${baseUrl}/auth/device/code`, { method: 'POST' });
      if (!codeRes.ok) {
        const err = await codeRes.json().catch(() => ({ error: 'request failed' }));
        return usageError(io, `Device code request failed: ${err.error || codeRes.status}`);
      }
      const codeData = (await codeRes.json()) as any;

      const verificationUri = codeData.verification_uri;
      const userCode = codeData.user_code;
      const deviceCode = codeData.device_code;
      const interval = (codeData.interval || 5) * 1000;

      process.stdout.write(`\n${style.accent(userCode.slice(0, 4) + ' ' + userCode.slice(4))}\n\n`);
      process.stdout.write(`  ${style.dim('Open in your browser:')} ${verificationUri}\n`);
      process.stdout.write(`  ${style.dim('Enter code:')}         ${userCode}\n\n`);

      // Try to open browser automatically
      try {
        const url = `${verificationUri}`;
        if (process.platform === 'darwin') {
          execSync(`open '${url}'`, { timeout: 3000 });
        } else if (process.platform === 'linux') {
          execSync(`xdg-open '${url}'`, { timeout: 3000 });
        }
        process.stdout.write(`  ${style.dim('Browser opened.')}\n\n`);
      } catch {
        process.stdout.write(`  ${style.dim('Open the URL manually.')}\n\n`);
      }

      // Poll for token
      const pollStart = Date.now();
      const pollTimeout = 15 * 60 * 1000; // 15 minutes

      for (;;) {
        await new Promise((r) => setTimeout(r, interval));

        if (Date.now() - pollStart > pollTimeout) {
          return usageError(io, 'Login timed out. Run `agora auth login` to try again.');
        }

        process.stdout.write(`\r\x1b[K${style.dim('Waiting for browser authorization...')}`);

        try {
          const tokenRes = await fetch(`${baseUrl}/auth/device/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_code: deviceCode })
          });

          if (tokenRes.ok) {
            const tokenData = (await tokenRes.json()) as any;
            const jwt = tokenData.access_token;

            process.stdout.write(`\r\x1b[K${style.dim('Authorization received.')}\n`);

            const nextState = setAuthState(state, { token: jwt, apiUrl });
            writeAgoraState(dataDir, nextState);

            if (parsed.flags.json) {
              writeJson(io.stdout, authStatusPayload(dataDir, getAuthState(nextState)));
              return 0;
            }

            process.stdout.write(`\n${style.accent('✓ Authenticated')}\n`);
            process.stdout.write(`${style.dim('API URL')} ${baseUrl}\n`);
            process.stdout.write(`${style.dim('Token expires')} in 1 hour\n`);
            process.stdout.write(`${style.dim('State')} ${getAgoraStatePath(dataDir)}\n`);
            return 0;
          }

          const errData = await tokenRes.json().catch(() => ({ error: 'unknown' }));
          if (errData.error === 'expired') {
            process.stdout.write(`\r\x1b[K`);
            return usageError(io, 'Code expired. Run `agora auth login` again.');
          }
          // "authorization_pending" is expected — keep polling
        } catch {
          // Network error, retry
        }
      }
    } catch (e: any) {
      return usageError(io, `Login failed: ${e.message || 'connection error'}`);
    }
  }

  if (subcommand === 'status') {
    if (parsed.flags.json) {
      writeJson(io.stdout, authStatusPayload(dataDir, existingAuth));
      return 0;
    }

    writeLine(io.stdout, `${style.dim('Authenticated')} ${existingAuth ? 'yes' : 'no'}`);
    if (existingAuth) {
      writeLine(io.stdout, `${style.dim('Token')} ${maskToken(existingAuth.token)}`);
      writeLine(io.stdout, `${style.dim('API URL')} ${existingAuth.apiUrl || 'not stored'}`);
      writeLine(io.stdout, `${style.dim('Saved')} ${formatDate(existingAuth.savedAt)}`);
    }
    writeLine(io.stdout, `${style.dim('State')} ${getAgoraStatePath(dataDir)}`);
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

  writeLine(io.stdout, result.added ? `Saved ${style.accent(item.id)}` : `${style.accent(item.id)} is already saved`);
  writeLine(io.stdout, `${style.dim('State')} ${getAgoraStatePath(dataDir)}`);
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

  writeLine(io.stdout, header('agora saved', [`${saved.length} items`]));
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

  writeLine(io.stdout, `Removed ${style.accent(targetId)}`);
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

    writeLine(io.stdout, `Published package ${style.accent(result.data.id)}`);
    writeLine(io.stdout, `${result.data.name} (${sourceLabel(result)})`);
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

  writeLine(io.stdout, `Published workflow ${style.accent(result.data.id)}`);
  writeLine(io.stdout, `${result.data.name} (${sourceLabel(result)})`);
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

  writeLine(io.stdout, `Reviewed ${style.accent(result.data.itemId)}`);
  writeLine(io.stdout, `${style.dim(result.data.rating + '/5 by ' + result.data.author)}`);
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

  writeLine(
    io.stdout,
    header('agora reviews', [`${result.data.length} results`, sourceLabel(result)])
  );
  writeLine(io.stdout, '');
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
  const idWidth = Math.max(...items.map((item) => item.id.length));
  return items
    .map((item) => {
      const metrics =
        item.kind === 'package'
          ? `${formatNumber(item.installs)} installs · ${formatNumber(item.stars)} ★`
          : `${formatNumber(item.stars)} ★`;
      return [
        `${style.accent(item.id.padEnd(idWidth))}  ${style.dim(metrics)}`,
        style.dim(item.name),
        truncate(item.description, 88),
        style.dim(`${item.category} · by ${item.author}`)
      ].join('\n');
    })
    .join('\n\n');
}

function formatItemDetail(item: MarketplaceItem): string {
  const lines = [
    style.bold(item.name),
    `${style.dim('id')}        ${style.accent(item.id)}`,
    `${style.dim('type')}      ${item.kind}`,
    `${style.dim('category')}  ${item.category}`,
    `${style.dim('author')}    ${item.author}`,
    `${style.dim('stars')}     ${formatNumber(item.stars)}`,
    `${style.dim('install')}   ${getInstallKind(item)}`,
    '',
    item.description,
    '',
    `${style.dim('tags')}      ${item.tags.join(', ')}`
  ];

  if (item.kind === 'package') {
    lines.splice(5, 0, `${style.dim('version')}   ${item.version}`);
    lines.push(`${style.dim('installs')}  ${formatNumber(item.installs)}`);
    if (item.repository) lines.push(`${style.dim('repo')}      ${item.repository}`);
    if (item.npmPackage) lines.push(`${style.dim('npm')}       ${item.npmPackage}`);
  }

  if (item.kind === 'workflow') {
    lines.push(`${style.dim('forks')}     ${item.forks}`);
    if (item.model) lines.push(`${style.dim('model')}     ${item.model}`);
    lines.push('', style.dim('prompt'), item.prompt);
  }

  return lines.join('\n');
}

function formatSavedList(items: ResolvedSavedItem[]): string {
  return items
    .map((entry, index) => {
      if (!entry.item) {
        return [
          `${index + 1}. ${style.accent(entry.saved.id)} ${style.dim('[missing]')}`,
          `   ${style.dim('saved ' + formatDate(entry.saved.savedAt))}`
        ].join('\n');
      }

      return [
        `${index + 1}. ${style.accent(entry.item.id)} ${style.dim('[' + entry.item.category + ']')}`,
        `   ${style.dim(entry.item.name)}`,
        `   ${truncate(entry.item.description, 88)}`,
        `   ${style.dim('saved ' + formatDate(entry.saved.savedAt))}`
      ].join('\n');
    })
    .join('\n\n');
}

function formatReviewList(reviews: ApiReview[]): string {
  return reviews
    .map((review, index) => {
      return [
        `${index + 1}. ${style.accent(review.itemId)} ${style.dim('[' + review.itemType + ']')}`,
        `   ${style.dim('rating ' + review.rating + '/5 by ' + review.author)}`,
        `   ${truncate(review.content, 88)}`
      ].join('\n');
    })
    .join('\n\n');
}

function formatProfileDetail(profile: ApiProfile): string {
  const lines = [
    style.bold(profile.displayName),
    `${style.dim('username')} ${style.accent(profile.username)}`,
    `${style.dim('packages')} ${formatNumber(profile.packages)}`,
    `${style.dim('workflows')} ${formatNumber(profile.workflows)}`,
    `${style.dim('discussions')} ${formatNumber(profile.discussions)}`
  ];

  if (profile.bio) lines.splice(2, 0, `${style.dim('bio')} ${profile.bio}`);
  if (profile.avatarUrl) lines.push(`${style.dim('avatar')} ${profile.avatarUrl}`);
  if (profile.joinedAt) lines.push(`${style.dim('joined')} ${formatDate(profile.joinedAt)}`);

  return lines.join('\n');
}

function formatTutorialList(tutorials: Tutorial[]): string {
  return tutorials
    .map((tutorial, index) => {
      return [
        `${index + 1}. ${style.accent(tutorial.id)} ${style.dim('[' + tutorial.level + ']')}`,
        `   ${style.dim(tutorial.title)}`,
        `   ${truncate(tutorial.description, 88)}`,
        `   ${style.dim(tutorial.duration + ' | ' + tutorial.steps.length + ' steps')}`
      ].join('\n');
    })
    .join('\n\n');
}

function formatTutorialStep(tutorial: Tutorial, stepNumber: number): string {
  const payload = tutorialStepPayload(tutorial, stepNumber);

  if (payload.completed) {
    return [
      style.bold(tutorial.title),
      style.dim(`Completed ${tutorial.steps.length}/${tutorial.steps.length} steps.`),
      'Run agora tutorials for more tutorials.'
    ].join('\n');
  }

  const lines = [
    style.bold(tutorial.title),
    `${style.dim('id')} ${style.accent(tutorial.id)}`,
    `${style.dim('level')} ${tutorial.level}`,
    `${style.dim('duration')} ${tutorial.duration}`,
    `${style.dim('step')} ${payload.stepNumber}/${tutorial.steps.length}`,
    '',
    payload.title || '',
    payload.content || ''
  ];

  if (payload.code) {
    lines.push('', style.dim('code:'), payload.code);
  }

  return lines.join('\n');
}

function welcome(color: boolean, trueColor: boolean): string {
  if (!color) {
    return [
      '',
      `agora · terminal marketplace for OpenCode · v${VERSION}`,
      '',
      '  Search    agora search <query>',
      '  Browse    agora trending · agora browse <id>',
      '  Learn     agora tutorials · agora tutorial <id>',
      '  Install   agora install <id> [--write]',
      '  Setup     agora init [--mcp] · agora use <workflow>',
      '  Auth      agora login [--api-url <url>]',
      ''
    ].join('\n');
  }
  const banner = renderBanner({ color, trueColor });
  const box = renderBox(
    'Welcome to Agora',
    [
      "The developer's terminal marketplace for OpenCode",
      `v${VERSION} · run \`agora help\` to get started`
    ],
    { color, trueColor }
  );
  const hint = [
    `${style.dim('Search')}    agora search <query>`,
    `${style.dim('Browse')}    agora trending · agora browse <id>`,
    `${style.dim('Learn')}     agora tutorials · agora tutorial <id>`,
    `${style.dim('Install')}   agora install <id> [--write]`,
    `${style.dim('Setup')}     agora init [--mcp] · agora use <workflow>`,
    `${style.dim('Auth')}      agora login [--api-url <url>]`
  ].join('\n');
  return `\n${banner}\n\n${box}\n\n${hint}\n`;
}

/** Flat-minimal section header: accent title, dim ` · `-joined metadata. */
function header(title: string, meta: string[]): string {
  return [style.accent(title), ...meta.map((part) => style.dim(part))].join(style.dim(' · '));
}

function usage(): string {
  const nameWidth = Math.max(...COMMANDS.map((c) => c.name.length));
  const groups = ['Marketplace', 'Setup', 'Library', 'Learn', 'Community'] as const;

  const lines: string[] = [
    `${style.accent('agora')}${style.dim(` · terminal marketplace for OpenCode · v${VERSION}`)}`,
    ''
  ];

  for (const group of groups) {
    const groupCmds = COMMANDS.filter((c) => c.group === group);
    lines.push(style.dim(group));
    for (const cmd of groupCmds) {
      lines.push(`  ${style.accent(cmd.name.padEnd(nameWidth))}  ${style.dim(cmd.summary)}`);
    }
    lines.push('');
  }

  lines.push(style.dim('Run `agora help <command>` for details on any command.'));

  return lines.join('\n');
}

export function commandManual(name: string): string {
  const meta = COMMANDS.find((c) => c.name === name);
  if (!meta) return '';
  return renderManual(meta, style);
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
  if (flag === 'm') return 'model';
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

function sourceLabel(result: { source: string }): string {
  return result.source === 'offline'
    ? `source: offline · refreshed ${dataRefreshedAt}`
    : `source: ${result.source}`;
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

function formatDate(value: string): string {
  return value.slice(0, 10);
}

export function listKnownItems(): MarketplaceItem[] {
  return getMarketplaceItems();
}
