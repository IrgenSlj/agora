/**
 * VS Code adapter. Temp dirs, no network, no spawns.
 *
 * This host was invisible to Agora until now, which meant `agora ci` running in
 * a repository whose MCP servers live in `.vscode/mcp.json` reported an empty
 * stack and a clean bill of health — the worst possible failure for a tripwire,
 * because "nothing configured" and "nothing wrong" render the same.
 *
 * VS Code's schema is the odd one out and the tests below are mostly about the
 * three ways it differs from every other adapter in this directory.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { vscodeAdapter } from '../../src/stack/adapters/vscode';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'agora-vscode-test-'));
}

function writeProject(cwd: string, doc: unknown): string {
  const dir = join(cwd, '.vscode');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'mcp.json');
  writeFileSync(path, JSON.stringify(doc, null, 2));
  return path;
}

describe('vscodeAdapter — reading', () => {
  test('reads stdio and http servers from .vscode/mcp.json', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      writeProject(cwd, {
        servers: {
          fs: { type: 'stdio', command: 'npx', args: ['-y', 'server-filesystem'] },
          remote: { type: 'http', url: 'https://example.test/mcp' }
        }
      });

      const servers = vscodeAdapter.readServers({ cwd, home });
      expect(servers).toHaveLength(2);

      const fs = servers.find((s) => s.name === 'fs')!;
      expect(fs.tool).toBe('vscode');
      expect(fs.scope).toBe('project');
      expect(fs.transport).toBe('local');
      expect(fs.command).toEqual(['npx', '-y', 'server-filesystem']);

      const remote = servers.find((s) => s.name === 'remote')!;
      expect(remote.transport).toBe('remote');
      expect(remote.url).toBe('https://example.test/mcp');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('reads the user config from ~/.copilot/mcp-config.json', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      mkdirSync(join(home, '.copilot'), { recursive: true });
      writeFileSync(
        join(home, '.copilot', 'mcp-config.json'),
        JSON.stringify({ servers: { global: { type: 'stdio', command: 'node' } } })
      );

      const servers = vscodeAdapter.readServers({ cwd, home });
      expect(servers).toHaveLength(1);
      expect(servers[0].scope).toBe('user');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('tolerates the mcpServers key on read, because config gets pasted between editors', () => {
    // A user who copied their Cursor block into `.vscode/mcp.json` has a file
    // VS Code ignores entirely. Reporting the servers is more useful than
    // reporting an empty stack — Agora can then say something about them.
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      writeProject(cwd, { mcpServers: { pasted: { command: 'npx', args: ['x'] } } });
      const servers = vscodeAdapter.readServers({ cwd, home });
      expect(servers).toHaveLength(1);
      expect(servers[0].name).toBe('pasted');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  // biome-ignore-start lint/suspicious/noTemplateCurlyInString: `${input:id}` is VS Code's own placeholder syntax in a plain string — the literal is the subject of this test, not a mistyped template literal.
  test('keeps ${input:...} placeholders unresolved', () => {
    // The whole point of an `inputs` section is that the secret is not in the
    // file. Resolving the placeholder — or treating it as a literal to rewrite
    // — would put it there.
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      writeProject(cwd, {
        inputs: [{ type: 'promptString', id: 'token', description: 'API token', password: true }],
        servers: {
          api: { type: 'stdio', command: 'node', env: { TOKEN: '${input:token}' } }
        }
      });

      const servers = vscodeAdapter.readServers({ cwd, home });
      expect(servers[0].env?.TOKEN).toBe('${input:token}');
      // biome-ignore-end lint/suspicious/noTemplateCurlyInString: end of the placeholder-literal test
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('drops null env values rather than stringifying them', () => {
    // VS Code permits string, number and null. null means "unset this", and
    // "null" as a four-character string is a different and wrong thing.
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      writeProject(cwd, {
        servers: {
          s: { type: 'stdio', command: 'node', env: { KEEP: 'yes', PORT: 8080, DROP: null } }
        }
      });

      const env = vscodeAdapter.readServers({ cwd, home })[0].env!;
      expect(env.KEEP).toBe('yes');
      expect(env.PORT).toBe('8080');
      expect('DROP' in env).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('a missing or malformed config reads as no servers, not as a throw', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      expect(vscodeAdapter.readServers({ cwd, home })).toEqual([]);
      mkdirSync(join(cwd, '.vscode'), { recursive: true });
      writeFileSync(join(cwd, '.vscode', 'mcp.json'), '{ not json');
      expect(vscodeAdapter.readServers({ cwd, home })).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('vscodeAdapter — writing', () => {
  test('writes servers under `servers` with an explicit stdio type', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      const path = join(cwd, '.vscode', 'mcp.json');
      mkdirSync(join(cwd, '.vscode'), { recursive: true });
      vscodeAdapter.writeServers(
        { path, scope: 'project' },
        [{ name: 'agora', command: ['npx', '-y', 'agora-hub', 'mcp'] }],
        { prune: false }
      );

      const doc = JSON.parse(readFileSync(path, 'utf8'));
      expect(doc.servers.agora.type).toBe('stdio');
      expect(doc.servers.agora.command).toBe('npx');
      expect(doc.servers.agora.args).toEqual(['-y', 'agora-hub', 'mcp']);
      expect(doc.mcpServers).toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('preserves inputs, sandbox, and per-entry keys Agora does not own', () => {
    // The surgical-write property, and it matters more here than elsewhere:
    // dropping `inputs` breaks every server that references a placeholder, and
    // dropping `sandbox` silently widens what the servers are allowed to touch.
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      const path = writeProject(cwd, {
        inputs: [{ type: 'promptString', id: 'token', description: 'token' }],
        sandbox: { network: false },
        servers: {
          existing: {
            type: 'stdio',
            command: 'node',
            dev: { watch: 'src/**' },
            sandboxEnabled: true,
            envFile: '.env'
          }
        }
      });

      vscodeAdapter.writeServers(
        { path, scope: 'project' },
        [{ name: 'existing', command: ['node', '--flag'] }],
        { prune: false }
      );

      const doc = JSON.parse(readFileSync(path, 'utf8'));
      expect(doc.inputs).toHaveLength(1);
      expect(doc.sandbox).toEqual({ network: false });
      expect(doc.servers.existing.dev).toEqual({ watch: 'src/**' });
      expect(doc.servers.existing.sandboxEnabled).toBe(true);
      expect(doc.servers.existing.envFile).toBe('.env');
      expect(doc.servers.existing.args).toEqual(['--flag']);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('migrates a pasted mcpServers block to servers rather than keeping both', () => {
    // Keeping both would leave VS Code reading one and Agora reporting the
    // other, which is a disagreement that gets worse the longer it lives.
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      const path = writeProject(cwd, { mcpServers: { pasted: { command: 'node' } } });
      vscodeAdapter.writeServers(
        { path, scope: 'project' },
        [{ name: 'pasted', command: ['node'] }],
        {
          prune: false
        }
      );

      const doc = JSON.parse(readFileSync(path, 'utf8'));
      expect(doc.mcpServers).toBeUndefined();
      expect(doc.servers.pasted.type).toBe('stdio');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('a remote server keeps an existing sse type instead of being forced to http', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      const path = writeProject(cwd, {
        servers: { r: { type: 'sse', url: 'https://old.test/mcp' } }
      });
      vscodeAdapter.writeServers(
        { path, scope: 'project' },
        [{ name: 'r', url: 'https://new.test/mcp' }],
        { prune: false }
      );

      const doc = JSON.parse(readFileSync(path, 'utf8'));
      expect(doc.servers.r.type).toBe('sse');
      expect(doc.servers.r.url).toBe('https://new.test/mcp');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('switching a server from local to remote clears the local-only keys', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      const path = writeProject(cwd, {
        servers: { s: { type: 'stdio', command: 'node', args: ['a'], env: { A: '1' }, cwd: '/x' } }
      });
      vscodeAdapter.writeServers(
        { path, scope: 'project' },
        [{ name: 's', url: 'https://example.test/mcp' }],
        { prune: false }
      );

      const entry = JSON.parse(readFileSync(path, 'utf8')).servers.s;
      expect(entry.type).toBe('http');
      expect(entry.command).toBeUndefined();
      expect(entry.args).toBeUndefined();
      expect(entry.env).toBeUndefined();
      expect(entry.cwd).toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('refuses to overwrite a config that is not valid JSON', () => {
    // Truncating someone's hand-edited config because it had a trailing comma
    // is a worse outcome than failing loudly.
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      mkdirSync(join(cwd, '.vscode'), { recursive: true });
      const path = join(cwd, '.vscode', 'mcp.json');
      writeFileSync(path, '{ "servers": { oops }');

      expect(() =>
        vscodeAdapter.writeServers({ path, scope: 'project' }, [{ name: 'a', command: ['node'] }], {
          prune: false
        })
      ).toThrow(/not valid JSON/);
      expect(readFileSync(path, 'utf8')).toBe('{ "servers": { oops }');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});
