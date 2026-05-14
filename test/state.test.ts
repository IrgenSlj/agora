/**
 * Contract tests for src/state.ts and src/config-files.ts — data safety.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectAgoraDataDir,
  loadAgoraState,
  saveItemToState,
  writeAgoraState,
  type AgoraState
} from '../src/state';
import {
  detectOpenCodeConfigPath,
  doctorOpenCodeConfig,
  loadOpenCodeConfig,
  writeOpenCodeConfig
} from '../src/config-files';
import { findMarketplaceItem } from '../src/marketplace';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'agora-state-test-'));
}

// ── detectAgoraDataDir ───────────────────────────────────────────────────────

describe('detectAgoraDataDir', () => {
  test('uses AGORA_HOME env var when set', () => {
    const dir = detectAgoraDataDir({ env: { AGORA_HOME: '/tmp/custom-agora' } });
    expect(dir).toBe('/tmp/custom-agora');
  });

  test('uses explicitDir option over env', () => {
    const dir = detectAgoraDataDir({
      explicitDir: '/tmp/explicit',
      env: { AGORA_HOME: '/tmp/env' }
    });
    expect(dir).toBe('/tmp/explicit');
  });

  test('falls back to XDG_CONFIG_HOME/agora', () => {
    const dir = detectAgoraDataDir({ env: { XDG_CONFIG_HOME: '/tmp/xdg' } });
    expect(dir).toBe('/tmp/xdg/agora');
  });

  test('falls back to ~/.config/agora when no env set', () => {
    const dir = detectAgoraDataDir({ home: '/home/testuser', env: {} });
    expect(dir).toBe('/home/testuser/.config/agora');
  });
});

// ── loadAgoraState / writeAgoraState round-trip ──────────────────────────────

describe('loadAgoraState / writeAgoraState', () => {
  test('round-trip: written state matches loaded state', () => {
    const dir = makeTmp();
    try {
      const state: AgoraState = {
        version: 1,
        savedItems: [{ id: 'mcp-github', savedAt: '2026-01-01T00:00:00.000Z' }]
      };
      writeAgoraState(dir, state);

      const loaded = loadAgoraState(dir);
      expect(loaded.version).toBe(1);
      expect(loaded.savedItems).toHaveLength(1);
      expect(loaded.savedItems[0].id).toBe('mcp-github');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('written file is valid JSON', () => {
    const dir = makeTmp();
    try {
      const state: AgoraState = {
        version: 1,
        savedItems: []
      };
      writeAgoraState(dir, state);

      const raw = readFileSync(join(dir, 'state.json'), 'utf8');
      expect(() => JSON.parse(raw)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('loadAgoraState returns empty state for non-existent dir', () => {
    const dir = join(tmpdir(), 'agora-does-not-exist-' + Date.now());
    const state = loadAgoraState(dir);
    expect(state.version).toBe(1);
    expect(state.savedItems).toHaveLength(0);
  });

  test('corrupt state.json returns empty state (not a crash)', () => {
    const dir = makeTmp();
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'state.json'), 'this is not json', 'utf8');

      // Capture stderr to confirm a warning is written
      const originalError = console.error;
      const stderrLines: string[] = [];
      console.error = (...args: unknown[]) => stderrLines.push(args.join(' '));
      try {
        const state = loadAgoraState(dir);
        expect(state.version).toBe(1);
        expect(state.savedItems).toHaveLength(0);
        expect(stderrLines.some((l) => l.includes('Warning') || l.includes('unreadable'))).toBe(
          true
        );
      } finally {
        console.error = originalError;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('deduplicates savedItems with the same id', () => {
    const dir = makeTmp();
    try {
      const state: AgoraState = {
        version: 1,
        savedItems: [
          { id: 'mcp-github', savedAt: '2026-01-01T00:00:00.000Z' },
          { id: 'mcp-github', savedAt: '2026-01-02T00:00:00.000Z' }
        ]
      };
      writeAgoraState(dir, state);
      const loaded = loadAgoraState(dir);
      expect(loaded.savedItems).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── saveItemToState ──────────────────────────────────────────────────────────

describe('saveItemToState', () => {
  test('adds a new item and returns added=true', () => {
    const state: AgoraState = { version: 1, savedItems: [] };
    const item = findMarketplaceItem('mcp-github')!;
    const result = saveItemToState(state, item);
    expect(result.added).toBe(true);
    expect(result.state.savedItems).toHaveLength(1);
    expect(result.state.savedItems[0].id).toBe('mcp-github');
  });

  test('saving a duplicate returns added=false and does not grow the list', () => {
    const state: AgoraState = { version: 1, savedItems: [] };
    const item = findMarketplaceItem('mcp-github')!;
    const first = saveItemToState(state, item);
    const second = saveItemToState(first.state, item);
    expect(second.added).toBe(false);
    expect(second.state.savedItems).toHaveLength(1);
  });
});

// ── config-files.ts ──────────────────────────────────────────────────────────

describe('writeOpenCodeConfig / loadOpenCodeConfig', () => {
  test('round-trip: written config can be loaded back', () => {
    const dir = makeTmp();
    const configPath = join(dir, 'opencode.json');
    try {
      const config = {
        $schema: 'https://opencode.ai/config.json',
        mcp: {
          'mcp-github': {
            type: 'local' as const,
            command: ['npx', '@modelcontextprotocol/server-github'],
            enabled: true
          }
        },
        plugin: ['opencode-agora']
      };
      writeOpenCodeConfig(configPath, config);

      const loaded = loadOpenCodeConfig(configPath);
      expect(loaded.exists).toBe(true);
      expect(loaded.error).toBeUndefined();
      expect(loaded.config.$schema).toBe('https://opencode.ai/config.json');
      expect(loaded.config.mcp!['mcp-github']).toBeDefined();
      expect(loaded.config.plugin).toContain('opencode-agora');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('written file is valid JSON', () => {
    const dir = makeTmp();
    const configPath = join(dir, 'opencode.json');
    try {
      writeOpenCodeConfig(configPath, { $schema: 'https://opencode.ai/config.json' });
      const raw = readFileSync(configPath, 'utf8');
      expect(() => JSON.parse(raw)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('loadOpenCodeConfig returns exists=false for missing file', () => {
    const loaded = loadOpenCodeConfig('/tmp/agora-does-not-exist-' + Date.now() + '.json');
    expect(loaded.exists).toBe(false);
    expect(loaded.error).toBeUndefined();
    expect(loaded.config).toEqual({});
  });

  test('loadOpenCodeConfig surfaces error for malformed JSON', () => {
    const dir = makeTmp();
    const configPath = join(dir, 'bad.json');
    try {
      writeFileSync(configPath, '{ this is not json }', 'utf8');
      const loaded = loadOpenCodeConfig(configPath);
      expect(loaded.exists).toBe(true);
      expect(loaded.error).toBeDefined();
      expect(typeof loaded.error).toBe('string');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('detectOpenCodeConfigPath', () => {
  test('uses OPENCODE_CONFIG env var when set', () => {
    const path = detectOpenCodeConfigPath({
      env: { OPENCODE_CONFIG: '/tmp/custom-opencode.json' }
    });
    expect(path).toBe('/tmp/custom-opencode.json');
  });

  test('uses explicitPath option over env', () => {
    const path = detectOpenCodeConfigPath({
      explicitPath: '/tmp/explicit.json',
      env: { OPENCODE_CONFIG: '/tmp/env.json' }
    });
    expect(path).toBe('/tmp/explicit.json');
  });

  test('falls back to a project-local opencode.json when nothing exists', () => {
    const cwd = '/tmp/no-such-dir-' + Date.now();
    const path = detectOpenCodeConfigPath({
      cwd,
      home: '/home/testuser',
      env: {}
    });
    // Falls back to the project-local path, not the user's global config,
    // so init/use never silently mutate ~/.config/opencode/opencode.json.
    expect(path).toBe(join(cwd, 'opencode.json'));
  });

  test('prefers local opencode.json when it exists', () => {
    const dir = makeTmp();
    const localConfig = join(dir, 'opencode.json');
    try {
      writeFileSync(localConfig, '{}', 'utf8');
      const path = detectOpenCodeConfigPath({ cwd: dir, home: '/home/testuser', env: {} });
      expect(path).toBe(localConfig);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('doctorOpenCodeConfig', () => {
  test('reports valid=true for a well-formed config', () => {
    const dir = makeTmp();
    const configPath = join(dir, 'opencode.json');
    try {
      writeOpenCodeConfig(configPath, {
        mcp: {
          'mcp-github': {
            type: 'local',
            command: ['npx', '@modelcontextprotocol/server-github'],
            enabled: true
          }
        },
        plugin: ['opencode-agora']
      });
      const report = doctorOpenCodeConfig(configPath);
      expect(report.valid).toBe(true);
      expect(report.exists).toBe(true);
      expect(report.mcpServers).toBe(1);
      expect(report.plugins).toBe(1);
      expect(report.error).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('reports valid=false and an error for malformed JSON', () => {
    const dir = makeTmp();
    const configPath = join(dir, 'broken.json');
    try {
      writeFileSync(configPath, 'totally broken json', 'utf8');
      const report = doctorOpenCodeConfig(configPath);
      expect(report.valid).toBe(false);
      expect(report.error).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('reports exists=false for missing file with sensible defaults', () => {
    const report = doctorOpenCodeConfig('/tmp/agora-missing-' + Date.now() + '.json');
    expect(report.exists).toBe(false);
    expect(report.valid).toBe(true); // no error → valid
    expect(report.mcpServers).toBe(0);
    expect(report.plugins).toBe(0);
  });

  test('packages list reflects scoped npmPackage args', () => {
    const dir = makeTmp();
    const configPath = join(dir, 'opencode.json');
    try {
      writeOpenCodeConfig(configPath, {
        mcp: {
          'mcp-github': {
            type: 'local',
            command: ['npx', '@modelcontextprotocol/server-github'],
            enabled: true
          }
        }
      });
      const report = doctorOpenCodeConfig(configPath);
      expect(report.packages).toContain('@modelcontextprotocol/server-github');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
