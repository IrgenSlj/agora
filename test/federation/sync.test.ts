import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { syncFederationItems } from '../../src/federation/sync';
import type { FederatedItem, SourceId } from '../../src/federation/types';
import { buildPurl } from '../../src/model/purl';
import { AgoraStore } from '../../src/store';

const FETCHED_AT = '2026-07-22T10:00:00.000Z';
const NPM_PACKAGE = '@example/filesystem-server';
const VERSION = '1.0.0';

function item(source: SourceId, id: string, name: string): FederatedItem {
  return {
    kind: 'package',
    id,
    name,
    description: `${name} description`,
    author: 'example',
    version: VERSION,
    category: 'mcp',
    tags: [],
    stars: 0,
    installs: 0,
    createdAt: FETCHED_AT,
    npmPackage: NPM_PACKAGE,
    provenance: [
      {
        source,
        sourceUrl: `https://example.test/${source}/${encodeURIComponent(id)}`,
        fetchedAt: FETCHED_AT,
        verified: source === 'official'
      }
    ],
    serverJson: {
      name: id,
      version: VERSION,
      packages: [{ registryType: 'npm', identifier: NPM_PACKAGE, version: VERSION }]
    }
  };
}

function noPurlItem(source: SourceId): FederatedItem {
  return {
    kind: 'package',
    id: `${source}/no-purl`,
    name: 'No purl',
    description: '',
    author: 'example',
    version: '',
    category: 'mcp',
    tags: [],
    stars: 0,
    installs: 0,
    createdAt: FETCHED_AT,
    provenance: [
      {
        source,
        sourceUrl: `https://example.test/${source}/no-purl`,
        fetchedAt: FETCHED_AT
      }
    ]
  };
}

describe('syncFederationItems()', () => {
  let dir: string;
  let storePath: string;
  let casDir: string;
  let purl: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agora-federation-sync-'));
    storePath = join(dir, 'agora.db');
    casDir = join(dir, 'cas');
    purl = buildPurl({
      type: 'npm',
      namespace: '@example',
      name: 'filesystem-server',
      version: VERSION
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('dedupes by purl and keeps official metadata ahead of glama and pulsemcp', () => {
    syncFederationItems(
      { storePath, casDir },
      {
        source: 'glama',
        items: [item('glama', 'glama/fs', 'Glama Filesystem')],
        syncedAt: FETCHED_AT
      }
    );
    syncFederationItems(
      { storePath, casDir },
      {
        source: 'pulsemcp',
        items: [item('pulsemcp', 'pulse/fs', 'Pulse Filesystem')],
        syncedAt: FETCHED_AT
      }
    );
    const result = syncFederationItems(
      { storePath, casDir },
      {
        source: 'official',
        items: [item('official', 'official/fs', 'Official Filesystem')],
        syncedAt: FETCHED_AT
      }
    );

    const store = new AgoraStore(storePath);
    try {
      expect(result.affectedPurls).toEqual([purl]);
      expect(store.getArtifact(purl)).toMatchObject({
        purl,
        display_name: 'Official Filesystem',
        publisher_identity_verified: true
      });
      expect(store.getArtifactSources(purl).map((source) => source.adapter)).toEqual([
        'glama',
        'official',
        'pulsemcp'
      ]);
      expect(store.listSourceItemsByPurl(purl)).toHaveLength(3);
    } finally {
      store.close();
    }
  });

  test('pruning the preferred source falls back to the next source for artifact metadata', () => {
    const glama = item('glama', 'glama/fs', 'Glama Filesystem');
    const official = item('official', 'official/fs', 'Official Filesystem');
    syncFederationItems(
      { storePath, casDir },
      { source: 'glama', items: [glama], syncedAt: FETCHED_AT }
    );
    syncFederationItems(
      { storePath, casDir },
      { source: 'official', items: [official], syncedAt: FETCHED_AT }
    );

    const result = syncFederationItems(
      { storePath, casDir },
      { source: 'official', items: [], prunedItems: [official], syncedAt: FETCHED_AT }
    );

    const store = new AgoraStore(storePath);
    try {
      expect(result.prunedSourceItems).toBe(1);
      expect(store.getArtifact(purl)).toMatchObject({
        display_name: 'Glama Filesystem',
        publisher_identity_verified: false
      });
      expect(store.getArtifactSources(purl).map((source) => source.adapter)).toEqual(['glama']);
      expect(store.listSourceItems('official')).toEqual([]);
    } finally {
      store.close();
    }
  });

  test('indexes source item payloads even when a source cannot yield a purl', () => {
    const result = syncFederationItems(
      { storePath, casDir },
      { source: 'glama', items: [noPurlItem('glama')], syncedAt: FETCHED_AT }
    );

    const store = new AgoraStore(storePath);
    try {
      expect(result.skippedWithoutPurl).toBe(1);
      expect(result.upsertedSourceItems).toBe(1);
      expect(store.listSourceItems('glama')).toEqual([
        expect.objectContaining({ upstream_id: 'glama/no-purl', purl: null })
      ]);
    } finally {
      store.close();
    }
  });
});
