import { execSync, execFileSync, spawnSync } from 'node:child_process';
import { readNewsMeta, readCache } from '../../news/cache.js';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { formatConfigJson } from '../../config.js';
import {
  detectOpenCodeConfigPath,
  doctorOpenCodeConfig,
  loadOpenCodeConfig,
  writeOpenCodeConfig
} from '../../config-files.js';
import { createInstallPlan, hasPermissions, renderPermissionLines } from '../../marketplace.js';
import {
  findMarketplaceSource,
  publishPackageSource,
  publishWorkflowSource,
  createReviewSource,
  listReviewsSource,
  profileSource
} from '../../live.js';
import {
  clearAuthState,
  decodeJwtExp,
  detectAgoraDataDir,
  getAuthState,
  getAgoraStatePath,
  loadAgoraState,
  removeItemFromState,
  resolveSavedItems,
  saveItemToState,
  setAuthState,
  writeAgoraState
} from '../../state.js';
import { loadPreferences, writePreferences, prefsPath } from '../../preferences.js';
import { loadHistory, clearHistory } from '../../history.js';
import {
  stringFlag,
  requiredStringFlag,
  numberFlag,
  envString,
  authTokenInput,
  sourceOptions,
  writeSourceOptions,
  readSourceOptions,
  sourceLabel,
  sourcePayload,
  warnFallback,
  writeLine,
  writeJson,
  usageError,
  detectDataDir,
  authStatusPayload,
  maskToken,
  formatRelativeExp,
  matchesSavedQuery,
  tagsFlag,
  promptInput,
  itemTypeFlag
} from '../helpers.js';
import {
  header,
  formatSavedList,
  formatReviewList,
  formatProfileDetail,
  formatDate
} from '../format.js';
import type { CommandHandler } from './types.js';

