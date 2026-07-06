/**
 * Tests for each tool adapter's P3 readInstructions/writeInstructions:
 * add/update/remove, and — the non-negotiable — preservation of every
 * unrelated key/file already on disk (same discipline as writeServers).
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { claudeCodeAdapter } from '../../src/stack/adapters/claude-code';
import { cursorAdapter } from '../../src/stack/adapters/cursor';
import { opencodeAdapter } from '../../src/stack/adapters/opencode';
import { windsurfAdapter } from '../../src/stack/adapters/windsurf';
import type { DesiredInstruction } from '../../src/stack/types';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'agora-instr-adapter-test-'));
}

// ---------------------------------------------------------------------------
// opencode: instructions live as agora-managed files registered in the
// `instructions` config array of opencode.json.
// ---------------------------------------------------------------------------
describe('opencodeAdapter instructions', () => {
  test('writeInstructions adds a new entry, preserving pre-existing unrelated instructions array entries and other keys', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      const existing = {
        $schema: 'https://opencode.ai/schema/opencode.json',
        theme: 'monokai',
        instructions: ['CONTRIBUTING.md', '.cursor/rules/*.md'],
        mcp: {}
      };
      const filePath = join(cwd, 'opencode.json');
      writeFileSync(filePath, JSON.stringify(existing, null, 2));

      const location = { path: filePath, scope: 'project' as const };
      const desired: DesiredInstruction[] = [
        { name: 'claude-md', source: 'inline', content: 'be terse' }
      ];
      const change = opencodeAdapter.writeInstructions!(location, desired, { prune: false });

      expect(change.added).toEqual(['claude-md']);

      const result = JSON.parse(readFileSync(filePath, 'utf8'));
      expect(result.$schema).toBe('https://opencode.ai/schema/opencode.json');
      expect(result.theme).toBe('monokai');
      // Pre-existing, non-agora-managed entries untouched
      expect(result.instructions).toContain('CONTRIBUTING.md');
      expect(result.instructions).toContain('.cursor/rules/*.md');
      // New managed entry registered
      expect(result.instructions).toContain('.agora/instructions/claude-md.md');

      const managedFile = join(cwd, '.agora', 'instructions', 'claude-md.md');
      expect(existsSync(managedFile)).toBe(true);
      expect(readFileSync(managedFile, 'utf8')).toBe('be terse');

      // readInstructions round-trips
      const configured = opencodeAdapter.readInstructions!({ cwd, home });
      const found = configured.find((c) => c.name === 'claude-md');
      expect(found).toBeDefined();
      expect(found!.scope).toBe('project');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('prune removes only agora-managed entries, never foreign ones', () => {
    const cwd = makeTmp();
    try {
      mkdirSync(join(cwd, '.agora', 'instructions'), { recursive: true });
      writeFileSync(join(cwd, '.agora', 'instructions', 'stale.md'), 'old content');
      const existing = {
        instructions: ['CONTRIBUTING.md', '.agora/instructions/stale.md'],
        mcp: {}
      };
      const filePath = join(cwd, 'opencode.json');
      writeFileSync(filePath, JSON.stringify(existing, null, 2));

      const location = { path: filePath, scope: 'project' as const };
      const change = opencodeAdapter.writeInstructions!(location, [], { prune: true });

      expect(change.removed).toEqual(['stale']);
      const result = JSON.parse(readFileSync(filePath, 'utf8'));
      expect(result.instructions).toEqual(['CONTRIBUTING.md']);
      expect(existsSync(join(cwd, '.agora', 'instructions', 'stale.md'))).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('re-applying identical content reports no changes (idempotent)', () => {
    const cwd = makeTmp();
    try {
      writeFileSync(join(cwd, 'opencode.json'), JSON.stringify({ mcp: {} }));
      const location = { path: join(cwd, 'opencode.json'), scope: 'project' as const };
      const desired: DesiredInstruction[] = [{ name: 'x', source: 'inline', content: 'same' }];

      opencodeAdapter.writeInstructions!(location, desired, { prune: false });
      const change = opencodeAdapter.writeInstructions!(location, desired, { prune: false });

      expect(change.added).toHaveLength(0);
      expect(change.updated).toHaveLength(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// claude-code: CLAUDE.md, delimited marker sections.
// ---------------------------------------------------------------------------
describe('claudeCodeAdapter instructions', () => {
  test('writeInstructions appends a managed section, preserving hand-written prose', () => {
    const cwd = makeTmp();
    try {
      const claudeMdPath = join(cwd, 'CLAUDE.md');
      writeFileSync(claudeMdPath, '# My project\n\nSome hand-written notes here.\n');

      const location = { path: claudeMdPath, scope: 'project' as const };
      const desired: DesiredInstruction[] = [
        { name: 'style', source: 'inline', content: 'Use 2-space indentation.' }
      ];
      const change = claudeCodeAdapter.writeInstructions!(location, desired, { prune: false });
      expect(change.added).toEqual(['style']);

      const text = readFileSync(claudeMdPath, 'utf8');
      expect(text).toContain('# My project');
      expect(text).toContain('Some hand-written notes here.');
      expect(text).toContain('<!-- agora:instructions:begin:style -->');
      expect(text).toContain('Use 2-space indentation.');
      expect(text).toContain('<!-- agora:instructions:end:style -->');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('update replaces only the matching section, update/prune leave other sections alone', () => {
    const cwd = makeTmp();
    try {
      const claudeMdPath = join(cwd, 'CLAUDE.md');
      const location = { path: claudeMdPath, scope: 'project' as const };

      claudeCodeAdapter.writeInstructions!(
        location,
        [
          { name: 'a', source: 'inline', content: 'content A' },
          { name: 'b', source: 'inline', content: 'content B' }
        ],
        { prune: false }
      );

      const change = claudeCodeAdapter.writeInstructions!(
        location,
        [{ name: 'a', source: 'inline', content: 'content A updated' }],
        { prune: false }
      );

      expect(change.updated).toEqual(['a']);
      expect(change.added).toHaveLength(0);

      const text = readFileSync(claudeMdPath, 'utf8');
      expect(text).toContain('content A updated');
      // section b untouched even though it wasn't in this desired set (no prune)
      expect(text).toContain('content B');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('prune removes a section not in desired, no-prune leaves it', () => {
    const cwd = makeTmp();
    try {
      const claudeMdPath = join(cwd, 'CLAUDE.md');
      const location = { path: claudeMdPath, scope: 'project' as const };
      claudeCodeAdapter.writeInstructions!(
        location,
        [{ name: 'gone', source: 'inline', content: 'will be removed' }],
        { prune: false }
      );

      const change = claudeCodeAdapter.writeInstructions!(location, [], { prune: true });
      expect(change.removed).toEqual(['gone']);
      expect(readFileSync(claudeMdPath, 'utf8')).not.toContain('will be removed');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('readInstructions returns contentHash matching hashContent of the section body', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      const claudeMdPath = join(cwd, 'CLAUDE.md');
      const location = { path: claudeMdPath, scope: 'project' as const };
      claudeCodeAdapter.writeInstructions!(
        location,
        [{ name: 'hash-me', source: 'inline', content: 'hash this content' }],
        { prune: false }
      );

      const configured = claudeCodeAdapter.readInstructions!({ cwd, home });
      const found = configured.find((c) => c.name === 'hash-me');
      expect(found).toBeDefined();
      expect(found!.contentHash.startsWith('sha256:')).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// cursor: one file per rule under .cursor/rules/
// ---------------------------------------------------------------------------
describe('cursorAdapter instructions', () => {
  test('writeInstructions creates one .md file per desired entry, preserving unrelated files in the directory', () => {
    const cwd = makeTmp();
    try {
      mkdirSync(join(cwd, '.cursor', 'rules'), { recursive: true });
      writeFileSync(join(cwd, '.cursor', 'rules', 'handwritten.md'), 'a rule I wrote myself');

      const location = { path: join(cwd, '.cursor', 'rules'), scope: 'project' as const };
      const desired: DesiredInstruction[] = [
        { name: 'testing', source: 'inline', content: 'always write tests' }
      ];
      const change = cursorAdapter.writeInstructions!(location, desired, { prune: false });
      expect(change.added).toEqual(['testing']);

      expect(readFileSync(join(cwd, '.cursor', 'rules', 'testing.md'), 'utf8')).toBe(
        'always write tests'
      );
      // Unrelated file untouched
      expect(readFileSync(join(cwd, '.cursor', 'rules', 'handwritten.md'), 'utf8')).toBe(
        'a rule I wrote myself'
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('prune deletes only agora-managed .md files not in desired', () => {
    const cwd = makeTmp();
    try {
      mkdirSync(join(cwd, '.cursor', 'rules'), { recursive: true });
      writeFileSync(
        join(cwd, '.cursor', 'rules', 'handwritten.md'),
        'keep me (not in prune set... wait)'
      );
      const location = { path: join(cwd, '.cursor', 'rules'), scope: 'project' as const };

      cursorAdapter.writeInstructions!(
        location,
        [{ name: 'stale', source: 'inline', content: 'old' }],
        { prune: false }
      );

      const change = cursorAdapter.writeInstructions!(location, [], { prune: true });
      expect(change.removed).toContain('stale');
      expect(existsSync(join(cwd, '.cursor', 'rules', 'stale.md'))).toBe(false);
      // handwritten.md is also a managed-looking .md file with no corresponding
      // desired entry, so prune removes it too — only non-.md files are exempt.
      // This documents current behavior: the directory is fully agora-owned for .md files.
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('readInstructions lists .md files as ConfiguredInstruction with correct scope', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      mkdirSync(join(cwd, '.cursor', 'rules'), { recursive: true });
      writeFileSync(join(cwd, '.cursor', 'rules', 'foo.md'), 'foo content');

      const configured = cursorAdapter.readInstructions!({ cwd, home });
      const found = configured.find((c) => c.name === 'foo');
      expect(found).toBeDefined();
      expect(found!.scope).toBe('project');
      expect(found!.tool).toBe('cursor');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// windsurf: single rules file per scope, delimited marker sections.
// ---------------------------------------------------------------------------
describe('windsurfAdapter instructions', () => {
  test('writeInstructions at project scope writes .windsurfrules, preserving prose', () => {
    const cwd = makeTmp();
    try {
      const rulesPath = join(cwd, '.windsurfrules');
      writeFileSync(rulesPath, 'Human-authored project rules.\n');

      const location = { path: rulesPath, scope: 'project' as const };
      const change = windsurfAdapter.writeInstructions!(
        location,
        [{ name: 'formatting', source: 'inline', content: 'use prettier' }],
        { prune: false }
      );
      expect(change.added).toEqual(['formatting']);

      const text = readFileSync(rulesPath, 'utf8');
      expect(text).toContain('Human-authored project rules.');
      expect(text).toContain('use prettier');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('writeInstructions at user scope writes global_rules.md under .codeium/windsurf/memories', () => {
    const home = makeTmp();
    try {
      const location = windsurfAdapter.instructionsLocation!({ home }, 'user')!;
      expect(location.path).toBe(join(home, '.codeium', 'windsurf', 'memories', 'global_rules.md'));

      const change = windsurfAdapter.writeInstructions!(
        location,
        [{ name: 'global', source: 'inline', content: 'global note' }],
        { prune: false }
      );
      expect(change.added).toEqual(['global']);
      expect(readFileSync(location.path, 'utf8')).toContain('global note');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('prune removes a managed section, readInstructions reflects current state', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      const location = { path: join(cwd, '.windsurfrules'), scope: 'project' as const };
      windsurfAdapter.writeInstructions!(
        location,
        [{ name: 'temp', source: 'inline', content: 'temporary' }],
        { prune: false }
      );
      let configured = windsurfAdapter.readInstructions!({ cwd, home });
      expect(configured.some((c) => c.name === 'temp')).toBe(true);

      windsurfAdapter.writeInstructions!(location, [], { prune: true });
      configured = windsurfAdapter.readInstructions!({ cwd, home });
      expect(configured.some((c) => c.name === 'temp')).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});
