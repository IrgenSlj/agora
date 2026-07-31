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
//   2. The 0.7.0 bump landed only in package.json. The plugin manifests and
//      packages/opencode-agora still said 0.6.1, and opencode-agora pinned
//      `agora-hub: 0.6.1` — so a *successful* publish would have shipped a
//      plugin demanding the version it was meant to replace.
//
// Neither is visible from a normal push: publish.yml only runs on a release.
// These assertions run on every push instead.

const REPO = join(__dirname, '..', '..');

const readJson = (rel: string) => JSON.parse(readFileSync(join(REPO, rel), 'utf8'));
const readText = (rel: string) => readFileSync(join(REPO, rel), 'utf8');

describe('release integrity', () => {
  const root = readJson('package.json');

  test('every manifest carries the same version as package.json', () => {
    // Each of these is a separate distribution channel for the same release.
    // A stale one ships the old version number to that channel's users.
    const manifests = [
      '.claude-plugin/plugin.json',
      'gemini-extension.json',
      'packages/opencode-agora/package.json'
    ];

    const drift = manifests
      .map((rel) => ({ rel, version: readJson(rel).version as string }))
      .filter((m) => m.version !== root.version);

    expect(drift, `these manifests disagree with package.json (${root.version})`).toEqual([]);
  });

  test('the opencode plugin pins the exact agora-hub version being published', () => {
    // publish.yml publishes the pair back to back and calls them atomic. That
    // is only true if the pin tracks the bump.
    const plugin = readJson('packages/opencode-agora/package.json');
    expect(plugin.dependencies['agora-hub']).toBe(root.version);
  });

  test('the declared node engine is not below what the dependencies require', () => {
    // `>=20` was declared while `better-sqlite3` requires `>=22` and the entire
    // sigstore tree requires `^22.22.2 || ^24.15.0 || >=26.0.0`. A Node 20 user
    // would have installed on the strength of that claim and got a Verify plane
    // that could not verify — the one thing the product is for.
    //
    // Deliberately a floor rather than a mirror of sigstore's exact range:
    // sigstore excludes odd-numbered Node releases, but Agora is verified
    // working on them, and claiming otherwise would be a false negative.
    const declared = (root.engines?.node ?? '') as string;
    const floor = declared.match(/^>=\s*(\d+)/)?.[1];
    expect(floor, `engines.node should be a ">=<major>" floor, got "${declared}"`).toBeDefined();
    expect(Number(floor)).toBeGreaterThanOrEqual(22);
  });

  test('the generated schemas ship with the package', () => {
    // 39 JSON Schemas are generated from src/model/ and CI-guarded against
    // drift, but `files: ["dist"]` kept them out of the tarball — so the one
    // artifact that lets someone else read Agora's evidence format without
    // trusting Agora was visible only to people already reading the repo.
    // "Evidence, not scores" is only checkable if the format is published.
    expect(root.files).toContain('schemas');
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
