import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runCli } from '../../src/cli/app';
import { COMMANDS } from '../../src/cli/commands-meta';

// Three separate cleanups in a row turned up the same bug: v0.6.2 deleted
// commands (`auth`, `save`, `saved`, `use`, `trending`, `tutorial`, `news`)
// but not the code pointing at them, so the tool kept telling users — and
// models — to run things that no longer existed. `agora doctor`, the shell
// tips, the home page, the OpenCode plugin's help, and the plugin's own chat
// tool were all still advertising deleted commands.
//
// This makes that class of bug fail a test instead of shipping. It is
// deliberately a repo-wide grep rather than a per-file assertion: the whole
// point is catching the reference nobody remembered to look for.

const REPO = join(__dirname, '..', '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Commands the CLI actually answers to, including undocumented aliases. */
async function registeredCommands(): Promise<Set<string>> {
  const names = new Set(COMMANDS.map((c) => c.name));
  // Routed in app.ts outside the COMMANDS metadata table.
  for (const extra of ['help', 'tui', 'completions', 'shell', 'verify', 'mcp']) names.add(extra);
  return names;
}

describe('no user-facing string names a command that does not exist', () => {
  test('every `agora <cmd>` mentioned in src/ is registered', async () => {
    const registered = await registeredCommands();
    const offenders: string[] = [];

    // A command *reference* is either bare, or followed by a flag or an
    // argument placeholder. Prose continues into lowercase words — "agora is
    // the trust plane" is a sentence, not an invocation — so requiring that
    // trailing shape separates the two without a word blocklist.
    // `(?<!\/)` skips `/agora <tool>`, which is the OpenCode slash-command
    // form naming a *plugin tool*, not a CLI command.
    const pattern = /(?<!\/)agora ([a-z][a-z-]{1,20})(?=['"`\n]|\s+--?[a-z]|\s+<)/g;
    // "an agora command" is prose; no command is ever named this.
    const PROSE = new Set(['command', 'commands']);

    for (const file of sourceFiles(join(REPO, 'src'))) {
      // Comments record history ("this used to be `agora news`") and design
      // notes for unbuilt commands. Neither is shown to anyone.
      const text = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');

      for (const match of text.matchAll(pattern)) {
        const cmd = match[1]!;
        if (!registered.has(cmd) && !PROSE.has(cmd)) {
          offenders.push(`${file.slice(REPO.length + 1)}: "agora ${cmd}"`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test('every documented command is dispatchable', async () => {
    // A command in the help table that app.ts does not route is the same bug
    // seen from the other side.
    const io = () => {
      const out: string[] = [];
      return {
        io: {
          stdout: { write: (s: string) => void out.push(s) },
          stderr: { write: (s: string) => void out.push(s) },
          env: {},
          cwd: REPO
        },
        out: () => out.join('')
      };
    };

    const unroutable: string[] = [];
    for (const meta of COMMANDS) {
      const { io: cliIo, out } = io();
      await runCli([meta.name, '--help'], cliIo as never);
      if (out().includes('Unknown command')) unroutable.push(meta.name);
    }

    expect(unroutable).toEqual([]);
  });

  test('no command is registered twice', () => {
    // S6 added `agora observe enable/disable` by appending a second `observe`
    // entry instead of editing the existing one. Both showed in `agora --help`
    // with contradictory summaries, and `agora help observe` matched the stale
    // one first — so the help told users to hand-wire host configs, the exact
    // chore `observe enable` was built to remove. The feature shipped and was
    // undiscoverable.
    //
    // The tests above check that advertised commands exist. This checks the
    // other failure: a command existing twice, where the loser is invisible.
    const seen = new Map<string, number>();
    for (const meta of COMMANDS) seen.set(meta.name, (seen.get(meta.name) ?? 0) + 1);

    const duplicates = [...seen.entries()]
      .filter(([, count]) => count > 1)
      .map(([name, count]) => `${name} (${count}x)`);

    expect(duplicates).toEqual([]);
  });

  test('the brief §9 contract surface is present', () => {
    // AGORA_BRIEF_v2.md §9 is the locked CLI contract. These were missing:
    // quarantine/unquarantine had shipping machinery but no CLI, so the only
    // way out of a quarantine was hand-editing capabilities.json.
    const names = new Set(COMMANDS.map((c) => c.name));
    for (const required of [
      'search',
      'info',
      'acquire',
      'remove',
      'update',
      'sync',
      'doctor',
      'policy',
      'quarantine',
      'unquarantine',
      'lock',
      'export'
    ]) {
      expect(names, `brief §9 requires \`agora ${required}\``).toContain(required);
    }
  });
});
