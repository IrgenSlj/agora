import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import {
  createInstallPlan,
  findMarketplaceItem,
  hasPermissions,
  renderPermissionLines
} from '../../catalog/bundled.js';
import { formatConfigJson } from '../../config.js';
import {
  detectOpenCodeConfigPath,
  doctorOpenCodeConfig,
  loadOpenCodeConfig,
  writeOpenCodeConfig
} from '../../config-files.js';
import { clearHistory, loadHistory } from '../../history.js';
import { isOpencodeAvailable } from '../../opencode-exec.js';
import { loadPreferences, prefsPath, writePreferences } from '../../preferences.js';
import { type ScanResult, scanItem } from '../../scan.js';
import {
  manifestPath,
  opencodeEntryToManifest,
  readManifest,
  type StackManifest,
  writeManifest
} from '../../stack/manifest.js';

import { ExitCode } from '../exit-codes.js';
import type { ExecLike } from '../flags.js';
import {
  detectDataDir,
  numberFlag,
  stringFlag,
  usageError,
  writeJson,
  writeLine
} from '../helpers.js';
import type { CommandHandler } from './types.js';

export const commandInstall: CommandHandler = async (parsed, io, style) => {
  const id = parsed.args[0];
  if (!id) return usageError(io, 'install requires an item id');

  // Injectable so tests can exercise the install paths without really running
  // `npm install -g` / `git clone` against the machine.
  const runCommand: ExecLike =
    io.exec ?? ((cmd, options) => void execSync(cmd, { stdio: 'pipe', ...options }));

  const item = findMarketplaceItem(id, { type: stringFlag(parsed, 'type', 't') });
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

  const skipScan = Boolean(parsed.flags.skipScan);
  const wantScan = Boolean(parsed.flags.write) && !skipScan;
  const scanResult: ScanResult | null = wantScan
    ? await scanItem(item, {
        fetcher: io.fetcher,
        githubToken: io.env?.AGORA_GITHUB_TOKEN
      })
    : null;

  if (parsed.flags.json) {
    const mPathPreview = manifestPath({ cwd: io.cwd, env: io.env });
    const newServersPreview = parsed.flags.save
      ? Object.keys(plan.config.mcp ?? {}).filter((k) => {
          const planEntry = plan.config.mcp?.[k];
          const loadedEntry = loaded.config.mcp?.[k];
          return (
            planEntry !== undefined && JSON.stringify(planEntry) !== JSON.stringify(loadedEntry)
          );
        })
      : undefined;
    writeJson(io.stdout, {
      item,
      configPath,
      write: Boolean(parsed.flags.write),
      kind: plan.kind,
      commands: plan.commands,
      notes: plan.notes,
      config: plan.config,
      cloneTarget: plan.cloneTarget,
      postInstallHint: plan.postInstallHint,
      scan: scanResult,
      savedToManifest: parsed.flags.save
        ? { path: mPathPreview, servers: newServersPreview ?? [] }
        : undefined
    });
    if (scanResult && scanResult.summary.fail > 0) return ExitCode.POLICY_FORBID;
    return ExitCode.OK;
  }

  if (scanResult) {
    writeLine(io.stdout, 'Scan:');
    for (const c of scanResult.checks) {
      const icon =
        c.status === 'pass'
          ? style.accent('✓')
          : c.status === 'warn'
            ? style.orange('⚠')
            : style.bold('✗');
      writeLine(io.stdout, `  ${icon}  ${c.label}: ${c.message}`);
    }
    const { pass, warn, fail } = scanResult.summary;
    writeLine(io.stdout, `  ${pass} pass · ${warn} warning(s) · ${fail} failure(s)`);
    writeLine(io.stdout, '');

    if (fail > 0) {
      writeLine(
        io.stderr,
        `${style.bold('Refusing install')} — ${fail} scan check(s) failed. Re-run with --skip-scan to override.`
      );
      return ExitCode.POLICY_FORBID;
    }
  }

  if (parsed.flags.write) {
    if (hasPermissions(plan.permissions)) {
      if (!parsed.flags.yes && !parsed.flags.y) {
        for (const line of renderPermissionLines(plan.permissions)) writeLine(io.stdout, line);
        writeLine(io.stdout, '');
        writeLine(
          io.stdout,
          style.dim('This package declares permissions. Re-run with --yes to grant and install.')
        );
        return ExitCode.USAGE;
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
            runCommand(cmd, { timeout: 60000 });
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
      if (parsed.flags.save) {
        writeLine(io.stdout, style.dim('Note: --save is not yet recorded for git-clone installs.'));
      }
    } else if (plan.kind === 'package-install') {
      if (plan.commands.length) {
        writeLine(io.stdout, 'Installing packages...');
        for (const cmd of plan.commands) {
          try {
            runCommand(cmd, { timeout: 120000 });
            writeLine(io.stdout, `  ✓ ${cmd}`);
          } catch {
            writeLine(io.stderr, `  ! Failed: ${cmd} (may already be installed)`);
          }
        }
      }
      writeLine(io.stdout, `Installed ${style.accent(item.name)}`);
      if (parsed.flags.save) {
        writeLine(
          io.stdout,
          style.dim('Note: --save is not yet recorded for package-install installs.')
        );
      }
    } else {
      writeOpenCodeConfig(configPath, plan.config);
      writeLine(io.stdout, `Installed ${style.accent(item.name)}`);
      writeLine(io.stdout, `${style.dim('Config')} ${configPath}`);
      if (plan.commands.length) {
        writeLine(io.stdout, 'Installing packages...');
        for (const cmd of plan.commands) {
          try {
            runCommand(cmd, { timeout: 120000 });
            writeLine(io.stdout, `  ✓ ${cmd}`);
          } catch {
            writeLine(io.stderr, `  ! Failed: ${cmd} (may already be installed)`);
          }
        }
      }
      if (parsed.flags.save) {
        const mPath = manifestPath({ cwd: io.cwd, env: io.env });
        const newServers = Object.keys(plan.config.mcp ?? {}).filter((k) => {
          const planEntry = plan.config.mcp?.[k];
          const loadedEntry = loaded.config.mcp?.[k];
          return (
            planEntry !== undefined && JSON.stringify(planEntry) !== JSON.stringify(loadedEntry)
          );
        });
        try {
          const existing = readManifest(mPath);
          const manifest: StackManifest = existing ?? { mcp: {} };
          for (const name of newServers) {
            const planEntry = plan.config.mcp![name]!;
            manifest.mcp[name] = opencodeEntryToManifest(
              planEntry as Parameters<typeof opencodeEntryToManifest>[0]
            );
          }
          writeManifest(mPath, manifest);
          writeLine(io.stdout, `Saved to ${style.dim(mPath)}`);
        } catch (err) {
          writeLine(
            io.stderr,
            `Warning: manifest update failed — ${err instanceof Error ? err.message : String(err)}`
          );
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
    if (parsed.flags.save) {
      writeLine(io.stdout, style.dim('Note: --save only applies when --write is also set.'));
    }
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
          runCommand(cmd, { timeout: 60000 });
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
          runCommand(cmd, { timeout: 120000 });
          writeLine(io.stdout, `  ✓ ${cmd}`);
        } catch {
          writeLine(io.stdout, `  ! Failed: ${cmd} (may already be installed)`);
        }
      }
    } else {
      writeOpenCodeConfig(configPath, plan.config);
      for (const cmd of plan.commands) {
        try {
          runCommand(cmd, { timeout: 120000 });
          writeLine(io.stdout, `  ✓ ${cmd}`);
        } catch {
          writeLine(io.stdout, `  ! Failed: ${cmd} (may already be installed)`);
        }
      }
      if (parsed.flags.save) {
        const mPath = manifestPath({ cwd: io.cwd, env: io.env });
        const newServers = Object.keys(plan.config.mcp ?? {}).filter((k) => {
          const planEntry = plan.config.mcp?.[k];
          const loadedEntry = loaded.config.mcp?.[k];
          return (
            planEntry !== undefined && JSON.stringify(planEntry) !== JSON.stringify(loadedEntry)
          );
        });
        try {
          const existing = readManifest(mPath);
          const manifest: StackManifest = existing ?? { mcp: {} };
          for (const name of newServers) {
            const planEntry = plan.config.mcp![name]!;
            manifest.mcp[name] = opencodeEntryToManifest(
              planEntry as Parameters<typeof opencodeEntryToManifest>[0]
            );
          }
          writeManifest(mPath, manifest);
          writeLine(io.stdout, `Saved to ${style.dim(mPath)}`);
        } catch (err) {
          writeLine(
            io.stderr,
            `Warning: manifest update failed — ${err instanceof Error ? err.message : String(err)}`
          );
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
    return ExitCode.USAGE;
  }
  return ExitCode.OK;
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
      return usageError(
        io,
        `Editor "${editorRaw}" failed. Set $EDITOR or try manually: nano ${configPath}`
      );
    }
    return 0;
  }

  if (subcommand === 'diff') {
    const paths = parsed.args.slice(1);
    if (paths.length < 2) {
      return usageError(
        io,
        'config diff requires two paths.\nUsage: agora config diff <path1> <path2>'
      );
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
      diffLines.push(
        `  $schema: ${style.dim(c1.$schema || '(none)')} → ${style.accent(c2.$schema || '(none)')}`
      );
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
    if (plugRemoved.length > 0)
      diffLines.push(`  Plugin removed: ${style.dim(plugRemoved.join(', '))}`);
    if (plugAdded.length > 0)
      diffLines.push(`  Plugin added:   ${style.accent(plugAdded.join(', '))}`);

    diffLines.push('');
    diffLines.push(style.dim('MCP server count: ' + mcpKeys1.length + ' → ' + mcpKeys2.length));
    diffLines.push(
      style.dim('Plugin count:     ' + (c1.plugin?.length || 0) + ' → ' + (c2.plugin?.length || 0))
    );

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
    if (isOpencodeAvailable(io.env)) {
      deepOk.push('opencode found on PATH');
    } else {
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
              execFileSync('npm', ['view', pkgName, 'version'], { stdio: 'pipe', timeout: 10000 });
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
    const agoraDir = detectDataDir({ command: undefined, args: [], flags: {} }, io);
    if (existsSync(agoraDir)) {
      deepOk.push(`Agora data dir: ${agoraDir}`);
    } else {
      deepIssues.push(`Agora data dir ${agoraDir} does not exist`);
    }

    deepOk.push('catalog: local-first (bundled + federated sources)');

    // News cache age — surfaces "the feed is stale" before the user notices
    try {
      const { readCache } = await import('../../news/cache.js');
      const items = readCache(agoraDir);
      if (items.length === 0) {
        deepOk.push('news cache: empty (run `agora news` to populate)');
      } else {
        const newest = items.reduce((m, i) => Math.max(m, new Date(i.fetchedAt).getTime()), 0);
        const ageH = (Date.now() - newest) / 3600000;
        const ageLabel = ageH < 1 ? Math.round(ageH * 60) + 'm' : Math.round(ageH) + 'h';
        if (ageH > 24) {
          deepIssues.push(`news cache: stale (${ageLabel} old, ${items.length} items)`);
        } else {
          deepOk.push(`news cache: ${items.length} items, newest ${ageLabel} old`);
        }
      }
    } catch {
      /* skip news check if cache module fails */
    }

    // Hub cache age (only meaningful when live hubs are on)
    if (io.env?.AGORA_LIVE_HUBS === '1' || process.env.AGORA_LIVE_HUBS === '1') {
      try {
        const { readHubsCache, isHubCacheStale } = await import('../../hubs/cache.js');
        const hubItems = readHubsCache(agoraDir);
        if (hubItems.length === 0) {
          deepIssues.push('hub cache: empty (run `bun scripts/refresh-hubs.ts`)');
        } else if (isHubCacheStale(hubItems, 60, new Date())) {
          deepIssues.push(
            `hub cache: stale (>60min, ${hubItems.length} items) — refresh-hubs to update`
          );
        } else {
          deepOk.push(`hub cache: ${hubItems.length} items, fresh`);
        }
      } catch {
        /* skip */
      }
    }

    for (const issue of deepIssues) writeLine(io.stdout, `  ${style.dim('⚠')} ${issue}`);
    for (const ok of deepOk) writeLine(io.stdout, `  ${style.dim('✓')} ${ok}`);
  }

  writeLine(io.stdout, '');
  writeLine(
    io.stdout,
    style.dim('Run with --fix to auto-heal common issues, --deep for full diagnostics.')
  );
  return report.valid ? 0 : 1;
};
