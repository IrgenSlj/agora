import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { evaluatePolicy, isConclusive, lintPolicyText, loadPolicies } from '../../policy/engine.js';
import { checkRevocations } from '../../revocation/client.js';
import { installedPurls } from '../../revocation/installed.js';
import { manifestPath, readManifest } from '../../stack/manifest.js';
import { readAllServers } from '../../stack/registry.js';
import { ExitCode } from '../exit-codes.js';
import { detectDataDir, usageError, writeJson, writeLine } from '../helpers.js';
import { cliTheme } from '../theme.js';
import type { CommandHandler } from './types.js';

const SCAFFOLD = `// Project policy for agora. Evaluated on top of the shipped baseline
// (which already forbids revoked artifacts, tripped canaries, and installing
// something whose evidence critically contradicts its claims).
//
// A project file can only ever make the baseline STRICTER: Cedar is
// order-independent and any forbid beats every permit.
//
// IMPORTANT: guard every optional attribute with \`has\`. Cedar skips a policy
// that reads a missing attribute and returns the remaining decision, so an
// unguarded forbid silently evaluates to ALLOW — a rule that looks like
// protection and is not. \`agora policy check\` catches this.

// Example: refuse anything that declares no permission manifest at all.
// forbid (principal, action, resource)
// when { resource.permissions_declared == false };

// Example: require verified provenance before installing.
// forbid (principal, action == Action::"Install", resource)
// unless { resource has provenance_verified && resource.provenance_verified };

// Example: refuse servers that declare the ability to execute binaries.
// forbid (principal, action, resource)
// when { resource has exec && resource.exec };
`;

/**
 * Display label for a policy source. The shipped baseline lives inside the
 * installed package, so a path relative to the user's cwd is a meaningless
 * pile of `../` — name it instead.
 */
function policyLabel(path: string, cwd: string): string {
  return path.includes(`${'policy'}/defaults/baseline.cedar`)
    ? 'baseline (shipped)'
    : relative(cwd, path);
}

function policyFilesFrom(io: { cwd?: string; env?: Record<string, string | undefined> }): string[] {
  const manifest = readManifest(manifestPath({ cwd: io.cwd, env: io.env }));
  return manifest?.policy?.files ?? [];
}

