import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { MarketplaceItem } from '../src/catalog/bundled';
import type { ScanResult } from '../src/scan';
import { listIntents } from '../src/serve/intent';
import { requestInstall } from '../src/serve/request';

function scanResult(item: MarketplaceItem, warn = 0, fail = 0): ScanResult {
  return {
    id: item.id,
    itemKind: item.kind,
    checks: [],
    summary: { pass: warn || fail ? 0 : 1, warn, fail }
  };
}

describe('agent install requests', () => {
  test('a warning can create only an intent, never host or manifest files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agora-request-'));
    const dataDir = join(root, 'data');
    const configPath = join(root, 'opencode.json');
    try {
      const result = await requestInstall({
        query: 'mcp-postgres',
        configPath,
        cwd: root,
        dataDir,
        rationale: 'Need database access',
        now: () => new Date('2026-08-02T12:00:00.000Z'),
        deps: {
          scan: async (item) => scanResult(item, 1),
          fetchFederatedItem: async () => null
        }
      });

      expect(result.status).toBe('requested');
      expect(result.authorization?.verdict).toBe('review');
      expect(result.intent?.rationale).toBe('Need database access');
      expect(result.intent?.requestedAt).toBe('2026-08-02T12:00:00.000Z');
      expect(result.approvalCommand).toContain(result.intent!.id);
      expect(listIntents(dataDir)).toHaveLength(1);
      expect(readdirSync(dataDir)).toEqual(['intents']);
      expect(existsSync(configPath)).toBe(false);
      expect(existsSync(join(root, 'agora.toml'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('failed evidence writes no intent', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agora-request-'));
    const dataDir = join(root, 'data');
    try {
      const result = await requestInstall({
        query: 'mcp-postgres',
        cwd: root,
        dataDir,
        deps: {
          scan: async (item) => scanResult(item, 0, 1),
          fetchFederatedItem: async () => null
        }
      });

      expect(result.status).toBe('blocked');
      expect(result.authorization?.verdict).toBe('deny');
      expect(listIntents(dataDir)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
