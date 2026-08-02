import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runCli } from '../../src/cli/app';

// `apply` and `sync` write host configuration straight from `agora.toml`. For a
// local manifest they used to do it with no trust decision at all, on the
// reasoning that the user wrote the file — but a manifest is written once and
// applied for months, and an advisory published in between is exactly what
// should stop it.
//
// `mcp-server-kubernetes@2.0.0` is a real confirmed entry in the bundled
// revocation feed, so these tests need no network and no fixture feed.

const REVOKED_MANIFEST = '[mcp.k8s]\ncommand = ["npx", "mcp-server-kubernetes@2.0.0"]\n';
const CLEAN_MANIFEST = '[mcp.pg]\ncommand = ["npx", "@mcp/postgres"]\n';

let cwd: string;
let home: string;
let configPath: string;

function io() {
  const out: string[] = [];
  return {
    out: () => out.join(''),
    io: {
      stdout: { write: (s: string) => void out.push(s) },
      stderr: { write: (s: string) => void out.push(s) },
      env: { HOME: home, NO_COLOR: '1', AGORA_HOME: join(home, 'data'), AGORA_OFFLINE: '1' },
      cwd
    }
  };
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'agora-stackgate-'));
  home = mkdtempSync(join(tmpdir(), 'agora-stackgate-home-'));
  mkdirSync(join(home, 'data'), { recursive: true });
  configPath = join(cwd, 'opencode.json');
  writeFileSync(configPath, JSON.stringify({ mcp: {} }));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe('apply and sync run the gate on a local manifest', () => {
  test('a revoked pinned version blocks apply and writes nothing', async () => {
    writeFileSync(join(cwd, 'agora.toml'), REVOKED_MANIFEST);
    const before = readFileSync(configPath, 'utf8');
    const { io: cliIo, out } = io();

    const code = await runCli(['apply', '--tool', 'opencode'], cliIo as never);

    expect(code).toBe(1);
    expect(out()).toContain('trust gate blocked');
    expect(out()).toContain('revocation');
    expect(readFileSync(configPath, 'utf8')).toBe(before);
  });

  test('the version is matched exactly, not as part of the package name', async () => {
    // The command carries `name@1.2.3` in one token. Concatenating that into
    // the purl's name field produces an unversioned advisory warning instead of
    // a confirmed block, and the pinned bad version sails through.
    writeFileSync(join(cwd, 'agora.toml'), REVOKED_MANIFEST);
    const { io: cliIo, out } = io();

    await runCli(['apply', '--tool', 'opencode', '--json'], cliIo as never);
    const payload = JSON.parse(out());

    expect(payload.mode).toBe('gate-blocked');
    expect(payload.blocked[0].purl).toBe('pkg:npm/mcp-server-kubernetes@2.0.0');
    expect(payload.blocked[0].authorization.verdict).toBe('deny');
  });

  test("the project's own policy blocks apply", async () => {
    writeFileSync(join(cwd, 'team.cedar'), 'forbid (principal, action, resource);\n');
    writeFileSync(join(cwd, 'agora.toml'), `${CLEAN_MANIFEST}\n[policy]\nfiles = ["team.cedar"]\n`);
    const before = readFileSync(configPath, 'utf8');
    const { io: cliIo, out } = io();

    const code = await runCli(['apply', '--tool', 'opencode'], cliIo as never);

    expect(code).toBe(1);
    expect(out()).toContain('trust gate blocked');
    expect(readFileSync(configPath, 'utf8')).toBe(before);
  });

  test('a clean local manifest still applies without touching the network', async () => {
    // The gate must not cost the everyday case its offline capability: only a
    // manifest fetched from elsewhere is scanned over the network.
    writeFileSync(join(cwd, 'agora.toml'), CLEAN_MANIFEST);
    const { io: cliIo } = io();

    const code = await runCli(['apply', '--tool', 'opencode'], cliIo as never);

    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(configPath, 'utf8')).mcp.pg).toBeDefined();
  });

  test('sync refuses the same manifest and writes nothing', async () => {
    writeFileSync(join(cwd, 'agora.toml'), REVOKED_MANIFEST);
    const before = readFileSync(configPath, 'utf8');
    const { io: cliIo, out } = io();

    const code = await runCli(['sync', '--tool', 'opencode', '--write', '--yes'], cliIo as never);

    expect(code).toBe(1);
    expect(out()).toContain('trust gate blocked');
    expect(readFileSync(configPath, 'utf8')).toBe(before);
  });

  test('a warning does not block a whole manifest', async () => {
    // An unpinned package with an advisory warns rather than blocking. `apply`
    // often runs in CI where nobody can accept anything, and stopping every
    // other server for one advisory teaches people to stop running it.
    writeFileSync(
      join(cwd, 'agora.toml'),
      '[mcp.k8s]\ncommand = ["npx", "mcp-server-kubernetes"]\n'
    );
    const { io: cliIo } = io();

    const code = await runCli(['apply', '--tool', 'opencode'], cliIo as never);

    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(configPath, 'utf8')).mcp.k8s).toBeDefined();
  });

  test('plan reports the refusal but never writes either way', async () => {
    writeFileSync(join(cwd, 'agora.toml'), REVOKED_MANIFEST);
    const { io: cliIo } = io();

    await runCli(['plan', '--tool', 'opencode'], cliIo as never);

    expect(JSON.parse(readFileSync(configPath, 'utf8')).mcp).toEqual({});
    expect(existsSync(join(cwd, '.agora'))).toBe(false);
  });
});

describe('integrate holds Agora to its own standard', () => {
  test('a policy that forbids everything stops Agora installing itself', async () => {
    // The one artifact this product has no standing to exempt is its own: if
    // `agora-hub` is ever the package with the advisory, the command that
    // spreads it to every harness on the machine is the one that must stop.
    writeFileSync(join(cwd, 'team.cedar'), 'forbid (principal, action, resource);\n');
    writeFileSync(join(cwd, 'agora.toml'), '[policy]\nfiles = ["team.cedar"]\n');
    const { io: cliIo, out } = io();

    const code = await runCli(['integrate', 'opencode', '--scope', 'project'], cliIo as never);

    expect(code).toBe(1);
    expect(out()).toContain('Refusing to integrate');
    expect(JSON.parse(readFileSync(configPath, 'utf8')).mcp).toEqual({});
  });

  test('a dry run still previews what integration would do', async () => {
    // Refusing to describe the change would make the refusal harder to
    // understand, and a preview writes nothing either way.
    writeFileSync(join(cwd, 'team.cedar'), 'forbid (principal, action, resource);\n');
    writeFileSync(join(cwd, 'agora.toml'), '[policy]\nfiles = ["team.cedar"]\n');
    const { io: cliIo, out } = io();

    const code = await runCli(
      ['integrate', 'opencode', '--scope', 'project', '--dry-run'],
      cliIo as never
    );

    expect(code).toBe(0);
    expect(out()).toContain('would add');
    expect(JSON.parse(readFileSync(configPath, 'utf8')).mcp).toEqual({});
  });

  test('integration proceeds normally when nothing objects', async () => {
    const { io: cliIo } = io();

    const code = await runCli(['integrate', 'opencode', '--scope', 'project'], cliIo as never);

    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(configPath, 'utf8')).mcp.agora).toBeDefined();
  });
});
