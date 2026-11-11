// `agora plan` and `agora apply`: agora.cedar compiled into Claude Code's
// settings. `plan` shows what would change and writes nothing.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFile } from '../../atomic-write.js';
import { compileClaudeCode } from '../../compile/claude-code.js';
import { MANAGED_FILE, type Managed, mergeSettings } from '../../compile/settings.js';
import { loadCedar, loadPolicySet, POLICY_FILE } from '../../policy/engine.js';
import { repoRoot } from '../../receipt/git.js';
import { ExitCode } from '../exit-codes.js';
import { usageError, writeJson, writeLine } from '../helpers.js';
import { cliTheme } from '../theme.js';
import type { CommandHandler } from './types.js';

const SETTINGS = '.claude/settings.json';

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
  const nothing =
    !merged.change.hooks.length && !merged.change.added.length && !merged.change.removed.length;

  if (parsed.flags.json) {
    writeJson(io.stdout, {
      host: 'claude-code',
      settings: SETTINGS,
      policy: set.project ? POLICY_FILE : null,
      changes: merged.change,
      compiled: compilation.compiled,
      hook_only: compilation.hookOnly,
      not_enforced: compilation.notEnforced,
      applied: write && !nothing
    });
  } else {
    writeLine(io.stdout, `${theme.accent('Claude Code')} ${theme.dim(`· ${SETTINGS}`)}`);
    if (!set.project) {
      writeLine(
        io.stdout,
        theme.dim(
          `  no ${POLICY_FILE}: only the hooks are installed; agents are limited by the baseline alone`
        )
      );
    }
    if (nothing) writeLine(io.stdout, theme.dim('  up to date'));
    for (const h of merged.change.hooks) writeLine(io.stdout, theme.success(`  + hook ${h}`));
    for (const r of merged.change.added) writeLine(io.stdout, theme.success(`  + allow ${r}`));
    for (const r of merged.change.removed) writeLine(io.stdout, theme.error(`  - allow ${r}`));
    if (compilation.hookOnly.length) {
      writeLine(
        io.stdout,
        theme.muted('\n  Enforced by the hook only (Claude Code will still ask before these):')
      );
      for (const h of compilation.hookOnly)
        writeLine(io.stdout, theme.dim(`    ${h.policy}: ${h.why}`));
    }
    writeLine(io.stdout, theme.muted('\n  Not enforced, because Claude Code cannot see it:'));
    for (const n of compilation.notEnforced) writeLine(io.stdout, theme.dim(`    ${n}`));
    writeLine(io.stdout, '');
  }

  if (!write) {
    if (!parsed.flags.json && !nothing)
      writeLine(io.stdout, theme.dim('Nothing written. Run `agora apply` to write it.'));
    return ExitCode.OK;
  }
  if (!nothing) {
    atomicWriteFile(settingsPath, `${JSON.stringify(merged.doc, null, 2)}\n`, 0o644);
    atomicWriteFile(managedPath, `${JSON.stringify(merged.managed, null, 2)}\n`, 0o644);
    if (!parsed.flags.json)
      writeLine(io.stdout, `Wrote ${SETTINGS} and ${MANAGED_FILE}. Commit both.`);
  }
  return ExitCode.OK;
};
