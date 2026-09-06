import { describe, expect, test } from 'vitest';
import {
  type DecisionContext,
  decidePreToolUse,
  renderDecision,
  serverFromToolName
} from '../src/hook/pretooluse';
import type { RevocationStatus } from '../src/revocation/client';
import type { ConfiguredServer } from '../src/stack/types';

// The hook is the only place Agora stops something rather than reporting it,
// which makes its restraint the part worth testing hardest. Two properties
// carry most of the weight: it never grants a permission, and it never blocks
// on its own failure.

const server = (name: string): ConfiguredServer => ({
  name,
  tool: 'claude-code',
  scope: 'project',
  configPath: '/tmp/.mcp.json',
  transport: 'local',
  command: ['npx', '-y', `${name}-mcp@1.0.0`],
  enabled: true,
  raw: {}
});

const clean: RevocationStatus = { matches: [], blocked: false, unknown: false, stale: false };

function ctx(over: Partial<DecisionContext> = {}): DecisionContext {
  return {
    servers: [server('filesystem')],
    revocations: () => clean,
    driftBlocks: () => [],
    purlsFor: () => ['pkg:npm/filesystem-mcp@1.0.0'],
    ...over
  };
}

function revoked(over: Partial<RevocationStatus['matches'][0]['entry']> = {}): RevocationStatus {
  return {
    matches: [
      {
        purl: 'pkg:npm/filesystem-mcp@1.0.0',
        confirmed: true,
        entry: {
          id: 'MAL-2026-1',
          purl_pattern: 'pkg:npm/filesystem-mcp',
          reason: 'malicious-package',
          severity: 'critical',
          refs: ['https://osv.dev/vulnerability/MAL-2026-1'],
          added_at: '2026-09-01T00:00:00.000Z',
          ...over
        }
      }
    ],
    blocked: true,
    unknown: false,
    stale: false
  } as RevocationStatus;
}

describe('serverFromToolName', () => {
  test('extracts the server from an MCP tool name', () => {
    expect(serverFromToolName('mcp__filesystem__read_file')).toBe('filesystem');
  });

  test('a single underscore inside either half is not a separator', () => {
    // The separator is `__`. `mcp__plugin_my-plugin_db__query` is one server
    // named `plugin_my-plugin_db`, not three fragments.
    expect(serverFromToolName('mcp__plugin_my-plugin_db__query')).toBe('plugin_my-plugin_db');
    expect(serverFromToolName('mcp__memory__create_entities')).toBe('memory');
  });

  test('a tool name containing __ does not leak into the server name', () => {
    expect(serverFromToolName('mcp__memory__weird__tool')).toBe('memory');
  });

  test('anything that is not an MCP tool has no server', () => {
    expect(serverFromToolName('Bash')).toBeUndefined();
    expect(serverFromToolName('Edit')).toBeUndefined();
    expect(serverFromToolName('mcp__incomplete')).toBeUndefined();
    expect(serverFromToolName('mcp____empty')).toBeUndefined();
    expect(serverFromToolName(undefined)).toBeUndefined();
  });
});

