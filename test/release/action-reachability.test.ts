import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

// The README's one call to action is `uses: IrgenSlj/agora@v0`. At 0.8.0 that
// line resolved to nothing: no `v0` tag had ever been created, so every reader
// who copied it got "Unable to resolve action" from GitHub — the CI wedge the
// whole release was built around was unreachable by the only route documented
// for reaching it.
//
// It is the same shape as the v0.7.0 failure the rest of this directory exists
// for. That one was "we published a version that never arrived"; this one is
// "we documented a reference nobody creates". Both are invisible from inside:
// the suite passes, the package builds, and the promise is still broken.
//
// So these assertions hold the documented surface and the machinery that
// produces it to each other. They cannot reach the network — the suite is
// hermetic on purpose — which means they cannot prove the tag exists on the
// remote. What they can prove is that something in the release path is trying
// to create it, and that every version number quoted at a user is one this
// repository can actually deliver.

const REPO = join(__dirname, '..', '..');
const readText = (rel: string) => readFileSync(join(REPO, rel), 'utf8');
const readJson = (rel: string) => JSON.parse(readText(rel));

/** Files that quote the Action at a reader as something to copy. */
const DOCS_QUOTING_THE_ACTION = ['README.md', 'docs/NEXT.md'];

const ACTION_REF = /uses:\s*IrgenSlj\/agora@(v\d+)/g;

describe('the Action reference the docs hand out', () => {
  const pkg = readJson('package.json') as { version: string };
  const major = `v${pkg.version.split('.')[0]}`;

  test('every documented reference names the current major tag', () => {
    // A doc still saying `@v0` after the 1.0.0 bump points readers at a tag
    // that has stopped moving — it keeps working, silently, on last year's
    // release. That is worse than an error, because nothing surfaces it.
    const wrong: string[] = [];
    for (const rel of DOCS_QUOTING_THE_ACTION) {
      for (const [, ref] of readText(rel).matchAll(ACTION_REF)) {
        if (ref !== major) wrong.push(`${rel}: @${ref} (package is ${pkg.version})`);
      }
    }
    expect(wrong, 'documented Action refs disagree with the package major').toEqual([]);
  });

  test('at least one doc actually quotes it, so this test cannot pass vacuously', () => {
    const total = DOCS_QUOTING_THE_ACTION.map(
      (rel) => [...readText(rel).matchAll(ACTION_REF)].length
    ).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
  });

  test('the release path creates the tag the docs point at', () => {
    // The assertion that would have caught the real bug. `@v0` was documented
    // for an entire release cycle with nothing anywhere that creates `v0`.
    const publish = readText('.github/workflows/publish.yml');
    expect(publish).toMatch(/git tag -f "\$major"/);
    expect(publish).toMatch(/git push -f origin "refs\/tags\/\$major"/);
  });

  test('moving a tag needs contents: write, and the job asks for it', () => {
    // Without it the push fails at the very end of a release that otherwise
    // succeeded, which is the most expensive place to discover a permission.
    const publish = readText('.github/workflows/publish.yml');
    expect(publish).toMatch(/contents:\s*write/);
  });
});

describe('the version floor the Action quotes back to users', () => {
  const pkg = readJson('package.json') as { version: string };

  test('is a release this repository can actually produce', () => {
    // action.yml tells a user "`agora ci` requires agora-hub >= X" when it
    // resolves something older. If X ever exceeds the version in package.json,
    // the Action is demanding a release that does not exist and the message
    // sends people looking for it.
    const action = readText('action.yml');
    const quoted = action.match(/requires agora-hub >= (\d+\.\d+\.\d+)/)?.[1];
    expect(quoted, 'action.yml no longer states a version floor for `ci`').toBeDefined();
    expect(cmp(quoted as string, pkg.version)).toBeLessThanOrEqual(0);
  });

  test('names a command the CLI still has', () => {
    // The floor exists because `ci` landed in 0.8.0. If `ci` is ever renamed,
    // the guard would keep explaining a command nobody can run.
    const action = readText('action.yml');
    expect(action).toMatch(/agora ci/);
    expect(readText('src/cli/app.ts')).toMatch(/\bci:\s*ciModule\.commandCi\b/);
  });
});

/** -1, 0, 1 — semver compare over the three numeric fields. */
function cmp(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0) ? -1 : 1;
  }
  return 0;
}
