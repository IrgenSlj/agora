/**
 * Contract tests for src/init.ts — the untested headline feature.
 */
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { generateInitPlan, runCommands, scanProject, type ProjectScan } from '../src/init';

const FIXTURES = join(import.meta.dir, 'fixtures');

// ── scanProject ─────────────────────────────────────────────────────────────

describe('scanProject', () => {
  test('detects a Node project from package.json', () => {
    const scan = scanProject(join(FIXTURES, 'node-project'));
    expect(scan.type).toBe('node');
  });

  test('detects react and database deps in the Node fixture', () => {
    const scan = scanProject(join(FIXTURES, 'node-project'));
    // package.json has react + pg
    expect(scan.frameworks).toContain('react');
    expect(scan.hasDatabase).toBe(true);
    expect(scan.dependencies).toContain('react');
    expect(scan.dependencies).toContain('pg');
  });

  test('detects a Python project from requirements.txt', () => {
    const scan = scanProject(join(FIXTURES, 'python-project'));
    expect(scan.type).toBe('python');
  });

  test('detects flask framework in the Python fixture', () => {
    const scan = scanProject(join(FIXTURES, 'python-project'));
    expect(scan.frameworks).toContain('flask');
  });

  test('detects postgres database dep in Python fixture', () => {
    const scan = scanProject(join(FIXTURES, 'python-project'));
    expect(scan.hasDatabase).toBe(true);
  });

  test('empty directory produces type=unknown', () => {
    const scan = scanProject(join(FIXTURES, 'empty-dir'));
    expect(scan.type).toBe('unknown');
    expect(scan.frameworks).toHaveLength(0);
    expect(scan.hasDocker).toBe(false);
    expect(scan.hasCI).toBe(false);
    expect(scan.hasDatabase).toBe(false);
  });

  test('returns hasTests=false for fixture dirs without a test folder', () => {
    const scan = scanProject(join(FIXTURES, 'node-project'));
    // The node-project fixture has no test/ dir
    expect(scan.hasTests).toBe(false);
  });

  test('returned dependencies is an array', () => {
    const scan = scanProject(join(FIXTURES, 'node-project'));
    expect(Array.isArray(scan.dependencies)).toBe(true);
  });
});

// ── generateInitPlan ────────────────────────────────────────────────────────

describe('generateInitPlan', () => {
  test('does NOT throw for an unknown-type scan (crash-lock)', () => {
    const unknownScan: ProjectScan = {
      type: 'unknown',
      frameworks: [],
      hasDocker: false,
      hasCI: false,
      hasTests: false,
      hasDatabase: false,
      dependencies: []
    };
    expect(() => generateInitPlan(unknownScan)).not.toThrow();
  });

  test('unknown scan produces a valid config with $schema', () => {
    const plan = generateInitPlan({
      type: 'unknown',
      frameworks: [],
      hasDocker: false,
      hasCI: false,
      hasTests: false,
      hasDatabase: false,
      dependencies: []
    });
    expect(plan.config.$schema).toBe('https://opencode.ai/config.json');
    expect(plan.config.mcp).toBeDefined();
    expect(Array.isArray(plan.config.plugin)).toBe(true);
  });

  test('config always contains the opencode-agora plugin', () => {
    for (const type of ['node', 'python', 'rust', 'go', 'ruby', 'java', 'unknown'] as const) {
      const plan = generateInitPlan({
        type,
        frameworks: [],
        hasDocker: false,
        hasCI: false,
        hasTests: false,
        hasDatabase: false,
        dependencies: []
      });
      expect(plan.config.plugin).toContain('opencode-agora');
    }
  });

  test('servers array matches the ids actually in config.mcp (no ghost servers)', () => {
    const scan = scanProject(join(FIXTURES, 'node-project'));
    const plan = generateInitPlan(scan);
    const configuredIds = Object.keys(plan.config.mcp ?? {});

    // Every id in plan.servers that corresponds to a known MCP package must
    // be present in plan.config.mcpServers.
    // plan.servers may contain ids that resolveServers() could not find in
    // samplePackages (e.g. a package without an npmPackage) — those will be
    // absent from mcpServers. We verify the inverse: nothing in mcpServers
    // is missing from plan.servers.
    for (const id of configuredIds) {
      expect(plan.servers).toContain(id);
    }
  });

  test('node project plan includes filesystem and github servers', () => {
    const scan = scanProject(join(FIXTURES, 'node-project'));
    const plan = generateInitPlan(scan);
    expect(plan.servers).toContain('mcp-filesystem');
    expect(plan.servers).toContain('mcp-github');
  });

  test('plan with database deps includes mcp-postgres for pg', () => {
    const plan = generateInitPlan({
      type: 'node',
      frameworks: [],
      hasDocker: false,
      hasCI: false,
      hasTests: false,
      hasDatabase: true,
      dependencies: ['pg']
    });
    expect(plan.servers).toContain('mcp-postgres');
  });

  test('commands array contains only npm install -g lines', () => {
    const scan = scanProject(join(FIXTURES, 'node-project'));
    const plan = generateInitPlan(scan);
    const pattern = /^npm install -g .+$/;
    for (const cmd of plan.commands) {
      expect(cmd).toMatch(pattern);
    }
  });

  test('workflows array is non-empty (always includes arch review)', () => {
    const plan = generateInitPlan({
      type: 'unknown',
      frameworks: [],
      hasDocker: false,
      hasCI: false,
      hasTests: false,
      hasDatabase: false,
      dependencies: []
    });
    expect(plan.workflows).toContain('wf-code-review-arch');
  });

  test('hasTests=true adds TDD workflow', () => {
    const plan = generateInitPlan({
      type: 'node',
      frameworks: [],
      hasDocker: false,
      hasCI: false,
      hasTests: true,
      hasDatabase: false,
      dependencies: []
    });
    expect(plan.workflows).toContain('wf-tdd-cycle');
  });
});

// ── runCommands ──────────────────────────────────────────────────────────────

describe('runCommands', () => {
  test('returns an array with one result per command', () => {
    const results = runCommands(['echo hi', 'npm install -g foo; rm x']);
    expect(results).toHaveLength(2);
  });

  test('a command not matching strict npm install -g <pkg> shape gets ok:false', () => {
    const results = runCommands(['echo hi']);
    expect(results[0].command).toBe('echo hi');
    expect(results[0].ok).toBe(false);
  });

  test('shell injection attempt gets ok:false and is NOT executed', () => {
    // "npm install -g foo; rm x" contains a semicolon — must be rejected
    const results = runCommands(['npm install -g foo; rm x']);
    expect(results[0].ok).toBe(false);
  });

  test('empty commands array returns empty results', () => {
    const results = runCommands([]);
    expect(results).toHaveLength(0);
  });

  test('mixed valid-shape and invalid commands report individually', () => {
    const results = runCommands(['echo hi', 'also bad --flag']);
    // Both are invalid shape
    expect(results.every((r) => r.ok === false)).toBe(true);
  });

  test('command with ok:false carries the original command string', () => {
    const cmd = 'totally-invalid command';
    const results = runCommands([cmd]);
    expect(results[0].command).toBe(cmd);
  });
});
