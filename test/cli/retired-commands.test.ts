import { describe, expect, test } from 'vitest';
import { runCli } from '../../src/cli/app';
import { COMMANDS } from '../../src/cli/commands-meta';
import { RETIRED_COMMANDS } from '../../src/cli/retired';

function createIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: { write: (s: string) => void stdout.push(s) },
      stderr: { write: (s: string) => void stderr.push(s) },
      env: {},
      cwd: process.cwd()
    } as never,
    out: () => stdout.join(''),
    err: () => stderr.join('')
  };
}

describe('a removed command explains itself', () => {
  test('every retired command is handled, not reported as unknown', async () => {
    // `Unknown command: news` reads as a broken install. A removal was a
    // decision, and the user is owed the reason.
    for (const name of Object.keys(RETIRED_COMMANDS)) {
      const { io, err } = createIo();
      const code = await runCli([name], io);
      expect(code, `agora ${name} should exit 2`).toBe(2);
      expect(err(), `agora ${name}`).not.toContain('Unknown command');
      expect(err(), `agora ${name}`).toContain('was removed in');
    }
  });

  test('a replacement is named where one exists', async () => {
    const { io, err } = createIo();
    await runCli(['news'], io);
    expect(err()).toContain('agora today');
  });

  test('no replacement is invented where none exists', async () => {
    // A wrong redirect is worse than an honest dead end — sending someone to
    // a command that cannot do what they wanted wastes more of their time.
    const { io, err } = createIo();
    await runCli(['auth'], io);
    expect(err()).toContain('no accounts');
    expect(err()).not.toContain('Use `');
  });

  test('every named replacement is a command that actually exists', async () => {
    const registered = new Set(COMMANDS.map((c) => c.name));
    for (const extra of ['help', 'tui', 'completions', 'shell', 'verify', 'mcp']) {
      registered.add(extra);
    }
    for (const [name, entry] of Object.entries(RETIRED_COMMANDS)) {
      if (!entry.replacement) continue;
      // `agora search --kind agent-skill` → check the command word only.
      const cmd = entry.replacement.replace(/^agora\s*/, '').split(/\s+/)[0];
      // `chat` points at bare `agora`, which has no command word.
      if (!cmd) continue;
      expect(registered, `\`agora ${name}\` redirects to a missing command`).toContain(cmd);
    }
  });

  test('a retired name never shadows a live command', async () => {
    // If a name is ever brought back, the shim must not keep intercepting it.
    for (const name of Object.keys(RETIRED_COMMANDS)) {
      expect(
        COMMANDS.map((c) => c.name),
        `${name} is both live and retired`
      ).not.toContain(name);
    }
  });

  test('an unrecognised command still gets the ordinary unknown path', async () => {
    const { io, err } = createIo();
    const code = await runCli(['definitelynotacommand'], io);
    expect(code).toBe(2);
    expect(err()).toContain('Unknown command');
  });
});