export const commandInstall: CommandHandler = async (parsed, io, style) => {
  const id = parsed.args[0];
  if (!id) return usageError(io, 'install requires an item id');

  const source = await findMarketplaceSource({
    ...(await sourceOptions(parsed, io)),
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

  const dataDir = detectDataDir(parsed, io);
  const plan = createInstallPlan(item, loaded.config, { dataDir });
  if (!plan.installable) return usageError(io, plan.reason || `${item.name} is not installable`);

  if (parsed.flags.json) {
    writeJson(io.stdout, {
      source: source.source,
      apiUrl: source.apiUrl,
      fallbackReason: source.fallbackReason,
      item,
      configPath,
      write: Boolean(parsed.flags.write),
      kind: plan.kind,
      commands: plan.commands,
      notes: plan.notes,
      config: plan.config,
      cloneTarget: plan.cloneTarget,
      postInstallHint: plan.postInstallHint
    });
    return 0;
  }

  if (parsed.flags.write) {
    if (hasPermissions(plan.permissions)) {
      if (!parsed.flags.yes && !parsed.flags.y) {
        for (const line of renderPermissionLines(plan.permissions)) writeLine(io.stdout, line);
        writeLine(io.stdout, '');
        writeLine(
          io.stdout,
          style.dim(
            'This package declares permissions. Re-run with --yes to grant and install.'
          )
        );
        return 1;
      }
      writeLine(io.stdout, 'Granted permissions:');
      for (const line of renderPermissionLines(plan.permissions)) writeLine(io.stdout, line);
      writeLine(io.stdout, '');
    }
    if (plan.kind === 'git-clone') {
      if (plan.cloneTarget) {
        try {
          mkdirSync(plan.cloneTarget, { recursive: true });
        } catch {
          /* ignore if already exists */
        }
      }
      if (plan.commands.length) {
        writeLine(io.stdout, 'Cloning repository...');
        for (const cmd of plan.commands) {
          try {
            execSync(cmd, { stdio: 'pipe', timeout: 60000 });
            writeLine(io.stdout, `  ✓ ${cmd}`);
          } catch (err: any) {
            writeLine(io.stderr, `  ! Failed: ${cmd}`);
            if (err.stderr) writeLine(io.stderr, String(err.stderr));
          }
        }
      }
      writeLine(io.stdout, `Installed ${style.accent(item.name)}`);
      if (plan.cloneTarget) writeLine(io.stdout, `${style.dim('Location')} ${plan.cloneTarget}`);
      if (plan.postInstallHint)
        writeLine(io.stdout, `${style.dim('Next steps')} ${plan.postInstallHint}`);
    } else if (plan.kind === 'package-install') {
      if (plan.commands.length) {
        writeLine(io.stdout, 'Installing packages...');
        for (const cmd of plan.commands) {
          try {
            execSync(cmd, { stdio: 'pipe', timeout: 120000 });
            writeLine(io.stdout, `  ✓ ${cmd}`);
          } catch {
            writeLine(io.stderr, `  ! Failed: ${cmd} (may already be installed)`);
          }
        }
      }
      writeLine(io.stdout, `Installed ${style.accent(item.name)}`);
    } else {
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
            writeLine(io.stderr, `  ! Failed: ${cmd} (may already be installed)`);
          }
        }
      }
    }
    return 0;
  }

  writeLine(io.stdout, `Install preview: ${item.name}`);

  const permLines = renderPermissionLines(plan.permissions);
  writeLine(io.stdout, '');
  for (const line of permLines) writeLine(io.stdout, line);

  if (plan.kind === 'git-clone') {
    writeLine(io.stdout, `Kind: git-clone`);
    if (plan.cloneTarget) writeLine(io.stdout, `Target directory: ${plan.cloneTarget}`);
    if (plan.commands.length) {
      writeLine(io.stdout, '\nCommands:');
      writeLine(io.stdout, plan.commands.join('\n'));
    }
    if (plan.postInstallHint) writeLine(io.stdout, `\nNext steps: ${plan.postInstallHint}`);
  } else if (plan.kind === 'package-install') {
    writeLine(io.stdout, `Kind: package-install`);
    if (plan.commands.length) {
      writeLine(io.stdout, '\nCommands:');
      writeLine(io.stdout, plan.commands.join('\n'));
    }
  } else {
    writeLine(io.stdout, `Target config: ${configPath}`);
    if (plan.commands.length) {
      writeLine(io.stdout, '\nCommands:');
      writeLine(io.stdout, plan.commands.join('\n'));
    }
    writeLine(io.stdout, '\nopencode.json preview:');
    writeLine(io.stdout, formatConfigJson(plan.config));
  }

  if (!parsed.flags.yes && !parsed.flags.y) {
    writeLine(io.stdout, '\nRun with --write to update the config file and install packages.');
  } else {
    // --yes/-y: execute immediately (still showed preview above)
    if (plan.kind === 'git-clone') {
      if (plan.cloneTarget) {
        try {
          mkdirSync(plan.cloneTarget, { recursive: true });
        } catch {
          /* ignore */
        }
      }
      for (const cmd of plan.commands) {
        try {
          execSync(cmd, { stdio: 'pipe', timeout: 60000 });
          writeLine(io.stdout, `  ✓ ${cmd}`);
        } catch (err: any) {
          writeLine(io.stdout, `  ! Failed: ${cmd}`);
          if (err.stderr) writeLine(io.stdout, String(err.stderr));
        }
      }
      if (plan.postInstallHint) writeLine(io.stdout, `Next steps: ${plan.postInstallHint}`);
    } else if (plan.kind === 'package-install') {
      for (const cmd of plan.commands) {
        try {
          execSync(cmd, { stdio: 'pipe', timeout: 120000 });
          writeLine(io.stdout, `  ✓ ${cmd}`);
        } catch {
          writeLine(io.stdout, `  ! Failed: ${cmd} (may already be installed)`);
        }
      }
    } else {
      writeOpenCodeConfig(configPath, plan.config);
      for (const cmd of plan.commands) {
        try {
          execSync(cmd, { stdio: 'pipe', timeout: 120000 });
          writeLine(io.stdout, `  ✓ ${cmd}`);
        } catch {
          writeLine(io.stdout, `  ! Failed: ${cmd} (may already be installed)`);
        }
      }
    }
    writeLine(io.stdout, `Installed ${style.accent(item.name)}`);
  }

  return 0;
};

