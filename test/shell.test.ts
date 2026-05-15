import { describe, expect, test } from 'bun:test';
import { classifyInput, looksLikeQuestion } from '../src/cli/shell';

// Fake isExecutable predicates
const neverExecutable = (_name: string) => false;
const alwaysExecutable = (_name: string) => true;
const lsExecutable = (name: string) => name === 'ls';

describe('classifyInput', () => {
  test('empty string → noop', () => {
    expect(classifyInput('', neverExecutable)).toEqual({ kind: 'noop' });
  });

  test('whitespace only → noop', () => {
    expect(classifyInput('   ', neverExecutable)).toEqual({ kind: 'noop' });
  });

  test('/help → meta:help', () => {
    expect(classifyInput('/help', neverExecutable)).toEqual({ kind: 'meta', sub: 'help' });
  });

  test('/quit → meta:quit', () => {
    expect(classifyInput('/quit', neverExecutable)).toEqual({ kind: 'meta', sub: 'quit' });
  });

  test('/exit → meta:exit', () => {
    expect(classifyInput('/exit', neverExecutable)).toEqual({ kind: 'meta', sub: 'exit' });
  });

  test('/clear → meta:clear', () => {
    expect(classifyInput('/clear', neverExecutable)).toEqual({ kind: 'meta', sub: 'clear' });
  });

  test('/transcript → meta:transcript', () => {
    expect(classifyInput('/transcript', neverExecutable)).toEqual({
      kind: 'meta',
      sub: 'transcript'
    });
  });

  test('/menu → meta:menu', () => {
    expect(classifyInput('/menu', neverExecutable)).toEqual({ kind: 'meta', sub: 'menu' });
  });

  test('!ls -la → bash:ls -la', () => {
    expect(classifyInput('!ls -la', neverExecutable)).toEqual({ kind: 'bash', cmd: 'ls -la' });
  });

  test('?what is mcp → chat:what is mcp', () => {
    expect(classifyInput('?what is mcp', neverExecutable)).toEqual({
      kind: 'chat',
      msg: 'what is mcp'
    });
  });

  test('ls when ls is executable → bash:ls', () => {
    expect(classifyInput('ls', lsExecutable)).toEqual({ kind: 'bash', cmd: 'ls' });
  });

  test('ls with flags when ls is executable → bash', () => {
    expect(classifyInput('ls -la /tmp', lsExecutable)).toEqual({
      kind: 'bash',
      cmd: 'ls -la /tmp'
    });
  });

  test('what is mcp when first word not on PATH → chat', () => {
    expect(classifyInput('what is mcp', neverExecutable)).toEqual({
      kind: 'chat',
      msg: 'what is mcp'
    });
  });

  test('cd /tmp → bash (shell builtin)', () => {
    expect(classifyInput('cd /tmp', neverExecutable)).toEqual({ kind: 'bash', cmd: 'cd /tmp' });
  });

  test('export FOO=bar → bash (shell builtin)', () => {
    expect(classifyInput('export FOO=bar', neverExecutable)).toEqual({
      kind: 'bash',
      cmd: 'export FOO=bar'
    });
  });

  test('alias ll=ls → bash (shell builtin)', () => {
    expect(classifyInput('alias ll=ls', neverExecutable)).toEqual({
      kind: 'bash',
      cmd: 'alias ll=ls'
    });
  });

  test('source .env → bash (shell builtin)', () => {
    expect(classifyInput('source .env', neverExecutable)).toEqual({
      kind: 'bash',
      cmd: 'source .env'
    });
  });

  test('! override beats executable check', () => {
    // even if ls would be executable, ! prefix forces bash with the rest
    expect(classifyInput('!echo hello world', alwaysExecutable)).toEqual({
      kind: 'bash',
      cmd: 'echo hello world'
    });
  });

  test('? override beats executable check', () => {
    // first word might be on PATH but ? forces chat
    expect(classifyInput('?ls what does this command do', alwaysExecutable)).toEqual({
      kind: 'chat',
      msg: 'ls what does this command do'
    });
  });

  // looksLikeQuestion-driven dispatch
  test('what is mcp → chat (question starter)', () => {
    expect(classifyInput('what is mcp', neverExecutable)).toEqual({
      kind: 'chat',
      msg: 'what is mcp'
    });
  });

  test('ls files? → chat (trailing ?)', () => {
    expect(classifyInput('ls files?', lsExecutable)).toEqual({ kind: 'chat', msg: 'ls files?' });
  });

  test('How do I install foo → chat (uppercase + 3+ words)', () => {
    expect(classifyInput('How do I install foo', neverExecutable)).toEqual({
      kind: 'chat',
      msg: 'How do I install foo'
    });
  });

  test('Tell me about bun → chat (question starter)', () => {
    expect(classifyInput('Tell me about bun', neverExecutable)).toEqual({
      kind: 'chat',
      msg: 'Tell me about bun'
    });
  });

  test('ls alone → bash (single word, executable)', () => {
    expect(classifyInput('ls', lsExecutable)).toEqual({ kind: 'bash', cmd: 'ls' });
  });

  test('node should I use v22 or v24? → chat (trailing ?)', () => {
    const nodeExecutable = (name: string) => name === 'node';
    expect(classifyInput('node should I use v22 or v24?', nodeExecutable)).toEqual({
      kind: 'chat',
      msg: 'node should I use v22 or v24?'
    });
  });

  test('git status → bash (no question signals; first word on PATH)', () => {
    const gitExecutable = (name: string) => name === 'git';
    expect(classifyInput('git status', gitExecutable)).toEqual({ kind: 'bash', cmd: 'git status' });
  });

  test('empty → noop', () => {
    expect(classifyInput('', neverExecutable)).toEqual({ kind: 'noop' });
  });

  test('whitespace → noop', () => {
    expect(classifyInput('   ', neverExecutable)).toEqual({ kind: 'noop' });
  });

  // verbosity meta commands
  test('/verbose → meta:verbose', () => {
    expect(classifyInput('/verbose', neverExecutable)).toEqual({ kind: 'meta', sub: 'verbose' });
  });

  test('/quiet → meta:quiet', () => {
    expect(classifyInput('/quiet', neverExecutable)).toEqual({ kind: 'meta', sub: 'quiet' });
  });

  test('/medium → meta:medium', () => {
    expect(classifyInput('/medium', neverExecutable)).toEqual({ kind: 'meta', sub: 'medium' });
  });
});

