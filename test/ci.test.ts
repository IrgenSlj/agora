import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { annotationsFor, jobSummary } from '../src/ci/github';
import type { CiReport } from '../src/ci/report';
import { runCli } from '../src/cli/app';

// `agora ci` is the surface most likely to be read as a guarantee: it prints
// one glyph on a run page and people trust it without opening the log. So the
// tests worth having are not the happy path — they are every way a green check
// could come to mean more than the run actually established.

let dir: string;

function config(mcp: Record<string, unknown>): void {
  writeFileSync(
    join(dir, 'opencode.json'),
    JSON.stringify({ $schema: 'https://opencode.ai/config.json', mcp })
  );
}

function io(fetcher?: typeof globalThis.fetch, env: Record<string, string> = {}) {
  const out: string[] = [];
  return {
    out: () => out.join(''),
    io: {
      stdout: { write: (s: string) => void out.push(s) },
      stderr: { write: (s: string) => void out.push(s) },
      env: { HOME: dir, ...env },
      cwd: dir,
      ...(fetcher ? { fetcher } : {})
    }
  };
}

const advisory = (id: string, severity: string) => ({
  id,
  summary: `${id} summary`,
  database_specific: { severity }
});

const respond = (vulns: unknown[]) =>
  Promise.resolve(new Response(JSON.stringify({ vulns }), { status: 200 }));

const server = { type: 'local', command: ['npx', '@scope/server@1.0.0'], enabled: true };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agora-ci-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('agora ci', () => {
  test('a blocking advisory fails the build', async () => {
    config({ fs: server });
    const { io: cliIo, out } = io((() => respond([advisory('GHSA-x', 'HIGH')])) as never);

    expect(await runCli(['ci'], cliIo as never)).toBe(1);
    expect(out()).toContain('Something you trusted has changed.');
  });

  test('a non-blocking advisory is reported without failing the build', async () => {
    // Same reasoning as `audit`: failing on every moderate advisory trains
    // people to delete the step, which costs more than it saves.
    config({ fs: server });
    const { io: cliIo } = io((() => respond([advisory('GHSA-y', 'MODERATE')])) as never);

    expect(await runCli(['ci'], cliIo as never)).toBe(0);
  });

  test('a missing lockfile is not established, and never renders as clean', async () => {
    // The core claim of the command. Most repositories have no agora.lock, so
    // this is the path almost every first run takes — and the one where a green
    // "nothing changed" would be a lie by omission.
    config({ fs: server });
    const { io: cliIo, out } = io((() => respond([])) as never);

    expect(await runCli(['ci'], cliIo as never)).toBe(0);
    expect(out()).toContain('nothing is pinned');
    expect(out()).toContain('that is not the same as clean');
    expect(out()).not.toContain('Nothing you trusted has changed.');
  });

  test('an unresolvable server does not fail the build — CI runners have no servers installed', async () => {
    // Deliberate asymmetry with `doctor --strict`. On a fresh runner almost no
    // `npx`-resolved server exists, and going red for that would be both
    // useless and untrue: this command promises nothing you trusted has
    // *changed*, and a server never installed here has not changed. If this
    // ever starts failing the build, the step gets deleted in week two.
    config({ fs: { type: 'local', command: ['definitely-not-on-path'], enabled: true } });
    const { io: cliIo, out } = io((() => respond([])) as never);

    expect(await runCli(['ci'], cliIo as never)).toBe(0);
    expect(out()).toContain('could not be resolved in this environment');
  });

  test('a repository that commits only agora.toml is still checked', async () => {
    // The adoption case that matters most and was broken first: `agora.toml` is
    // the artifact this product spends a whole plane telling people to commit,
    // and a CI runner has the repository, not somebody's host configs. Reading
    // only host adapters meant the users who had adopted Agora correctly were
    // the ones who got an empty report.
    writeFileSync(join(dir, 'agora.toml'), '[mcp.fs]\ncommand = ["npx", "@scope/server@1.0.0"]\n');
    const { io: cliIo, out } = io((() => respond([advisory('GHSA-x', 'HIGH')])) as never);

    expect(await runCli(['ci'], cliIo as never)).toBe(1);
    expect(out()).toContain('GHSA-x');
  });

  test('a manifest entry disabled in agora.toml is not checked', async () => {
    config({ fs: server });
    writeFileSync(
      join(dir, 'agora.toml'),
      '[mcp.fs]\ncommand = ["npx", "@scope/server@1.0.0"]\nenabled = false\n'
    );
    const { io: cliIo, out } = io((() => respond([advisory('GHSA-x', 'HIGH')])) as never);

    expect(await runCli(['ci'], cliIo as never)).toBe(0);
    expect(out()).not.toContain('GHSA-x');
  });

  test('--fail-on-unknown turns an unanswerable check into a failure', async () => {
    config({ fs: server });
    const { io: cliIo } = io((() => respond([])) as never);

    expect(await runCli(['ci', '--fail-on-unknown'], cliIo as never)).toBe(1);
  });

  test('an unreachable OSV exits 3, not 0 — unchecked is not clean', async () => {
    // The outage case. Exit 0 here would hand every user of this Action a clean
    // bill of health that the run never established.
    config({ fs: server });
    const down = (() => Promise.reject(new Error('ECONNREFUSED'))) as never;
    const { io: cliIo, out } = io(down);

    expect(await runCli(['ci'], cliIo as never)).toBe(3);
    expect(out()).toContain('OSV unreachable');
  });

  test('--json reports every check with its state', async () => {
    config({ fs: server });
    const { io: cliIo, out } = io((() => respond([])) as never);

    await runCli(['ci', '--json'], cliIo as never);
    const report = JSON.parse(out()) as CiReport;

    expect(report.checks.map((c) => c.name)).toEqual(['advisories', 'drift', 'health']);
    expect(report.notEstablished).toContain('drift');
    expect(report.checks.find((c) => c.name === 'advisories')?.state).toBe('pass');
  });

  test('no annotations are emitted outside GitHub Actions', async () => {
    config({ fs: server });
    const { io: cliIo, out } = io((() => respond([advisory('GHSA-x', 'HIGH')])) as never);

    await runCli(['ci'], cliIo as never);
    expect(out()).not.toContain('::error');
  });

  test('under Actions, a failure is annotated against the config that declares it', async () => {
    config({ fs: server });
    const { io: cliIo, out } = io((() => respond([advisory('GHSA-x', 'HIGH')])) as never, {
      GITHUB_ACTIONS: 'true'
    });

    await runCli(['ci'], cliIo as never);
    expect(out()).toContain('::error');
    expect(out()).toContain('GHSA-x');
    expect(out()).toContain('file=');
  });

  test('the job summary is written when Actions provides a path', async () => {
    const summaryPath = join(dir, 'summary.md');
    writeFileSync(summaryPath, '');
    config({ fs: server });
    const { io: cliIo } = io((() => respond([advisory('GHSA-x', 'HIGH')])) as never, {
      GITHUB_ACTIONS: 'true',
      GITHUB_STEP_SUMMARY: summaryPath
    });

    await runCli(['ci'], cliIo as never);
    const summary = readFileSync(summaryPath, 'utf8');
    expect(summary).toContain('Something you trusted has changed.');
    expect(summary).toContain('GHSA-x');
  });
});

