import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  deleteIntent,
  type InstallIntent,
  intentsDir,
  listIntents,
  newIntentId,
  readIntent,
  writeIntent
} from '../src/serve/intent';

// The intent record is the whole safety argument for exposing discovery to an
// agent, so these tests are about what it must *not* do.

let dir: string;

const intent = (over: Partial<InstallIntent> = {}): InstallIntent => ({
  id: newIntentId(),
  item: 'mcp-filesystem',
  requestedAt: new Date().toISOString(),
  evidence: { planes: [] },
  status: 'pending',
  ...over
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agora-intent-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('install intents', () => {
  test('writing an intent touches nothing but the intents directory', () => {
    // The load-bearing assertion. If a request ever writes a host config, an
    // agent can install its own tools and the server must not ship.
    writeIntent(dir, intent());

    const top = readdirSync(dir);
    expect(top).toEqual(['intents']);
    expect(existsSync(join(dir, 'opencode.json'))).toBe(false);
    expect(existsSync(join(dir, 'agora.toml'))).toBe(false);
    expect(existsSync(join(dir, 'agora.lock'))).toBe(false);
  });

  test('ids are short, unambiguous and hand-typeable', () => {
    // A human retypes this from an agent transcript into their own terminal.
    // l/1/O/0 in that path is a support burden and a mis-approval risk.
    for (let i = 0; i < 50; i++) {
      const id = newIntentId();
      expect(id).toMatch(/^[a-z2-9]{6}$/);
      expect(id).not.toMatch(/[l1o0i]/);
    }
  });

  test('ids do not collide in bulk', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => newIntentId()));
    expect(ids.size).toBe(2000);
  });

  test('a traversal id cannot read outside the data dir', () => {
    // `id` reaches here from a CLI argument and, upstream, from an agent. A
    // path join without validation turns approval into arbitrary file read.
    writeFileSync(join(dir, 'secret.json'), JSON.stringify({ token: 'hunter2' }));
    expect(readIntent(dir, '../secret')).toBeNull();
    expect(readIntent(dir, '../../etc/passwd')).toBeNull();
    expect(readIntent(dir, 'a/../../secret')).toBeNull();
  });

  test('a traversal id cannot delete outside the data dir', () => {
    const victim = join(dir, 'important.json');
    writeFileSync(victim, '{}');
    expect(deleteIntent(dir, '../important')).toBe(false);
    expect(existsSync(victim)).toBe(true);
  });

  test('round-trips', () => {
    const written = intent({ rationale: 'need filesystem access' });
    writeIntent(dir, written);
    expect(readIntent(dir, written.id)?.rationale).toBe('need filesystem access');
  });

  test('a corrupt intent does not hide the others', () => {
    writeIntent(dir, intent());
    writeIntent(dir, intent());
    writeFileSync(join(intentsDir(dir), 'broken.json'), '{{{not json');

    expect(listIntents(dir)).toHaveLength(2);
  });

  test('listing an absent directory is empty, not an error', () => {
    expect(listIntents(join(dir, 'nope'))).toEqual([]);
  });

  test('newest first, so a human sees the request they just heard about', () => {
    writeIntent(dir, intent({ id: 'aaaaaa', requestedAt: '2026-01-01T00:00:00Z' }));
    writeIntent(dir, intent({ id: 'bbbbbb', requestedAt: '2026-06-01T00:00:00Z' }));
    expect(listIntents(dir).map((i) => i.id)).toEqual(['bbbbbb', 'aaaaaa']);
  });
});
