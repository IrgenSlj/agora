import { describe, expect, test } from 'vitest';
import { detectAgoraDataDir } from '../src/state';

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
