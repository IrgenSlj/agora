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
    expect(classifyInput('/transcript', neverExecutable)).toEqual({ kind: 'meta', sub: 'transcript' });
  });

  test('/menu → meta:menu', () => {
    expect(classifyInput('/menu', neverExecutable)).toEqual({ kind: 'meta', sub: 'menu' });
  });

  test('!ls -la → bash:ls -la', () => {
    expect(classifyInput('!ls -la', neverExecutable)).toEqual({ kind: 'bash', cmd: 'ls -la' });
  });

  test('?what is mcp → chat:what is mcp', () => {
    expect(classifyInput('?what is mcp', neverExecutable)).toEqual({ kind: 'chat', msg: 'what is mcp' });
  });

  test('ls when ls is executable → bash:ls', () => {
    expect(classifyInput('ls', lsExecutable)).toEqual({ kind: 'bash', cmd: 'ls' });
  });

  test('ls with flags when ls is executable → bash', () => {
    expect(classifyInput('ls -la /tmp', lsExecutable)).toEqual({ kind: 'bash', cmd: 'ls -la /tmp' });
  });

  test('what is mcp when first word not on PATH → chat', () => {
    expect(classifyInput('what is mcp', neverExecutable)).toEqual({ kind: 'chat', msg: 'what is mcp' });
  });

  test('cd /tmp → bash (shell builtin)', () => {
    expect(classifyInput('cd /tmp', neverExecutable)).toEqual({ kind: 'bash', cmd: 'cd /tmp' });
  });

  test('export FOO=bar → bash (shell builtin)', () => {
    expect(classifyInput('export FOO=bar', neverExecutable)).toEqual({ kind: 'bash', cmd: 'export FOO=bar' });
  });

  test('alias ll=ls → bash (shell builtin)', () => {
    expect(classifyInput('alias ll=ls', neverExecutable)).toEqual({ kind: 'bash', cmd: 'alias ll=ls' });
  });

  test('source .env → bash (shell builtin)', () => {
    expect(classifyInput('source .env', neverExecutable)).toEqual({ kind: 'bash', cmd: 'source .env' });
  });

  test('! override beats executable check', () => {
    // even if ls would be executable, ! prefix forces bash with the rest
    expect(classifyInput('!echo hello world', alwaysExecutable)).toEqual({ kind: 'bash', cmd: 'echo hello world' });
  });

  test('? override beats executable check', () => {
    // first word might be on PATH but ? forces chat
    expect(classifyInput('?ls what does this command do', alwaysExecutable)).toEqual({
      kind: 'chat',
      msg: 'ls what does this command do',
    });
  });

  // looksLikeQuestion-driven dispatch
  test('what is mcp → chat (question starter)', () => {
    expect(classifyInput('what is mcp', neverExecutable)).toEqual({ kind: 'chat', msg: 'what is mcp' });
  });

  test('ls files? → chat (trailing ?)', () => {
    expect(classifyInput('ls files?', lsExecutable)).toEqual({ kind: 'chat', msg: 'ls files?' });
  });

  test('How do I install foo → chat (uppercase + 3+ words)', () => {
    expect(classifyInput('How do I install foo', neverExecutable)).toEqual({ kind: 'chat', msg: 'How do I install foo' });
  });

  test('Tell me about bun → chat (question starter)', () => {
    expect(classifyInput('Tell me about bun', neverExecutable)).toEqual({ kind: 'chat', msg: 'Tell me about bun' });
  });

  test('ls alone → bash (single word, executable)', () => {
    expect(classifyInput('ls', lsExecutable)).toEqual({ kind: 'bash', cmd: 'ls' });
  });

  test('node should I use v22 or v24? → chat (trailing ?)', () => {
    const nodeExecutable = (name: string) => name === 'node';
    expect(classifyInput('node should I use v22 or v24?', nodeExecutable)).toEqual({
      kind: 'chat', msg: 'node should I use v22 or v24?',
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