export const commandMcp: CommandHandler = async (_parsed, io, _style) => {
  const { runMcpServer } = await import('../mcp-server.js');
  try {
    await runMcpServer();
  } catch (error) {
    writeLine(io.stderr, error instanceof Error ? error.message : String(error));
    return 1;
  }
  return 0;
};

export const commandSave: CommandHandler = async (parsed, io, style) => {
  const id = parsed.args[0];
  if (!id) return usageError(io, 'save requires an item id');

  const source = await findMarketplaceSource({
    ...(await sourceOptions(parsed, io)),
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

  writeLine(
    io.stdout,
    result.added ? `Saved ${style.accent(item.id)}` : `${style.accent(item.id)} is already saved`
  );
  writeLine(io.stdout, `${style.dim('State')} ${getAgoraStatePath(dataDir)}`);
  return 0;
};

export const commandSaved: CommandHandler = async (parsed, io, style) => {
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

  writeLine(io.stdout, header('agora saved', [`${saved.length} items`], style));
  writeLine(io.stdout, formatSavedList(saved, style));
  return 0;
};

export const commandRemove: CommandHandler = async (parsed, io, style) => {
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
};

export const commandPublish: CommandHandler = async (parsed, io, style) => {
  const kind = parsed.args[0];

  if (kind !== 'package' && kind !== 'workflow') {
    return usageError(io, 'publish requires "package" or "workflow"');
  }

  const source = await writeSourceOptions(parsed, io);
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
};

export const commandReview: CommandHandler = async (parsed, io, style) => {
  const itemId = parsed.args[0];
  if (!itemId) return usageError(io, 'review requires an item id');

  const rating = numberFlag(parsed, 'rating', 'r');
  const content = requiredStringFlag(parsed, 'content');
  if (!rating || rating < 1 || rating > 5 || !content) {
    return usageError(io, 'review requires --rating 1-5 and --content');
  }

  const source = await writeSourceOptions(parsed, io);
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
};

export const commandReviews: CommandHandler = async (parsed, io, style) => {
  const itemId = parsed.args[0];
  const source = await readSourceOptions(parsed, io);
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
    header('agora reviews', [`${result.data.length} results`, sourceLabel(result)], style)
  );
  writeLine(io.stdout, '');
  writeLine(io.stdout, formatReviewList(result.data, style));
  return 0;
};

export const commandProfile: CommandHandler = async (parsed, io, style) => {
  const username = parsed.args[0] || stringFlag(parsed, 'username');
  if (!username) return usageError(io, 'profile requires a username');

  const source = await readSourceOptions(parsed, io);
  if (!source.ok) return usageError(io, source.error);

  const result = await profileSource(source.options, username);
  if (!result.data) return usageError(io, `Profile not found: ${username}`);

  if (parsed.flags.json) {
    writeJson(io.stdout, sourcePayload(result, { profile: result.data }));
    return 0;
  }

  writeLine(io.stdout, formatProfileDetail(result.data, style));
  return 0;
};

export const commandPreferences: CommandHandler = async (parsed, io, _style) => {
  const dataDir = detectDataDir(parsed, io);
  const prefs = loadPreferences(dataDir);
  const sub = parsed.args[0];

  if (!sub) {
    if (parsed.flags.json) {
      writeJson(io.stdout, prefs);
      return 0;
    }
    writeLine(io.stdout, `Preferences (${prefsPath(dataDir)})`);
    writeLine(io.stdout, `  theme:      ${prefs.theme}`);
    writeLine(io.stdout, `  verbosity:  ${prefs.verbosity}`);
    writeLine(io.stdout, `  username:   ${prefs.username || '(not set)'}`);
    writeLine(io.stdout, `  email:      ${prefs.email || '(not set)'}`);
    writeLine(
      io.stdout,
      `  bio:        ${prefs.bio ? prefs.bio.slice(0, 60) + (prefs.bio.length > 60 ? '...' : '') : '(not set)'}`
    );
    writeLine(io.stdout, '');
    writeLine(io.stdout, '  Set values:  agora preferences <key> <value>');
    writeLine(io.stdout, '  Keys:        theme, verbosity, username, email, bio');
    return 0;
  }

  const key = sub as keyof typeof prefs;
  const val = parsed.args.slice(1).join(' ');

  if (!val || !(key in prefs)) {
    return usageError(
      io,
      `Usage: agora preferences <key> <value>\nValid keys: theme, verbosity, username, email, bio`
    );
  }

  if (key === 'theme' && !['dark', 'light', 'auto'].includes(val)) {
    return usageError(io, 'theme must be: dark, light, or auto');
  }
  if (key === 'verbosity' && !['verbose', 'medium', 'quiet'].includes(val)) {
    return usageError(io, 'verbosity must be: verbose, medium, or quiet');
  }

  (prefs as unknown as Record<string, string>)[key] = val;
  writePreferences(dataDir, prefs);
  writeLine(io.stdout, `\u2713 ${key} set to "${val}"`);
  return 0;
};

export const commandHistory: CommandHandler = async (parsed, io, style) => {
  const dataDir = detectDataDir(parsed, io);
  const limit = numberFlag(parsed, 'limit', 'n') || 50;

  if (parsed.flags.clear) {
    clearHistory(dataDir);
    writeLine(io.stdout, '\u2713 History cleared');
    return 0;
  }

  const entries = loadHistory(dataDir, limit);

  if (parsed.flags.json) {
    writeJson(io.stdout, entries);
    return 0;
  }

  if (entries.length === 0) {
    writeLine(io.stdout, 'No history yet.');
    writeLine(io.stdout, 'Searches and chat messages are recorded automatically.');
    return 0;
  }

  writeLine(io.stdout, `Recent history (${entries.length}):`);
  for (const entry of entries) {
    const icon = entry.type === 'search' ? '\uD83D\uDD0D' : '\uD83D\uDCAC';
    const date = new Date(entry.timestamp).toLocaleString();
    const query = entry.query.length > 60 ? entry.query.slice(0, 60) + '...' : entry.query;
    writeLine(io.stdout, `  ${icon} ${style.dim(date)}  ${query}`);
  }
  writeLine(io.stdout, '');
  writeLine(io.stdout, style.dim('Use --clear to clear history, --json for JSON output.'));
  return 0;
};

export const commandConfig: CommandHandler = async (parsed, io, style) => {
  const subcommand = parsed.args[0] || 'doctor';
  const doFix = Boolean(parsed.flags.fix);

  if (subcommand === 'show') {
    const configPath = detectOpenCodeConfigPath({
      explicitPath: stringFlag(parsed, 'config'),
      cwd: io.cwd,
      env: io.env
    });
    const loaded = loadOpenCodeConfig(configPath);
    if (parsed.flags.json) {
      writeJson(io.stdout, { path: configPath, exists: loaded.exists, config: loaded.config });
      return 0;
    }
    writeLine(io.stdout, style.accent('OpenCode config'));
    writeLine(io.stdout, `${style.dim('Path')}   ${configPath}`);
    writeLine(io.stdout, `${style.dim('Exists')} ${loaded.exists ? 'yes' : 'no'}`);
    if (!loaded.exists) return 0;
    writeLine(io.stdout, '');
    writeLine(io.stdout, formatConfigJson(loaded.config));
    return 0;
  }

  if (subcommand === 'edit') {
    const configPath = detectOpenCodeConfigPath({
      explicitPath: stringFlag(parsed, 'config'),
      cwd: io.cwd,
      env: io.env
    });
    if (!existsSync(configPath)) {
      writeFileSync(configPath, '{\n  "$schema": "https://opencode.ai/config.json"\n}\n', 'utf8');
      writeLine(io.stdout, `Created ${configPath}`);
    }
    const editorRaw = io.env?.EDITOR || io.env?.VISUAL || 'vi';
    const editorParts = editorRaw.trim().split(/\s+/);
    const editorBin = editorParts[0]!;
    const editorArgs = [...editorParts.slice(1), configPath];
    try {
      execFileSync(editorBin, editorArgs, { stdio: 'inherit' });
      writeLine(io.stdout, style.dim('Config saved.'));
    } catch {
      return usageError(io, `Editor "${editorRaw}" failed. Set $EDITOR or try manually: nano ${configPath}`);
    }
    return 0;
  }

  if (subcommand === 'diff') {
    const paths = parsed.args.slice(1);
    if (paths.length < 2) {
      return usageError(io, 'config diff requires two paths.\nUsage: agora config diff <path1> <path2>');
    }
    const [loaded1, loaded2] = await Promise.all([
      Promise.resolve(loadOpenCodeConfig(paths[0])),
      Promise.resolve(loadOpenCodeConfig(paths[1]))
    ]);

    if (parsed.flags.json) {
      writeJson(io.stdout, { path1: loaded1, path2: loaded2 });
      return 0;
    }

    const diffLines: string[] = [];
    const c1 = loaded1.config;
    const c2 = loaded2.config;

    diffLines.push(style.accent('Config diff'));
    diffLines.push(`${style.dim(paths[0])} vs ${style.dim(paths[1])}`);
    diffLines.push('');

    if (c1.$schema !== c2.$schema) {
      diffLines.push(`  $schema: ${style.dim(c1.$schema || '(none)')} → ${style.accent(c2.$schema || '(none)')}`);
    }

    const mcpKeys1 = Object.keys(c1.mcp || {});
    const mcpKeys2 = Object.keys(c2.mcp || {});
    const mcpAdded = mcpKeys2.filter((k) => !mcpKeys1.includes(k));
    const mcpRemoved = mcpKeys1.filter((k) => !mcpKeys2.includes(k));
    if (mcpRemoved.length > 0) diffLines.push(`  MCP removed: ${style.dim(mcpRemoved.join(', '))}`);
    if (mcpAdded.length > 0) diffLines.push(`  MCP added:   ${style.accent(mcpAdded.join(', '))}`);

    const plug1 = new Set(c1.plugin || []);
    const plug2 = new Set(c2.plugin || []);
    const plugAdded = [...plug2].filter((p) => !plug1.has(p));
    const plugRemoved = [...plug1].filter((p) => !plug2.has(p));
    if (plugRemoved.length > 0) diffLines.push(`  Plugin removed: ${style.dim(plugRemoved.join(', '))}`);
    if (plugAdded.length > 0) diffLines.push(`  Plugin added:   ${style.accent(plugAdded.join(', '))}`);

    diffLines.push('');
    diffLines.push(style.dim('MCP server count: ' + mcpKeys1.length + ' → ' + mcpKeys2.length));
    diffLines.push(style.dim('Plugin count:     ' + (c1.plugin?.length || 0) + ' → ' + (c2.plugin?.length || 0)));

    for (const line of diffLines) writeLine(io.stdout, line);
    return 0;
  }

  if (subcommand !== 'doctor') {
    return usageError(io, `Unknown config command: ${subcommand}`);
  }

  const configPath = detectOpenCodeConfigPath({
    explicitPath: stringFlag(parsed, 'config'),
    cwd: io.cwd,
    env: io.env
  });
  let report = doctorOpenCodeConfig(configPath);

  if (doFix) {
    const fixes: string[] = [];
    const loaded = loadOpenCodeConfig(configPath);
    let changed = false;
    const config = loaded.config;

    // Fix 1: Add missing $schema
    if (!config.$schema) {
      config.$schema = 'https://opencode.ai/config.json';
      fixes.push('Added missing $schema field');
      changed = true;
    }

    // Fix 2: Deduplicate plugins
    if (config.plugin) {
      const originalLen = config.plugin.length;
      const deduped = [...new Set(config.plugin)];
      if (deduped.length !== originalLen) {
        fixes.push(`Removed ${originalLen - deduped.length} duplicate plugin entries`);
        config.plugin = deduped;
        changed = true;
      }
    }

    // Fix 3: Remove MCP entries with empty or invalid commands
    if (config.mcp) {
      for (const [key, entry] of Object.entries(config.mcp)) {
        if (!entry.command || entry.command.length === 0) {
          delete config.mcp[key];
          fixes.push(`Removed MCP entry "${key}" with empty command`);
          changed = true;
        }
      }
    }

    if (changed) {
      writeOpenCodeConfig(configPath, config);
      report = doctorOpenCodeConfig(configPath);
    }

    if (parsed.flags.json) {
      writeJson(io.stdout, { ...report, fixes, fixed: changed });
      return changed ? 0 : 1;
    }

    if (fixes.length > 0) {
      writeLine(io.stdout, style.accent('Config fixed:'));
      for (const f of fixes) writeLine(io.stdout, `  ✓ ${f}`);
      writeLine(io.stdout, '');
    } else {
      writeLine(io.stdout, style.dim('No fixes needed.'));
    }
  }

  if (parsed.flags.json && !doFix) {
    writeJson(io.stdout, report);
    return report.valid ? 0 : 1;
  }

  writeLine(io.stdout, `${style.dim('Config path')} ${report.path}`);
  writeLine(io.stdout, `${style.dim('Exists')} ${report.exists ? 'yes' : 'no'}`);
  writeLine(io.stdout, `${style.dim('Valid')} ${report.valid ? 'yes' : 'no'}`);
  if (report.error) writeLine(io.stdout, `${style.dim('Error')} ${report.error}`);
  writeLine(io.stdout, `${style.dim('MCP servers')} ${report.mcpServers}`);
  writeLine(io.stdout, `${style.dim('Plugins')} ${report.plugins}`);
  writeLine(
    io.stdout,
    `${style.dim('Packages')} ${report.packages.length ? report.packages.join(', ') : 'none'}`
  );

  // Deep checks
  if (!doFix) {
    writeLine(io.stdout, '');
    writeLine(io.stdout, style.dim('Deep checks (--deep for details):'));
  }
  if (parsed.flags.deep || doFix) {
    const loaded = loadOpenCodeConfig(configPath);
    const deepIssues: string[] = [];
    const deepOk: string[] = [];

    // Check opencode on PATH
    try {
      execSync('which opencode', { stdio: 'pipe', timeout: 2000 });
      deepOk.push('opencode found on PATH');
    } catch {
      deepIssues.push('opencode not found on PATH — chat unavailable');
    }

    // Check npm packages in MCP commands
    if (loaded.config.mcp) {
      for (const [key, entry] of Object.entries(loaded.config.mcp)) {
        for (const part of entry.command) {
          const npmMatch = part.match(/^(@[^/]+\/[^@\s]+|[^@\s]+)$/);
          if (npmMatch && (part.startsWith('npx ') || entry.command[0] === 'npx')) {
            const pkgName = npmMatch[1];
            try {
              execSync(`npm view ${pkgName} version`, { stdio: 'pipe', timeout: 10000 });
              deepOk.push(`${key}: npm package ${pkgName} exists`);
            } catch {
              deepIssues.push(`${key}: npm package "${pkgName}" not found or network error`);
            }
          }
        }
      }
    }

    // Check GitHub token
    if (io.env?.AGORA_GITHUB_TOKEN) {
      deepOk.push('AGORA_GITHUB_TOKEN set');
    }

    // Check data directory
    const agoraDir = detectAgoraDataDir({ cwd: io.cwd, env: io.env });
    if (existsSync(agoraDir)) {
      deepOk.push(`Agora data dir: ${agoraDir}`);
    } else {
      deepIssues.push(`Agora data dir ${agoraDir} does not exist`);
    }

    for (const issue of deepIssues) writeLine(io.stdout, `  ${style.dim('⚠')} ${issue}`);
    for (const ok of deepOk) writeLine(io.stdout, `  ${style.dim('✓')} ${ok}`);
  }

  writeLine(io.stdout, '');
  writeLine(io.stdout, style.dim('Run with --fix to auto-heal common issues, --deep for full diagnostics.'));
  return report.valid ? 0 : 1;
};

export const commandAuth: CommandHandler = async (parsed, io, style) => {
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
      const nowSec = Math.floor(Date.now() / 1000);
      const accessExp = decodeJwtExp(explicitToken) || nowSec + 3600;
      const nextState = setAuthState(state, { accessToken: explicitToken, accessExp, apiUrl });
      const auth = getAuthState(nextState);
      writeAgoraState(dataDir, nextState);

      if (parsed.flags.json) {
        writeJson(io.stdout, authStatusPayload(dataDir, auth));
        return 0;
      }

      const minutesLeft = Math.max(0, Math.round((accessExp - nowSec) / 60));
      writeLine(io.stdout, 'Stored Agora API token');
      writeLine(
        io.stdout,
        `Note: pasted token expires in ${minutesLeft}m. Use \`agora auth login\` (device-code) for a persistent session.`
      );
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
      const codeData = (await codeRes.json()) as {
        verification_uri?: string;
        user_code?: string;
        device_code?: string;
        interval?: number;
      };
      if (
        !codeData ||
        typeof codeData !== 'object' ||
        typeof codeData.verification_uri !== 'string' ||
        typeof codeData.user_code !== 'string' ||
        typeof codeData.device_code !== 'string'
      ) {
        return usageError(io, 'Device code response missing required fields');
      }
      const verificationUri = codeData.verification_uri;
      const userCode = codeData.user_code;
      const deviceCode = codeData.device_code;
      const interval = (codeData.interval || 5) * 1000;

      io.stdout.write(`\n${style.accent(userCode.slice(0, 4) + ' ' + userCode.slice(4))}\n\n`);
      io.stdout.write(`  ${style.dim('Open in your browser:')} ${verificationUri}\n`);
      io.stdout.write(`  ${style.dim('Enter code:')}         ${userCode}\n\n`);

      // Try to open browser automatically. verificationUri is server-supplied,
      // so we validate the scheme and pass via spawnSync args (no shell).
      try {
        const parsed = new URL(verificationUri);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          throw new Error('Refusing to open non-http(s) verification URI');
        }
        const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
        const result = spawnSync(opener, [parsed.toString()], { timeout: 3000, stdio: 'ignore' });
        if (result.status === 0) {
          io.stdout.write(`  ${style.dim('Browser opened.')}\n\n`);
        } else {
          io.stdout.write(`  ${style.dim('Open the URL manually.')}\n\n`);
        }
      } catch {
        io.stdout.write(`  ${style.dim('Open the URL manually.')}\n\n`);
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
            const tokenData = (await tokenRes.json()) as {
              access_token?: string;
              refresh_token?: string;
              expires_in?: number;
              refresh_expires_in?: number;
            };
            if (
              !tokenData ||
              typeof tokenData !== 'object' ||
              typeof tokenData.access_token !== 'string' ||
              typeof tokenData.refresh_token !== 'string'
            ) {
              return usageError(io, 'Token response missing access_token / refresh_token');
            }

            process.stdout.write(`\r\x1b[K${style.dim('Authorization received.')}\n`);

            const nowSec = Math.floor(Date.now() / 1000);
            const nextState = setAuthState(state, {
              accessToken: tokenData.access_token,
              accessExp: nowSec + (tokenData.expires_in || 3600),
              refreshToken: tokenData.refresh_token,
              refreshExp: nowSec + (tokenData.refresh_expires_in || 0),
              apiUrl
            });
            writeAgoraState(dataDir, nextState);

            if (parsed.flags.json) {
              writeJson(io.stdout, authStatusPayload(dataDir, getAuthState(nextState)));
              return 0;
            }

            const expiresInMin = Math.round((tokenData.expires_in || 3600) / 60);
            io.stdout.write(`\n${style.accent('✓ Authenticated')}\n`);
            io.stdout.write(`${style.dim('API URL')} ${baseUrl}\n`);
            io.stdout.write(`${style.dim('Token expires')} in ${expiresInMin}m\n`);
            io.stdout.write(`${style.dim('State')} ${getAgoraStatePath(dataDir)}\n`);
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
      const nowSec = Math.floor(Date.now() / 1000);
      writeLine(
        io.stdout,
        `${style.dim('Access')}         ${maskToken(existingAuth.accessToken)}  (${formatRelativeExp(existingAuth.accessExp, nowSec)})`
      );
      if (existingAuth.refreshToken) {
        writeLine(
          io.stdout,
          `${style.dim('Refresh')}        ${maskToken(existingAuth.refreshToken)}  (${formatRelativeExp(existingAuth.refreshExp ?? 0, nowSec)})`
        );
      } else {
        writeLine(io.stdout, `${style.dim('Refresh')}        (none)`);
      }
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

    if (existingAuth.apiUrl && existingAuth.accessToken && existingAuth.refreshToken) {
      try {
        await fetch(`${existingAuth.apiUrl.replace(/\/+$/, '')}/auth/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${existingAuth.accessToken}`
          },
          body: JSON.stringify({ refresh_token: existingAuth.refreshToken })
        });
      } catch {
        /* network failure — clear local anyway */
      }
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
};

