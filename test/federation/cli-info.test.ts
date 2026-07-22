import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runCli } from '../../src/cli/app';
import { syncFederationItems } from '../../src/federation/sync';
import type { FederatedItem } from '../../src/federation/types';
import { buildPurl } from '../../src/model/purl';

const FETCHED_AT = '2026-07-22T10:00:00.000Z';
const NPM_PACKAGE = '@example/server-filesystem';
const VERSION = '1.2.3';

function createIo(dataDir: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: { write: (chunk: string) => stdout.push(chunk) },
      stderr: { write: (chunk: string) => stderr.push(chunk) },
      env: { AGORA_HOME: dataDir },
      cwd: process.cwd()
    },
    stdout,
    stderr
  };
}

function syncedItem(): FederatedItem {
  return {
    kind: 'package',
    id: 'io.github.example/filesystem',
    name: 'Filesystem Server',
    description: 'Filesystem access',
    author: 'io.github.example',
    version: VERSION,
    category: 'mcp',
    tags: [],
    stars: 0,
    installs: 0,
    createdAt: FETCHED_AT,
    npmPackage: NPM_PACKAGE,
    provenance: [
      {
        source: 'official',
        sourceUrl:
          'https://registry.modelcontextprotocol.io/v0.1/servers/io.github.example%2Ffilesystem/versions',
        fetchedAt: FETCHED_AT,
        verified: true
      }
    ],
    serverJson: {
      name: 'io.github.example/filesystem',
      version: VERSION,
      packages: [{ registryType: 'npm', identifier: NPM_PACKAGE, version: VERSION }]
    }
  };
}

describe('agora info', () => {
  test('reads artifact details from the local SQLite/CAS sync store', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'agora-info-'));
    try {
      const purl = buildPurl({
        type: 'npm',
        namespace: '@example',
        name: 'server-filesystem',
        version: VERSION
      });
      syncFederationItems(
        { storePath: join(dataDir, 'agora.db'), casDir: join(dataDir, 'cas') },
        { source: 'official', items: [syncedItem()], syncedAt: FETCHED_AT }
      );
      const { io, stdout, stderr } = createIo(dataDir);

      const code = await runCli(['info', purl, '--json'], io);
      const payload = JSON.parse(stdout.join(''));

      expect(code).toBe(0);
      expect(stderr.join('')).toBe('');
      expect(payload.purl).toBe(purl);
      expect(payload.artifact.display_name).toBe('Filesystem Server');
      expect(payload.artifact.publisher_identity_verified).toBe(true);
      expect(payload.sources).toEqual([
        expect.objectContaining({
          adapter: 'official',
          upstream_id: 'io.github.example/filesystem'
        })
      ]);
      expect(payload.sourceItems).toEqual([
        expect.objectContaining({
          source: 'official',
          upstream_id: 'io.github.example/filesystem',
          item: expect.objectContaining({ name: 'Filesystem Server' })
        })
      ]);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('rejects invalid purls without creating a store', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'agora-info-'));
    try {
      const { io, stderr } = createIo(dataDir);

      const code = await runCli(['info', 'not-a-purl'], io);

      expect(code).toBe(2);
      expect(stderr.join('')).toContain('Invalid purl');
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
