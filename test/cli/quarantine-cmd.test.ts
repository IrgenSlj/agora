import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runCli } from '../../src/cli/app';
import {
  readCapabilityCache,
  type ServerCapabilities,
  upsertCapabilities
} from '../../src/stack/capability-cache';

function createIo(cwd: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: { write: (s: string) => void stdout.push(s) },
      stderr: { write: (s: string) => void stderr.push(s) },
      env: {},
      cwd
    } as never,
    out: () => stdout.join(''),
    err: () => stderr.join('')
  };
}

function seedQuarantined(dataDir: string, name = 'drifty'): ServerCapabilities {
  const entry: ServerCapabilities = {
    key: `${name}:npx ${name}`,
    name,
    command: ['npx', name],
    tools: [{ name: 'read', description: 'original description' }],
    ok: true,
    probedAt: new Date().toISOString(),
    descriptionDigest: 'approved-digest',
    liveDescriptionDigest: 'drifted-digest',
    liveTools: [{ name: 'read', description: 'CHANGED — now also exfiltrates' }],
    driftDetectedAt: new Date().toISOString(),
    state: 'quarantined',
    quarantineReason: 'tool description changed after approval',
    quarantinedAt: new Date().toISOString()
  };
  upsertCapabilities(dataDir, entry);
  return entry;
}

describe('agora quarantine', () => {
  test('an empty list does not read as a clean bill of health', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-q-'));
    try {
      const { io, out } = createIo(dir);
      const code = await runCli(['quarantine', '--data-dir', dir], io);
      expect(code).toBe(0);
      // Nothing quarantined only means no probe caught a change. Saying so is
      // the same rule as `network: not observed` in the observe plane.
      expect(out()).toContain('Nothing is quarantined');
      expect(out()).toContain('doctor --probe');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('lists quarantined servers and exits 1 so CI can gate', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-q-'));
    try {
      seedQuarantined(dir);
      const { io, out } = createIo(dir);
      const code = await runCli(['quarantine', 'list', '--data-dir', dir], io);
      expect(code).toBe(1);
      expect(out()).toContain('drifty');
      expect(out()).toContain('tool description changed after approval');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--json reports the drift reason', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-q-'));
    try {
      seedQuarantined(dir);
      const { io, out } = createIo(dir);
      await runCli(['quarantine', '--json', '--data-dir', dir], io);
      const payload = JSON.parse(out());
      expect(payload.count).toBe(1);
      expect(payload.servers[0].name).toBe('drifty');
      expect(payload.servers[0].reason).toContain('changed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('agora unquarantine', () => {
  test('refuses without --accept-risk and explains what the drift means', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-q-'));
    try {
      seedQuarantined(dir);
      const { io, err } = createIo(dir);
      const code = await runCli(['unquarantine', 'drifty', '--data-dir', dir], io);

      expect(code).toBe(2);
      expect(err()).toContain('--accept-risk');
      // Releasing re-enables a server whose tools changed after approval. The
      // refusal has to say why, not just demand a flag.
      expect(err()).toContain('rug-pull');

      // And it must not have released anything.
      expect(readCapabilityCache(dir)[0]!.state).toBe('quarantined');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--accept-risk releases and adopts the drifted digest as the new baseline', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-q-'));
    try {
      seedQuarantined(dir);
      const { io, out } = createIo(dir);
      const code = await runCli(['unquarantine', 'drifty', '--accept-risk', '--data-dir', dir], io);

      expect(code).toBe(0);
      expect(out()).toContain('Released');

      const entry = readCapabilityCache(dir)[0]!;
      expect(entry.state).toBe('installed');
      expect(entry.quarantineReason).toBeUndefined();
      // Crucially the *drifted* digest becomes the baseline. Leaving the old
      // one would re-quarantine on the next probe, which would read as the
      // release having silently failed.
      expect(entry.descriptionDigest).toBe('drifted-digest');
      expect(entry.tools[0]!.description).toContain('CHANGED');
      expect(entry.driftDetectedAt).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a released server stays released across a re-read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-q-'));
    try {
      seedQuarantined(dir);
      const first = createIo(dir);
      await runCli(['unquarantine', 'drifty', '--accept-risk', '--data-dir', dir], first.io);

      const second = createIo(dir);
      const code = await runCli(['quarantine', '--data-dir', dir], second.io);
      expect(code).toBe(0);
      expect(second.out()).toContain('Nothing is quarantined');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('an unknown name is a usage error, not a silent success', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-q-'));
    try {
      const { io, err } = createIo(dir);
      const code = await runCli(['unquarantine', 'nope', '--accept-risk', '--data-dir', dir], io);
      expect(code).toBe(2);
      expect(err()).toContain('not quarantined');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
