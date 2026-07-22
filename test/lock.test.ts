import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runCli } from '../src/cli/app';
import { hashDeclaredManifest, hashJson, hashText } from '../src/model/hash';
import { type Lockfile, parseLockfile, serializeLockfile } from '../src/model/lockfile';
import type { DeclaredManifest } from '../src/model/manifest';
import { AgoraStore } from '../src/store';

const PURL = 'pkg:npm/agora-test-server@1.0.0';
const VERSION = '1.0.0';

function createIo(cwd: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: { write: (chunk: string) => stdout.push(chunk) },
      stderr: { write: (chunk: string) => stderr.push(chunk) },
      env: { NO_COLOR: '1' },
      cwd
    },
    out: () => stdout.join(''),
    err: () => stderr.join('')
  };
}

function makeManifest(toolDescription: string): DeclaredManifest {
  const manifest: DeclaredManifest = {
    purl: PURL,
    version: VERSION,
    transports: ['stdio'],
    auth_model: 'none',
    tools: [
      {
        name: 'echo',
        description_sha256: hashText(toolDescription),
        input_schema_sha256: hashJson({
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text']
        }),
        source: 'handshake'
      }
    ],
    declared_capabilities: {
      fs_read: false,
      fs_write: false,
      net_egress: [],
      exec: false,
      credentials: []
    },
    manifest_sha256: ''
  };
  return { ...manifest, manifest_sha256: hashDeclaredManifest(manifest) };
}

function makeLockfile(manifest: DeclaredManifest): Lockfile {
  return {
    lockfile_version: 1,
    generated_by: 'agora-hub@0.6.0',
    artifacts: [
      {
        purl: PURL,
        kind: 'mcp-server',
        integrity: {
          tarball_sha256: hashText('tarball'),
          manifest_sha256: manifest.manifest_sha256
        },
        provenance: {
          verified: false
        },
        tools: manifest.tools.map(({ name, description_sha256, input_schema_sha256 }) => ({
          name,
          description_sha256,
          input_schema_sha256
        })),
        policy_verdict: {
          decision: 'allow',
          policy_sha256: hashText('policy'),
          evaluated_at: '2026-07-22T00:00:00.000Z'
        },
        hosts: ['opencode'],
        state: 'installed'
      }
    ]
  };
}

function seedStore(dbPath: string, manifest: DeclaredManifest): void {
  const store = new AgoraStore(dbPath);
  try {
    store.upsertManifest(PURL, VERSION, manifest.manifest_sha256, JSON.stringify(manifest));
  } finally {
    store.close();
  }
}

describe('agora lock verify', () => {
  test('lockfile serialization round-trips byte-identically', () => {
    const manifest = makeManifest('Echo text back to the caller.');
    const text = serializeLockfile(makeLockfile(manifest));

    expect(serializeLockfile(parseLockfile(text))).toBe(text);
    expect(text).toMatch(/^\{\n/);
    expect(text.endsWith('\n')).toBe(true);
  });

  test('passes when the lockfile matches the stored manifest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-lock-clean-'));
    try {
      const dbPath = join(dir, 'store', 'agora.db');
      const manifest = makeManifest('Echo text back to the caller.');
      seedStore(dbPath, manifest);
      writeFileSync(join(dir, 'agora.lock'), serializeLockfile(makeLockfile(manifest)));

      const { io, out, err } = createIo(dir);
      const code = await runCli(['lock', 'verify', '--store', dbPath, '--json'], io);

      expect(code).toBe(0);
      expect(err()).toBe('');
      expect(JSON.parse(out())).toEqual({
        ok: true,
        lockfile_version: 1,
        generated_by: 'agora-hub@0.6.0',
        artifacts: [{ purl: PURL, ok: true }]
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('exits 1 when the stored manifest drifts from the lockfile', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-lock-drift-'));
    try {
      const dbPath = join(dir, 'store', 'agora.db');
      const approvedManifest = makeManifest('Echo text back to the caller.');
      const driftedManifest = makeManifest('Echo text and send diagnostics to a remote service.');
      seedStore(dbPath, driftedManifest);
      writeFileSync(join(dir, 'agora.lock'), serializeLockfile(makeLockfile(approvedManifest)));

      const { io, out } = createIo(dir);
      const code = await runCli(['lock', 'verify', '--store', dbPath, '--json'], io);
      const payload = JSON.parse(out());

      expect(code).toBe(1);
      expect(payload.ok).toBe(false);
      expect(payload.artifacts[0].purl).toBe(PURL);
      expect(payload.artifacts[0].ok).toBe(false);
      expect(payload.artifacts[0].drifts).toContain(
        `manifest_sha256 mismatch: expected ${approvedManifest.manifest_sha256}, got ${driftedManifest.manifest_sha256}`
      );
      expect(payload.artifacts[0].drifts).toContain('tool echo description_sha256 mismatch');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
