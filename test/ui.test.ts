import { describe, test, expect } from 'bun:test';
import {
  MEANDER,
  MASCOT_FRAMES,
  mascotFrame,
  renderMeander,
  movementBar,
  MOVEMENT_COLOR
} from '../src/ui';

describe('MEANDER', () => {
  test('is 52 chars wide (matches relief wordmark)', () => {
    expect(MEANDER.length).toBe(52);
  });
});

describe('mascotFrame', () => {
  test('cycles through 4 frames at 200ms cadence', () => {
    expect(MASCOT_FRAMES.length).toBe(4);
    expect(mascotFrame(0)).toBe(MASCOT_FRAMES[0]);
    expect(mascotFrame(200)).toBe(MASCOT_FRAMES[1]);
    expect(mascotFrame(600)).toBe(MASCOT_FRAMES[3]);
    expect(mascotFrame(800)).toBe(MASCOT_FRAMES[0]); // wraps
  });
});

describe('renderMeander', () => {
  test('idle mode emits the meander chars (under ANSI)', () => {
    const out = renderMeander({ trueColor: false, mode: 'idle' });
    // Strip ANSI escape sequences to get the raw glyph content
    // eslint-disable-next-line no-control-regex
    const plain = out.replace(/\x1b\[[0-9;]*m/g, '');
    expect(plain).toBe(MEANDER);
  });

  test('progress at 100% uses accent rgb (212;168;90)', () => {
    const out = renderMeander({ trueColor: true, mode: 'progress', pct: 100 });
    expect(out).toContain('212;168;90');
  });

  test('wave at different times produces different output', () => {
    const t0 = renderMeander({ trueColor: true, mode: 'wave', tMs: 0 });
    const t500 = renderMeander({ trueColor: true, mode: 'wave', tMs: 500 });
    expect(t0).not.toBe(t500);
  });
});

describe('movementBar', () => {
  test('emits ▍ with the thinking tint (138;120;102)', () => {
    const out = movementBar('thinking', { trueColor: true });
    expect(out).toContain('▍');
    expect(out).toContain('138;120;102');
  });
});

describe('MOVEMENT_COLOR', () => {
  test('has thinking/tool/response with hex + rgb', () => {
    for (const k of ['thinking', 'tool', 'response'] as const) {
      expect(MOVEMENT_COLOR[k].hex).toMatch(/^#[0-9A-F]{6}$/i);
      expect(MOVEMENT_COLOR[k].rgb).toHaveLength(3);
    }
  });
});