export const commandPolicy: CommandHandler = async (parsed, io, style) => {
  const sub = parsed.args[0];
  const theme = cliTheme(style, io);
  const cwd = io.cwd ?? process.cwd();

  if (!sub || sub === 'help') {
    writeLine(io.stdout, 'Usage: agora policy <init|check|test> [--json] [--ci]');
    writeLine(io.stdout, '');
    writeLine(io.stdout, '  init   scaffold a project policy file and register it in agora.toml');
    writeLine(io.stdout, '  check  lint policy files, then evaluate every installed server');
    writeLine(io.stdout, '  test   evaluate the policy set against built-in fixture artifacts');
    return sub ? ExitCode.OK : ExitCode.USAGE;
  }

  // ── init ────────────────────────────────────────────────────────────────
  if (sub === 'init') {
    const target = join(cwd, 'policies', 'team.cedar');
    if (existsSync(target)) {
      return usageError(io, `${relative(cwd, target)} already exists`);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, SCAFFOLD, 'utf8');

    writeLine(io.stdout, `Created ${theme.accent(relative(cwd, target))}`);
    writeLine(io.stdout, '');
    writeLine(io.stdout, 'Register it by adding to agora.toml:');
    writeLine(io.stdout, theme.dim('  [policy]'));
    writeLine(io.stdout, theme.dim('  files = ["policies/team.cedar"]'));
    writeLine(io.stdout, '');
    writeLine(io.stdout, theme.dim('Then run `agora policy check`.'));
    return ExitCode.OK;
  }

  // ── check ───────────────────────────────────────────────────────────────
  if (sub === 'check') {
    const files = policyFilesFrom(io);
    const sources = loadPolicies(files, cwd);
    const ci = parsed.flags.ci === true;

    // 1. Lint every source. A rule that cannot fire is the failure mode this
    //    whole plane exists to prevent, so linting comes before evaluating.
    const lintFailures: Array<{ path: string; problems: string[] }> = [];
    for (const source of sources) {
      const lint = await lintPolicyText(source.text);
      if (!lint.ok) {
        lintFailures.push({
          path: policyLabel(source.path, cwd),
          problems: [...lint.errors, ...lint.schemaViolations]
        });
      }
    }

    // 2. Evaluate every installed server against the policy set.
    const dataDir = detectDataDir(parsed, io);
    const servers = readAllServers({ cwd: io.cwd, home: io.env?.HOME, env: io.env });
    const addressed = installedPurls(servers);
    const revocations = checkRevocations(
      dataDir,
      addressed.addressable.map((a) => a.purl)
    );
    const revokedPurls = new Set(revocations.matches.map((m) => m.purl));

    const rows: Array<{
      name: string;
      purl: string;
      decision: string;
      conclusive: boolean;
      determining: string[];
    }> = [];

    for (const { server, purl } of addressed.addressable) {
      const decision = await evaluatePolicy({
        purl,
        action: 'Sync',
        policyFiles: files,
        cwd,
        revoked: revocations.unknown ? undefined : revokedPurls.has(purl)
      });
      rows.push({
        name: server.name,
        purl,
        decision: decision.decision,
        conclusive: isConclusive(decision),
        determining: decision.determining
      });
    }

    if (parsed.flags.json) {
      writeJson(io.stdout, {
        policyFiles: sources.map((s) => policyLabel(s.path, cwd)),
        lintFailures,
        uncheckable: addressed.unaddressable.map((s) => s.name),
        revocationFeedKnown: !revocations.unknown,
        results: rows
      });
      return lintFailures.length > 0 || rows.some((r) => r.decision === 'deny')
        ? ExitCode.POLICY_FORBID
        : ExitCode.OK;
    }

    writeLine(io.stdout, theme.bold('Policy files'));
    for (const source of sources) {
      const label = policyLabel(source.path, cwd);
      const failed = lintFailures.find((f) => f.path === label);
      const glyph = failed ? theme.error('✗') : theme.success('✓');
      writeLine(io.stdout, `  ${glyph}  ${label}`);
      for (const problem of failed?.problems ?? []) {
        writeLine(io.stdout, `       ${theme.dim(problem)}`);
      }
    }
    writeLine(io.stdout, '');

    if (rows.length === 0) {
      writeLine(io.stdout, theme.muted('No addressable servers installed.'));
    } else {
      writeLine(io.stdout, theme.bold('Decisions'));
      for (const row of rows) {
        const glyph = row.decision === 'deny' ? theme.error('deny ') : theme.success('allow');
        // An allow reached with rules switched off is not a clean allow.
        const caveat = row.conclusive ? '' : theme.warning('  (inconclusive — a rule was skipped)');
        writeLine(io.stdout, `  ${glyph}  ${row.name}${caveat}`);
        writeLine(io.stdout, `         ${theme.dim(row.purl)}`);
      }
    }

    if (addressed.unaddressable.length > 0) {
      writeLine(io.stdout, '');
      writeLine(
        io.stdout,
        theme.muted(
          `${addressed.unaddressable.length} server(s) have no purl and were not evaluated (remote or non-npm launcher)`
        )
      );
    }
    if (revocations.unknown) {
      writeLine(
        io.stdout,
        theme.muted(
          'No revocation feed cached — revocation status was left unknown, not assumed clean'
        )
      );
    }

    const denied = rows.filter((r) => r.decision === 'deny').length;
    const inconclusive = rows.filter((r) => !r.conclusive).length;
    writeLine(io.stdout, '');
    writeLine(
      io.stdout,
      `${theme.success(`allow: ${rows.length - denied}`)}  ${theme.error(`deny: ${denied}`)}  ${theme.warning(`inconclusive: ${inconclusive}`)}`
    );

    if (lintFailures.length > 0 || denied > 0) return ExitCode.POLICY_FORBID;
    // --ci is stricter: an inconclusive result is not a pass in automation,
    // where nobody is reading the caveat.
    if (ci && inconclusive > 0) return ExitCode.POLICY_FORBID;
    return ExitCode.OK;
  }

  // ── test ────────────────────────────────────────────────────────────────
  if (sub === 'test') {
    const files = policyFilesFrom(io);
    const fixtures: Array<{
      label: string;
      expect: 'allow' | 'deny';
      input: Parameters<typeof evaluatePolicy>[0];
    }> = [
      {
        label: 'clean artifact',
        expect: 'allow',
        input: { purl: 'pkg:npm/clean@1.0.0', policyFiles: files, cwd }
      },
      {
        label: 'revoked artifact',
        expect: 'deny',
        input: { purl: 'pkg:npm/revoked@1.0.0', policyFiles: files, cwd, revoked: true }
      },
      {
        label: 'critical divergence on install',
        expect: 'deny',
        input: {
          purl: 'pkg:npm/diverged@1.0.0',
          policyFiles: files,
          cwd,
          action: 'Install',
          scan: { id: 'x', itemKind: 'package', checks: [], summary: { pass: 0, warn: 0, fail: 1 } }
        }
      }
    ];

    let failures = 0;
    const results = [];
    for (const fixture of fixtures) {
      const decision = await evaluatePolicy(fixture.input);
      const ok = decision.decision === fixture.expect;
      if (!ok) failures++;
      results.push({ label: fixture.label, expected: fixture.expect, got: decision.decision, ok });
      if (!parsed.flags.json) {
        const glyph = ok ? theme.success('✓') : theme.error('✗');
        writeLine(
          io.stdout,
          `  ${glyph}  ${fixture.label} ${theme.dim(`expected ${fixture.expect}, got ${decision.decision}`)}`
        );
      }
    }

    if (parsed.flags.json) writeJson(io.stdout, { results, failures });
    return failures > 0 ? ExitCode.POLICY_FORBID : ExitCode.OK;
  }

  return usageError(io, `Unknown policy subcommand: ${sub}`);
};
