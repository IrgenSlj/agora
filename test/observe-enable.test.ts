import { describe, expect, test } from 'vitest';
import { planObserve } from '../src/observe/enable';
import { isWrapped, unobservableReason, unwrapCommand, wrapCommand } from '../src/observe/wrap';
import type { ConfiguredServer } from '../src/stack/types';

function server(over: Partial<ConfiguredServer> & { name: string }): ConfiguredServer {
  return {
    tool: 'opencode',
    scope: 'user',
    configPath: '/tmp/opencode.json',
    transport: 'local',
    enabled: true,
    raw: {},
    ...over
  } as ConfiguredServer;
}

describe('wrapping is safe to run twice', () => {
  test('wrap is idempotent', () => {
    const once = wrapCommand(['npx', 'srv']);
    const twice = wrapCommand(once);
    expect(once).toEqual(['agora', 'run', '--', 'npx', 'srv']);
    // A user unsure whether `enable` worked will run it again. Double-wrapping
    // would produce `agora run -- agora run -- npx srv`, which still starts but
    // records a shim observing a shim.
    expect(twice).toEqual(once);
  });

  test('unwrap exactly inverts wrap, for every shape', () => {
    for (const cmd of [
      ['npx', 'srv'],
      ['node', '/abs/path/server.js', '--flag', 'value'],
      ['bun', 'x', '@scope/pkg@1.2.3'],
      ['single']
    ]) {
      expect(unwrapCommand(wrapCommand(cmd))).toEqual(cmd);
    }
  });

  test('unwrap leaves an unwrapped command alone', () => {
    expect(unwrapCommand(['npx', 'srv'])).toEqual(['npx', 'srv']);
  });

  test('recognises an absolute-path agora binary as wrapped', () => {
    // A host may rewrite `agora` to its resolved path; missing that would
    // double-wrap on the next enable.
    expect(isWrapped(['/usr/local/bin/agora', 'run', '--', 'npx', 'srv'])).toBe(true);
    expect(isWrapped(['C:\\bin\\agora', 'run', '--', 'npx', 'srv'])).toBe(true);
  });

  test('a server merely named agora is not mistaken for a wrapper', () => {
    expect(isWrapped(['agora-mcp', 'serve'])).toBe(false);
    expect(isWrapped(['agora', 'something-else'])).toBe(false);
  });
});

describe('what cannot be observed is skipped with a reason', () => {
  test('a remote server has no process to supervise', () => {
    expect(unobservableReason({ name: 'r', url: 'https://x.test/mcp' })).toContain('remote');
  });

  test('Agora never wraps itself', () => {
    // `agora run -- agora mcp` would recurse on every start.
    expect(unobservableReason({ name: 'agora', command: ['agora', 'mcp'] })).toContain('Agora');
  });

  test('an already-wrapped agora entry is not flagged as unobservable', () => {
    expect(
      unobservableReason({ name: 'x', command: ['agora', 'run', '--', 'npx', 'srv'] })
    ).toBeUndefined();
  });

  test('a server with no command cannot be wrapped', () => {
    expect(unobservableReason({ name: 'x', command: [] })).toContain('no launch command');
  });
});

describe('planObserve', () => {
  test('enable wraps observable servers and reports the rest', () => {
    const plan = planObserve(
      [
        server({ name: 'fs', command: ['npx', 'server-filesystem'] }),
        server({ name: 'remote', url: 'https://x.test/mcp', command: undefined }),
        server({ name: 'agora', command: ['agora', 'mcp'] }),
        server({ name: 'already', command: ['agora', 'run', '--', 'npx', 'pg'] })
      ],
      'enable'
    );

    expect(plan.changes.map((c) => c.name)).toEqual(['fs']);
    expect(plan.changes[0]!.after).toEqual(['agora', 'run', '--', 'npx', 'server-filesystem']);
    expect(plan.skipped.map((s) => s.name).sort()).toEqual(['agora', 'remote']);
    expect(plan.unchanged).toEqual(['already']);
  });

  test('disable unwraps only what is wrapped', () => {
    const plan = planObserve(
      [
        server({ name: 'wrapped', command: ['agora', 'run', '--', 'npx', 'a'] }),
        server({ name: 'plain', command: ['npx', 'b'] })
      ],
      'disable'
    );
    expect(plan.changes.map((c) => c.name)).toEqual(['wrapped']);
    expect(plan.changes[0]!.after).toEqual(['npx', 'a']);
    expect(plan.unchanged).toEqual(['plain']);
  });

  test('disable does not skip remote servers — they are simply unchanged', () => {
    // "Cannot be observed" is an enable-time question. Reporting a remote
    // server as skipped during disable would imply it needed disabling.
    const plan = planObserve(
      [server({ name: 'r', url: 'https://x.test', command: undefined })],
      'disable'
    );
    expect(plan.skipped).toEqual([]);
    expect(plan.unchanged).toEqual(['r']);
  });

  test('enable then disable returns every command to its original argv', () => {
    const original = [
      server({ name: 'a', command: ['npx', 'one'] }),
      server({ name: 'b', command: ['node', 'two.js', '--x'] })
    ];
    const enabled = planObserve(original, 'enable');
    const afterEnable = original.map((s) => {
      const change = enabled.changes.find((c) => c.name === s.name);
      return server({ ...s, command: change ? change.after : s.command });
    });
    const disabled = planObserve(afterEnable, 'disable');

    for (const s of original) {
      const restored = disabled.changes.find((c) => c.name === s.name)!.after;
      expect(restored, `${s.name} must round-trip exactly`).toEqual(s.command);
    }
  });
});