export const commandBookmarks: CommandHandler = async (parsed, io, style) => {
  const dataDir = detectDataDir(parsed, io);
  const kind = (parsed.flags.kind as string | undefined) || 'all';

  const state = loadAgoraState(dataDir);
  const marketplaceItems = kind === 'news' ? [] : resolveSavedItems(state);

  const newsMeta = readNewsMeta(dataDir);
  const newsCache = readCache(dataDir);
  const newsItems =
    kind === 'marketplace'
      ? []
      : newsMeta.saved
          .map((id) => newsCache.find((n) => n.id === id))
          .filter((n): n is NonNullable<typeof n> => n !== undefined);

  if (parsed.flags.json) {
    writeJson(io.stdout, {
      marketplace: marketplaceItems,
      news: newsItems
    });
    return 0;
  }

  const hasMarketplace = marketplaceItems.length > 0;
  const hasNews = newsItems.length > 0;

  if (!hasMarketplace && !hasNews) {
    writeLine(io.stdout, 'No bookmarks yet.');
    writeLine(io.stdout, style.dim('Use `agora save <id>` to bookmark marketplace items.'));
    return 0;
  }

  if (kind !== 'news' && hasMarketplace) {
    writeLine(io.stdout, style.accent('Marketplace'));
    writeLine(io.stdout, style.dim('─'.repeat(40)));
    writeLine(io.stdout, formatSavedList(marketplaceItems, style));
    writeLine(io.stdout, '');
  }

  if (kind !== 'marketplace' && hasNews) {
    const now = Date.now();
    writeLine(io.stdout, style.accent('News'));
    writeLine(io.stdout, style.dim('─'.repeat(40)));
    for (const item of newsItems) {
      const ageMs = now - new Date(item.publishedAt).getTime();
      const ageDays = Math.floor(ageMs / 86400000);
      const age = ageDays === 0 ? 'today' : ageDays === 1 ? '1d ago' : `${ageDays}d ago`;
      writeLine(
        io.stdout,
        `${style.dim(item.source.padEnd(16))} ${style.dim(age.padStart(8))}  ${item.title}`
      );
    }
  }

  return 0;
};
