import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

// v0.7.0 was tagged, released, and never reached npm. Two independent bugs sat
// in the release path and the first masked the second:
//
//   1. publish.yml ran `bun test` — Bun's native runner, not the vitest suite.
//      It panics on this suite (NAPI fatal error, exit 132), so the release
//      workflow died 42s in and npm stayed on 0.6.1 while main carried the
//      entire trust plane.
//   2. The 0.7.0 bump landed only in package.json while other manifests kept
//      the old version.
//
// Neither is visible from a normal push: publish.yml only runs on a release.
// These assertions run on every push instead.

const REPO = join(__dirname, '..', '..');

const readJson = (rel: string) => JSON.parse(readFileSync(join(REPO, rel), 'utf8'));
const readText = (rel: string) => readFileSync(join(REPO, rel), 'utf8');

describe('release integrity', () => {
  const root = readJson('package.json');

  test('the declared node engine is not below what the dependencies require', () => {
    // Node 20 is end-of-life; the floor is 22.
    const declared = (root.engines?.node ?? '') as string;
    const floor = declared.match(/^>=\s*(\d+)/)?.[1];
    expect(floor, `engines.node should be a ">=<major>" floor, got "${declared}"`).toBeDefined();
    expect(Number(floor)).toBeGreaterThanOrEqual(22);
  });

  test('publish.yml runs the vitest suite, not bun test', () => {
    const publish = readText('.github/workflows/publish.yml');

    // `bun test` — the native runner — as a whole word. `bun run test` is the
    // package script and is what we want.
    expect(
      /run:\s*bun test\b/.test(publish),
      'publish.yml must run `bun run test` (vitest); `bun test` panics on this suite'
    ).toBe(false);
    expect(publish).toMatch(/run:\s*bun run test\b/);
  });

  test('publish.yml gates on at least the checks CI gates on', () => {
    // The real failure was publish.yml drifting away from ci.yml unnoticed
    // because it only ever runs on a release. Pin the overlap.
    const publish = readText('.github/workflows/publish.yml');
    for (const script of ['bun run typecheck:cli', 'bun run test', 'bun run build']) {
      expect(publish, `publish.yml should run \`${script}\``).toContain(script);
    }
  });

  test('no workflow splices an event input into a shell script', () => {
    // `run: npm publish --tag ${{ github.event.inputs.tag }}` interpolates
    // attacker-controllable text into the shell before bash ever sees it.
    // Inputs belong in `env:`, where they arrive as data.
    const offenders: string[] = [];
    for (const wf of ['.github/workflows/publish.yml', '.github/workflows/ci.yml']) {
      for (const line of readText(wf).split('\n')) {
        if (
          /\$\{\{\s*(github\.event\.inputs|inputs|github\.event\.(issue|pull_request))\b/.test(line)
        ) {
          // Fine in `env:` bindings and `if:` conditions; not inside a script.
          if (!/^\s*(-?\s*)?(if|[A-Z_][A-Z0-9_]*):\s/.test(line)) {
            offenders.push(`${wf}: ${line.trim()}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