describe('classifyInput — new power commands', () => {
  test('/last → meta:last', () => {
    expect(classifyInput('/last', neverExecutable)).toEqual({ kind: 'meta', sub: 'last' });
  });

  test('/again → meta:again', () => {
    expect(classifyInput('/again', neverExecutable)).toEqual({ kind: 'meta', sub: 'again' });
  });

  test('/? install foo → meta:dry-run with args', () => {
    expect(classifyInput('/? install foo', neverExecutable)).toEqual({
      kind: 'meta',
      sub: 'dry-run',
      args: 'install foo'
    });
  });

  test('/? browse mcp-github → meta:dry-run with args', () => {
    expect(classifyInput('/? browse mcp-github', neverExecutable)).toEqual({
      kind: 'meta',
      sub: 'dry-run',
      args: 'browse mcp-github'
    });
  });

  test('/? with no trailing text → chat (does not match /? prefix)', () => {
    // '/?' alone doesn't have a space after it, so falls through
    const r = classifyInput('/?', neverExecutable);
    // Not a meta dry-run since there's no space + args
    expect(r.kind).not.toBe('meta');
  });
});

describe('classifyInput — TUI slash shortcuts', () => {
  // The shell's `/tui` and per-page shortcuts (/home /market /comm /news
  // /settings) must short-circuit before the generic agora-CLI forwarding,
  // so they open the in-process TUI rather than spawning `agora home` as a
  // subprocess.

  test('/tui → tui dispatch with default page', () => {
    expect(classifyInput('/tui', neverExecutable)).toEqual({ kind: 'tui' });
  });

  test('/home → tui dispatch on home', () => {
    expect(classifyInput('/home', neverExecutable)).toEqual({ kind: 'tui', page: 'home' });
  });

  test('/market → tui dispatch on marketplace (short alias)', () => {
    expect(classifyInput('/market', neverExecutable)).toEqual({
      kind: 'tui',
      page: 'marketplace'
    });
  });

  test('/marketplace → tui dispatch on marketplace (full alias)', () => {
    expect(classifyInput('/marketplace', neverExecutable)).toEqual({
      kind: 'tui',
      page: 'marketplace'
    });
  });

  test('/comm and /community both → tui dispatch on community', () => {
    expect(classifyInput('/comm', neverExecutable)).toEqual({ kind: 'tui', page: 'community' });
    expect(classifyInput('/community', neverExecutable)).toEqual({
      kind: 'tui',
      page: 'community'
    });
  });

  test('/news → tui dispatch on news', () => {
    expect(classifyInput('/news', neverExecutable)).toEqual({ kind: 'tui', page: 'news' });
  });

  test('/settings → tui dispatch on settings', () => {
    expect(classifyInput('/settings', neverExecutable)).toEqual({ kind: 'tui', page: 'settings' });
  });

  test('/tui with trailing args falls through to CLI forwarding (no greedy match)', () => {
    expect(classifyInput('/tui foo', neverExecutable)).toEqual({
      kind: 'bash',
      cmd: 'agora tui foo'
    });
  });

  test('/search still forwards to agora search (TUI shortcuts do not absorb other slashes)', () => {
    expect(classifyInput('/search', neverExecutable)).toEqual({
      kind: 'bash',
      cmd: 'agora search'
    });
  });
});