describe('decidePreToolUse', () => {
  test('has no opinion about a non-MCP tool', () => {
    const d = decidePreToolUse({ tool_name: 'Bash' }, ctx());
    expect(d.kind).toBe('no-opinion');
  });

  test('never returns allow for a server it has nothing against', () => {
    // The rule that matters most. `permissionDecision: "allow"` bypasses Claude
    // Code's own permission prompt, and "no known red flags" is not a
    // permission the user granted. Silence lets the normal flow happen.
    const d = decidePreToolUse({ tool_name: 'mcp__filesystem__read_file' }, ctx());
    expect(d.kind).toBe('no-opinion');
    expect(renderDecision(d)).toBeNull();
  });

  test('denies a revoked server and says what and where', () => {
    const d = decidePreToolUse(
      { tool_name: 'mcp__filesystem__read_file' },
      ctx({ revocations: () => revoked() })
    );

    expect(d.kind).toBe('deny');
    if (d.kind !== 'deny') return;
    expect(d.reason).toContain('filesystem');
    expect(d.reason).toContain('malicious-package');
    expect(d.reason).toContain('MAL-2026-1');
    // A verdict a human cannot check is an accusation. The reference travels.
    expect(d.reason).toContain('https://osv.dev/vulnerability/MAL-2026-1');
  });

  test('carries the advisory sentence into the block when there is one', () => {
    const d = decidePreToolUse(
      { tool_name: 'mcp__filesystem__read_file' },
      ctx({ revocations: () => revoked({ summary: 'BCCs every processed email' }) })
    );
    expect(d.kind === 'deny' && d.reason).toContain('BCCs every processed email');
  });

  test('a non-blocking advisory does not stop the call', () => {
    // `advisory` severity means report, not block. Blocking on it would train
    // people to disable the hook, which costs them the criticals too.
    const advisory: RevocationStatus = { ...revoked({ severity: 'advisory' }), blocked: false };
    const d = decidePreToolUse(
      { tool_name: 'mcp__filesystem__read_file' },
      ctx({ revocations: () => advisory })
    );
    expect(d.kind).toBe('no-opinion');
  });

  test('denies a drifted server with the rug-pull framing', () => {
    const d = decidePreToolUse(
      { tool_name: 'mcp__filesystem__read_file' },
      ctx({
        driftBlocks: () => [
          {
            name: 'filesystem',
            key: 'k',
            reason: 'description-drift',
            detail: '2 tool descriptions changed'
          }
        ]
      })
    );

    expect(d.kind).toBe('deny');
    if (d.kind !== 'deny') return;
    expect(d.reason).toContain('no longer matches what was approved');
    expect(d.reason).toContain('agora approve filesystem');
  });

  test('a quarantined server is told it was the user’s own decision', () => {
    // Quarantine and drift both stop the call and are not the same event.
    // Telling someone their own decision looks like a detection is how a tool
    // makes itself feel unpredictable.
    const d = decidePreToolUse(
      { tool_name: 'mcp__filesystem__read_file' },
      ctx({
        driftBlocks: () => [
          { name: 'filesystem', key: 'k', reason: 'quarantined', detail: 'quarantined by you' }
        ]
      })
    );

    expect(d.kind === 'deny' && d.reason).toContain('You put it here');
    expect(d.kind === 'deny' && d.reason).toContain('agora unquarantine filesystem');
  });

  test('revocation is reported ahead of drift when both apply', () => {
    // "The package is malware" is more actionable than "its schema changed".
    const d = decidePreToolUse(
      { tool_name: 'mcp__filesystem__read_file' },
      ctx({
        revocations: () => revoked(),
        driftBlocks: () => [
          { name: 'filesystem', key: 'k', reason: 'description-drift', detail: 'changed' }
        ]
      })
    );
    expect(d.kind === 'deny' && d.reason).toContain('malicious-package');
  });

  test('a server Agora cannot see is a note, never a block', () => {
    // Blocking what we failed to enumerate would make every host we do not read
    // a broken one. It is still worth saying out loud.
    const d = decidePreToolUse({ tool_name: 'mcp__unknown__do_thing' }, ctx());
    expect(d.kind).toBe('no-opinion');
    expect(d.kind === 'no-opinion' && d.note).toContain('not in any configuration');
  });

  test('a server with no resolvable purl is not blocked for being unidentifiable', () => {
    // Remote servers have no npm identity. "I cannot name it" is not "it is
    // bad", and the revocation lookup is skipped rather than run on nothing.
    let asked = false;
    const d = decidePreToolUse(
      { tool_name: 'mcp__filesystem__read_file' },
      ctx({
        purlsFor: () => [],
        revocations: () => {
          asked = true;
          return clean;
        }
      })
    );
    expect(d.kind).toBe('no-opinion');
    expect(asked).toBe(false);
  });
});

describe('renderDecision', () => {
  test('emits the deny shape Claude Code reads', () => {
    const out = renderDecision({ kind: 'deny', reason: 'because' })!;
    expect(JSON.parse(out)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'because'
      }
    });
  });

  test('emits nothing at all for no-opinion', () => {
    // Not `{"permissionDecision":"allow"}`. Printing nothing is the documented
    // way to say "no decision", and it leaves the user's own permission prompt
    // exactly where it was.
    expect(renderDecision({ kind: 'no-opinion' })).toBeNull();
    expect(renderDecision({ kind: 'no-opinion', note: 'something' })).toBeNull();
  });
});
