// `agora remove <name>` (brief §9).
//
// The counterpart to `acquire`. Agora's model is declarative — `agora.toml` is
// the source of truth and `plan`/`apply` reconcile host configs to it — so
// remove edits the manifest and leaves the write to `apply`. Reaching into
// every host config directly would bypass the plan/apply separation that makes
// the stack manager safe to trust, and would diverge from `agora.toml` if any
// host write failed halfway.

import {
  manifestPath,
  readManifest,
  type StackManifest,
  writeManifest
} from '../../stack/manifest.js';
import { ExitCode } from '../exit-codes.js';
import { usageError, writeJson, writeLine } from '../helpers.js';
import { cliTheme } from '../theme.js';
import type { CommandHandler } from './types.js';

type Section = 'mcp' | 'skills' | 'workflows' | 'instructions';
const SECTIONS: Section[] = ['mcp', 'skills', 'workflows', 'instructions'];

function findSections(manifest: StackManifest, name: string): Section[] {
  return SECTIONS.filter((section) => {
    const entries = manifest[section] as Record<string, unknown> | undefined;
    return Boolean(entries && Object.hasOwn(entries, name));
  });
}

export const commandRemove: CommandHandler = async (parsed, io, style) => {
  const name = parsed.args[0];
  if (!name) {
    return usageError(io, 'remove requires a name: agora remove <name> [--dry-run]');
  }

  const theme = cliTheme(style, io);
  const mPath = manifestPath({ cwd: io.cwd, env: io.env });
  const manifest = readManifest(mPath);

  if (!manifest) {
    return usageError(io, `No agora.toml found at ${mPath}. Nothing to remove.`);
  }

  const sections = findSections(manifest, name);
  if (sections.length === 0) {
    return usageError(
      io,
      `"${name}" is not in ${mPath}. Run \`agora installed\` to see what is configured.`
    );
  }

  const dryRun = Boolean(parsed.flags.dryRun);

  if (parsed.flags.json) {
    writeJson(io.stdout, {
      name,
      sections,
      manifest: mPath,
      removed: !dryRun,
      dryRun,
      next: 'agora apply'
    });
    if (dryRun) return ExitCode.OK;
  }

  if (dryRun) {
    writeLine(io.stdout, `Would remove ${theme.bold(name)} from ${sections.join(', ')}`);
    writeLine(io.stdout, theme.dim(`  ${mPath}`));
    writeLine(io.stdout, theme.muted('No changes written (--dry-run).'));
    return ExitCode.OK;
  }

  for (const section of sections) {
    const entries = manifest[section] as Record<string, unknown> | undefined;
    if (entries) delete entries[name];
  }
  writeManifest(mPath, manifest);

  if (parsed.flags.json) return ExitCode.OK;

  writeLine(io.stdout, `${theme.accent('✓')} Removed ${theme.bold(name)} from ${mPath}`);
  writeLine(io.stdout, '');
  // The profile and the host configs have now diverged; say so rather than
  // letting the user believe the server is already gone from their editor.
  writeLine(
    io.stdout,
    theme.muted('Host configs still contain it. Run `agora plan` to preview, `agora apply` to')
  );
  writeLine(io.stdout, theme.muted('reconcile — removal needs `agora apply --prune`.'));
  return ExitCode.OK;
};
