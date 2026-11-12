// `agora plan` and `agora apply`: agora.cedar compiled into each host. Claude
// Code always; OpenCode when the repository uses it. `plan` shows what would
// change and writes nothing.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFile } from '../../atomic-write.js';
import { compileClaudeCode } from '../../compile/claude-code.js';
import { compileOpenCode } from '../../compile/opencode.js';
import { MANAGED_FILE, type Managed, mergeSettings } from '../../compile/settings.js';
import { loadCedar, loadPolicySet, POLICY_FILE } from '../../policy/engine.js';
import { repoRoot } from '../../receipt/git.js';
import { headerLine, leader, MEASURE, rule, section, status, tally, wrap } from '../components.js';
import { ExitCode } from '../exit-codes.js';
import { usageError, writeJson, writeLine } from '../helpers.js';
import { cliTheme } from '../theme.js';
import type { CommandHandler } from './types.js';

const SETTINGS = '.claude/settings.json';

/** Whether the repository uses OpenCode: a `.opencode/` directory or a project config. */
export const usesOpenCode = (root: string): boolean =>
  ['.opencode', 'opencode.json', 'opencode.jsonc'].some((f) => existsSync(join(root, f)));

function readText(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
}

function readJson(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
}

export const commandPlan: CommandHandler = async (parsed, io, style) => {
  const write = parsed.command === 'apply';
  const theme = cliTheme(style, io);
  const cwd = io.cwd ?? process.cwd();
  const root = repoRoot(cwd) ?? cwd;

  const set = await loadPolicySet({ repo: root });
  const cedar = await loadCedar();
  if (!set || !cedar) {
    writeLine(io.stderr, 'The Cedar engine could not be loaded.');
    return ExitCode.COULD_NOT_CHECK;
  }
  if (set.errors.length) {
    writeLine(io.stderr, `${POLICY_FILE} does not parse; fix it before compiling:`);
    for (const e of set.errors) writeLine(io.stderr, `  ${e}`);
    return ExitCode.USAGE;
  }

  // Only the repository's own rules compile to allow rules; the baseline and
  // the no-policy stand-in are enforced by the hook alone.
  const ests: Record<string, Record<string, unknown>> = {};
  if (set.project) {
    for (const [id, text] of Object.entries(set.policies)) {
      if (id.startsWith('baseline')) continue;
      const json = cedar.policyToJson(text);
      if (json.type === 'success') ests[id] = json.json as unknown as Record<string, unknown>;
    }
  }
  const compilation = compileClaudeCode(ests);

  const settingsPath = join(root, SETTINGS);
  const managedPath = join(root, MANAGED_FILE);
  let current: Record<string, unknown>;
  let previous: Managed | undefined;
  try {
    current = readJson(settingsPath) ?? {};
    previous = readJson(managedPath) as Managed | undefined;
  } catch (e) {
    return usageError(
      io,
      `${SETTINGS} or ${MANAGED_FILE} is not valid JSON; refusing to rewrite it (${e instanceof Error ? e.message : e}).`
    );
  }
  const merged = mergeSettings(current, compilation, previous);
  const opencode = usesOpenCode(root) ? compileOpenCode(ests) : undefined;
  const pluginChanged =
    opencode !== undefined && readText(join(root, opencode.plugin.path)) !== opencode.plugin.source;
  const nothing =
    !merged.change.hooks.length &&
    !merged.change.added.length &&
    !merged.change.removed.length &&
    !pluginChanged;

  if (parsed.flags.json) {
    writeJson(io.stdout, {
      host: 'claude-code',
      settings: SETTINGS,
      policy: set.project ? POLICY_FILE : null,
      changes: merged.change,
      compiled: compilation.compiled,
      hook_only: compilation.hookOnly,
      not_enforced: compilation.notEnforced,
      opencode: opencode
        ? {
            plugin: opencode.plugin.path,
            changed: pluginChanged,
            hook_only: opencode.hookOnly,
            not_enforced: opencode.notEnforced
          }
        : null,
      applied: write && !nothing
    });
  } else {
    const hosts = opencode ? 2 : 1;
    const out = (line = '') => writeLine(io.stdout, line);
    const arrow = theme.glyph('arrow');
    out('');
    out(
      headerLine(
        write ? 'apply' : 'plan',
        `${POLICY_FILE} ${arrow} ${hosts} host${hosts === 1 ? '' : 's'}`,
        theme
      )
    );
    if (!set.project)
      out(
        `  ${theme.muted(`no ${POLICY_FILE}: hooks only; agents are limited by the baseline alone`)}`
      );
    out('');

    const ch = merged.change;
    const unchanged = compilation.allow.filter((r) => !ch.added.includes(r)).length;
    const byRule = new Map(compilation.compiled.flatMap((c) => c.native.map((n) => [n, c.policy])));
    out(section('Claude Code', theme, `+${ch.added.length}  -${ch.removed.length}  =${unchanged}`));
    out(`  ${theme.muted(SETTINGS)}`);
    for (const h of ch.hooks) out(`  ${theme.success('+')} hook   ${h}`);
    const ruleLine = (sign: string, r: string, why: string) =>
      `  ${leader(`${sign} allow  ${r}`, theme.muted(why), theme, MEASURE)}`;
    for (const r of ch.added) out(ruleLine(theme.success('+'), r, byRule.get(r) ?? ''));
    for (const r of ch.removed) out(ruleLine(theme.error('-'), r, 'no longer in the policy'));
    if (unchanged)
      out(`  ${theme.muted(`= ${unchanged} rule${unchanged === 1 ? '' : 's'} unchanged`)}`);
    if (!ch.hooks.length && !ch.added.length && !ch.removed.length)
      out(`  ${theme.muted('up to date')}`);

    if (opencode) {
      out('');
      out(section('OpenCode', theme, pluginChanged ? '+1' : '=1'));
      out(`  ${theme.muted(opencode.plugin.path)}`);
      out(
        pluginChanged ? `  ${theme.success('+')} plugin agora.js` : `  ${theme.muted('up to date')}`
      );
      out(
        `  ${status('info', theme.muted('OpenCode allows by default, so no allow rules are written.'), theme)}`
      );
    } else {
      out('');
      out(`  ${theme.muted('OpenCode · not used here (no .opencode/ or opencode.json)')}`);
    }

    if (compilation.hookOnly.length) {
      out('');
      out(section('Enforced by the hook only', theme, String(compilation.hookOnly.length)));
      for (const h of compilation.hookOnly) {
        out(`  ${status('warning', h.policy, theme)}`);
        for (const l of wrap(h.why, MEASURE - 4)) out(`    ${theme.muted(l)}`);
      }
      out(
        `  ${status('info', theme.muted('These hold while the agora hook runs; the host still asks.'), theme)}`
      );
    }

    const gaps = [
      ...compilation.notEnforced.map((g) => `claude-code: ${g}`),
      ...(opencode?.notEnforced ?? []).map((g) => `opencode: ${g}`)
    ];
    out('');
    out(section('Not enforced', theme, String(gaps.length)));
    for (const g of gaps) {
      const [head, ...rest] = wrap(g, MEASURE - 2);
      out(`  ${status('unknown', theme.muted(head ?? ''), theme)}`);
      for (const r of rest) out(`    ${theme.muted(r)}`);
    }

    out('');
    out(rule(theme));
    out(
      tally(
        [
          [ch.added.length, `added`],
          [ch.removed.length, 'removed'],
          [compilation.hookOnly.length, 'hook only'],
          [gaps.length, 'not enforced']
        ],
        theme
      )
    );
  }

  if (!write) {
    if (!parsed.flags.json)
      writeLine(
        io.stdout,
        nothing
          ? `  ${theme.muted('nothing to write')}\n`
          : `  ${theme.muted('nothing written. to apply')}  agora apply\n`
      );
    return ExitCode.OK;
  }
  if (!nothing) {
    const wrote = [SETTINGS, MANAGED_FILE];
    atomicWriteFile(settingsPath, `${JSON.stringify(merged.doc, null, 2)}\n`, 0o644);
    atomicWriteFile(managedPath, `${JSON.stringify(merged.managed, null, 2)}\n`, 0o644);
    if (opencode && pluginChanged) {
      atomicWriteFile(join(root, opencode.plugin.path), opencode.plugin.source, 0o644);
      wrote.push(opencode.plugin.path);
    }
    if (!parsed.flags.json)
      writeLine(
        io.stdout,
        `  ${status('success', `wrote ${wrote.join(', ')}; commit them`, theme)}\n`
      );
  }
  return ExitCode.OK;
};
