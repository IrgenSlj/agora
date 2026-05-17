import process from 'node:process';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { scanProject, generateInitPlan, applyInitPlan, runCommands } from '../../init.js';
import { installAgoraCommand } from '../../commands.js';
import { formatConfigJson } from '../../config.js';
import {
  detectOpenCodeConfigPath,
  loadOpenCodeConfig,
  writeOpenCodeConfig
} from '../../config-files.js';
import { sampleWorkflows } from '../../data.js';
import { writeLine, writeJson, usageError } from '../helpers.js';
import { header } from '../format.js';
import { renderMeander, supportsTrueColor } from '../../ui.js';
import type { CommandHandler } from './types.js';

export const commandInit: CommandHandler = async (parsed, io, style) => {
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
  if (scan.frameworks.length)
    writeLine(io.stdout, `  ${style.dim('Frameworks')} ${scan.frameworks.join(', ')}`);
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
};

export const commandUse: CommandHandler = async (parsed, io, style) => {
  const id = parsed.args[0];
  if (!id) {
    writeLine(
      io.stdout,
      header('agora use', [`${sampleWorkflows.length} available workflows`], style)
    );
    writeLine(io.stdout, '');
    writeLine(
      io.stdout,
      sampleWorkflows
        .map((wf) => `  ${style.accent(wf.id.padEnd(22))} ${style.dim(wf.name)}`)
        .join('\n')
    );
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
};
