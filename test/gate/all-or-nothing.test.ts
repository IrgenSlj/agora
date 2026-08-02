import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runCli } from '../../src/cli/app';
import { readGateAudit } from '../../src/gate/audit';

// The property every gated command must have: when the gate does not allow the
// mutation, the filesystem is exactly as it was. A command that refuses in its
// output while leaving a half-written config behind is worse than one that
// never checked, because the refusal is now false.

let dir: string;
let data: string;
let configPath: string;

function io(over: Record<string, string> = {}) {
  const out: string[] = [];
  return {
    out: () => out.join(''),
    io: {
      stdout: { write: (s: string) => void out.push(s) },
      stderr: { write: (s: string) => void out.push(s) },
      env: { HOME: dir, AGORA_HOME: data, AGORA_OFFLINE: '1', ...over },
      cwd: dir,
      // Injected so a permitted install never really shells out to npm.
      exec: () => {}
    }
  };
}

/** Everything the gated commands could possibly have written. */
function filesystemState() {
  return {
    config: existsSync(configPath) ? readFileSync(configPath, 'utf8') : null,
    manifest: existsSync(join(dir, 'agora.toml'))
      ? readFileSync(join(dir, 'agora.toml'), 'utf8')
      : null,
    capabilities: existsSync(join(data, 'capabilities.json'))
      ? readFileSync(join(data, 'capabilities.json'), 'utf8')
      : null
  };
}

function forbidEverything(): void {
  writeFileSync(join(dir, 'team.cedar'), 'forbid (principal, action, resource);\n', 'utf8');
  writeFileSync(join(dir, 'agora.toml'), '[policy]\nfiles = ["team.cedar"]\n', 'utf8');
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agora-gate-'));
  data = join(dir, 'data');
  configPath = join(dir, 'opencode.json');
  mkdirSync(data, { recursive: true });
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('a refused mutation writes nothing', () => {
  test('install --write leaves the disk untouched when policy denies', async () => {
    forbidEverything();
    const before = filesystemState();
    const { io: cliIo, out } = io();

    const code = await runCli(
      ['install', 'mcp-github', '--write', '--accept-warnings', '--config', configPath],
      cliIo as never
    );

    expect(code).toBe(1);
    expect(out()).toContain('Refusing install');
    expect(filesystemState()).toEqual(before);
  });

  test('install --write --save writes neither the config nor agora.toml on denial', async () => {
    // --save touches a second file. A gate that stops one write and not the
    // other leaves the machine in a state nobody chose.
    forbidEverything();
    const manifestBefore = readFileSync(join(dir, 'agora.toml'), 'utf8');
    const { io: cliIo } = io();

    const code = await runCli(
      ['install', 'mcp-github', '--write', '--save', '--accept-warnings', '--config', configPath],
      cliIo as never
    );

    expect(code).toBe(1);
    expect(existsSync(configPath)).toBe(false);
    expect(readFileSync(join(dir, 'agora.toml'), 'utf8')).toBe(manifestBefore);
  });

  test('--skip-scan alone is no longer an override', async () => {
    // The old behaviour: skipping the scan skipped the gate and installed.
    // The new behaviour: nothing was established, so nothing is authorized.
    const before = filesystemState();
    const { io: cliIo, out } = io();

    const code = await runCli(
      ['install', 'mcp-github', '--write', '--skip-scan', '--config', configPath],
      cliIo as never
    );

    expect(code).toBe(1);
    expect(out()).toContain('nothing was established');
    expect(out()).toContain('--accept-risk');
    expect(filesystemState()).toEqual(before);
  });

  test('--skip-scan --accept-risk installs and records what was accepted', async () => {
    const { io: cliIo, out } = io();

    const code = await runCli(
      ['install', 'mcp-github', '--write', '--skip-scan', '--accept-risk', '--config', configPath],
      cliIo as never
    );

    expect(code).toBe(0);
    expect(existsSync(configPath)).toBe(true);
    expect(out()).toContain('Accepted risk');

    // An acceptance that leaves no trace is a bypass with better manners.
    const audit = readGateAudit(data);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe('Install');
    expect(audit[0]?.subject).toBe('mcp-github');
    expect(audit[0]?.acknowledged.join(' ')).toContain('scan');
  });

  test('an ordinary authorized install records no acceptance', async () => {
    // The audit log is for decisions someone had to make. If a clean install
    // wrote to it, the file would stop meaning anything.
    const { io: cliIo } = io();

    const code = await runCli(
      ['install', 'mcp-github', '--write', '--accept-warnings', '--config', configPath],
      cliIo as never
    );

    expect(code).toBe(0);
    expect(readGateAudit(data)).toHaveLength(0);
  });

  test('policy denial cannot be waived by accepting risk', async () => {
    // --accept-risk answers "this was never established". It is not a veto over
    // a rule the user wrote, and a deny is not acknowledgeable at all.
    forbidEverything();
    const { io: cliIo, out } = io();

    const code = await runCli(
      [
        'install',
        'mcp-github',
        '--write',
        '--skip-scan',
        '--accept-risk',
        '--accept-warnings',
        '--config',
        configPath
      ],
      cliIo as never
    );

    expect(code).toBe(1);
    expect(out()).toContain('Refusing install');
    expect(existsSync(configPath)).toBe(false);
    expect(readGateAudit(data)).toHaveLength(0);
  });

  test('try does not run the server when policy denies it', async () => {
    // `try` writes no config, but it executes the artifact's code, which is the
    // effect the scan existed to inform.
    forbidEverything();
    const { io: cliIo, out } = io();

    const code = await runCli(['try', 'mcp-github', '--json'], cliIo as never);

    expect(code).toBe(1);
    const payload = JSON.parse(out());
    expect(payload.probe.ok).toBe(false);
    expect(payload.probe.error).toBe('refused before running');
    expect(payload.authorization.verdict).toBe('deny');
    expect(existsSync(join(data, 'capabilities.json'))).toBe(false);
  });

  test('try refuses when the scan could not run, rather than running blind', async () => {
    // No project policy here: the refusal must come from the missing scan
    // alone, not from a rule standing in for it.
    const { io: cliIo, out } = io();

    const code = await runCli(['try', 'mcp-github', '--skip-scan', '--json'], cliIo as never);

    expect(code).toBe(1);
    const payload = JSON.parse(out());
    expect(payload.authorization.verdict).toBe('inconclusive');
    expect(existsSync(join(data, 'capabilities.json'))).toBe(false);
  });
});