describe('classifyInput — slash forwarding to agora CLI', () => {
  // Bug seen in the shell: `/agora help` fell through to bash because the
  // executable check resolved `/agora` against PATH (Node `path.join` strips
  // a leading slash on the second arg, so `/agora` matched the real binary).
  // Slash-prefixed inputs that aren't an exact meta match must route to the
  // `agora` CLI, never to bash.

  test('/agora help → bash: agora help', () => {
    expect(classifyInput('/agora help', alwaysExecutable)).toEqual({
      kind: 'bash',
      cmd: 'agora help'
    });
  });

  test('/agora help tutorials → bash: agora help tutorials', () => {
    expect(classifyInput('/agora help tutorials', alwaysExecutable)).toEqual({
      kind: 'bash',
      cmd: 'agora help tutorials'
    });
  });

  test('/agora alone → bash: agora help (no empty invocation)', () => {
    expect(classifyInput('/agora', alwaysExecutable)).toEqual({
      kind: 'bash',
      cmd: 'agora help'
    });
  });

  test('/help tutorials (slash-help with arg) → bash: agora help tutorials', () => {
    // /help exact match handled earlier; /help <arg> forwards to CLI.
    expect(classifyInput('/help tutorials', neverExecutable)).toEqual({
      kind: 'bash',
      cmd: 'agora help tutorials'
    });
  });

  test('/search filesystem → bash: agora search filesystem', () => {
    expect(classifyInput('/search filesystem', neverExecutable)).toEqual({
      kind: 'bash',
      cmd: 'agora search filesystem'
    });
  });

  test('/unknown-cmd → bash: agora unknown-cmd (CLI surfaces the error)', () => {
    expect(classifyInput('/unknown-cmd', neverExecutable)).toEqual({
      kind: 'bash',
      cmd: 'agora unknown-cmd'
    });
  });
});

// ── B.4 error-line helpers (pure logic extracted for testing) ─────────────────

describe('bash exit-code line', () => {
  function exitLine(code: number): string | null {
    if (code !== 0) return `· exit ${code}`;
    return null;
  }

  test('exit 0 produces null', () => {
    expect(exitLine(0)).toBeNull();
  });

  test('exit 1 produces dim line', () => {
    expect(exitLine(1)).toBe('· exit 1');
  });

  test('exit 127 produces dim line', () => {
    expect(exitLine(127)).toBe('· exit 127');
  });
});

describe('chat failure reason', () => {
  function chatReason(opts: { spawnError: boolean; errBuffer: string }): string {
    if (opts.spawnError) return 'opencode binary not found';
    if (opts.errBuffer.includes('Model not found')) {
      return '/model to pick another model (or check OPENCODE_MODEL)';
    }
    return 'chat failed; see /transcript for details';
  }

  test('spawn error → binary not found', () => {
    expect(chatReason({ spawnError: true, errBuffer: '' })).toBe('opencode binary not found');
  });

  test('Model not found in stderr → model suggestion', () => {
    expect(chatReason({ spawnError: false, errBuffer: 'Model not found: foo' })).toContain(
      '/model to pick another model'
    );
  });

  test('other stderr → generic message', () => {
    expect(chatReason({ spawnError: false, errBuffer: 'timeout' })).toBe(
      'chat failed; see /transcript for details'
    );
  });

  test('empty stderr → generic message', () => {
    expect(chatReason({ spawnError: false, errBuffer: '' })).toBe(
      'chat failed; see /transcript for details'
    );
  });
});

describe('looksLikeQuestion', () => {
  test('trailing ? returns true', () => {
    expect(looksLikeQuestion('ls files?')).toBe(true);
  });

  test('question starter returns true', () => {
    expect(looksLikeQuestion('what is mcp')).toBe(true);
  });

  test('uppercase first word + 3 words returns true', () => {
    expect(looksLikeQuestion('How do I')).toBe(true);
  });

  test('single word no signals returns false', () => {
    expect(looksLikeQuestion('ls')).toBe(false);
  });

  test('two lowercase words not in starter set returns false', () => {
    expect(looksLikeQuestion('git status')).toBe(false);
  });

  test('empty returns false', () => {
    expect(looksLikeQuestion('')).toBe(false);
  });

  test('tell starter returns true', () => {
    expect(looksLikeQuestion('Tell me about bun')).toBe(true);
  });
});