describe('ci rendering', () => {
  const base = (over: Partial<CiReport>): CiReport => ({
    checks: [],
    ok: true,
    failed: [],
    notEstablished: [],
    unavailable: [],
    ...over
  });

  test('a clean run says so only when every check was actually established', () => {
    const clean = base({
      checks: [
        { name: 'advisories', state: 'pass', summary: '1 checked', findings: [] },
        { name: 'drift', state: 'pass', summary: 'locked', findings: [] },
        { name: 'health', state: 'pass', summary: 'fine', findings: [] }
      ]
    });
    expect(jobSummary(clean)).toContain('Nothing you trusted has changed.');

    const partial = base({
      notEstablished: ['drift'],
      checks: [
        { name: 'advisories', state: 'pass', summary: '1 checked', findings: [] },
        { name: 'drift', state: 'not_established', summary: 'no lockfile', findings: [] },
        { name: 'health', state: 'pass', summary: 'fine', findings: [] }
      ]
    });
    expect(jobSummary(partial)).not.toContain('Nothing you trusted has changed.');
    expect(jobSummary(partial)).toContain('not the same as clean');
  });

  test('annotation payloads escape the characters that would end the directive early', () => {
    // A newline or a colon spliced into `::error title=...::` truncates the
    // annotation, which is how a finding silently stops appearing on the PR.
    const report = base({
      ok: false,
      failed: ['advisories'],
      checks: [
        {
          name: 'advisories',
          state: 'fail',
          summary: 'bad',
          findings: [
            { title: 'CVE: nasty, thing', detail: 'line one\nline two', where: 'a/b.json' }
          ]
        }
      ]
    });

    const [line] = annotationsFor(report);
    expect(line).toContain('%3A');
    expect(line).toContain('%2C');
    expect(line).toContain('%0A');
    expect(line.split('\n')).toHaveLength(1);
  });
});
