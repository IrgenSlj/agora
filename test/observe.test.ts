import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parseLsofHosts } from '../src/observe/connections';
import { calledToolName, createFrameTee, toolNamesFromResult } from '../src/observe/protocol';
import { runSupervised } from '../src/observe/run';
import { createSessionRecorder, readSessions } from '../src/observe/session';

/** A stand-in child process with controllable stdio. */
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdin: { written: Buffer[]; write(b: Buffer): void; end(): void };
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill(sig: string): void;
    killed: string[];
  };
  child.pid = 4242;
  const written: Buffer[] = [];
  child.stdin = { written, write: (b: Buffer) => void written.push(b), end: () => {} };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = [];
  child.kill = (sig: string) => void child.killed.push(sig);
  return child;
}

function collector() {
  const chunks: Buffer[] = [];
  return {
    stream: { write: (c: Buffer | string) => void chunks.push(Buffer.from(c)) },
    text: () => Buffer.concat(chunks).toString('utf8')
  };
}

describe('the shim is byte-transparent', () => {
  // The property everything else depends on. This shim sits in front of every
  // MCP server the user runs; corrupting a byte does not degrade observation,
  // it breaks their whole agent setup.
  test('server stdout reaches the host verbatim', async () => {
    const child = fakeChild();
    const stdinSrc = new EventEmitter();
    const out = collector();
    const err = collector();

    const done = runSupervised({
      command: ['fake-server'],
      spawnFn: (() => child) as never,
      stdin: stdinSrc as never,
      stdout: out.stream as never,
      stderr: err.stream as never
    });

    // Deliberately awkward: a split JSON frame, a non-JSON line, and binary.
    child.stdout.emit('data', Buffer.from('{"jsonrpc":"2.0","id":1,'));
    child.stdout.emit('data', Buffer.from('"result":{"tools":[]}}\n'));
    child.stdout.emit('data', Buffer.from('not json at all\n'));
    child.stdout.emit('data', Buffer.from([0x00, 0xff, 0xfe]));
    child.emit('close', 0, null);

    expect(await done).toBe(0);
    expect(out.text()).toBe(
      '{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\nnot json at all\n' +
        Buffer.from([0x00, 0xff, 0xfe]).toString('utf8')
    );
  });

  test('host stdin reaches the server verbatim', async () => {
    const child = fakeChild();
    const stdinSrc = new EventEmitter();
    const out = collector();

    const done = runSupervised({
      command: ['fake-server'],
      spawnFn: (() => child) as never,
      stdin: stdinSrc as never,
      stdout: out.stream as never,
      stderr: collector().stream as never
    });

    stdinSrc.emit('data', Buffer.from('{"method":"tools/list"}\n'));
    stdinSrc.emit('data', Buffer.from('partial'));
    child.emit('close', 0, null);
    await done;

    expect(Buffer.concat(child.stdin.written).toString()).toBe(
      '{"method":"tools/list"}\npartial'
    );
  });

  test('stderr is forwarded and never parsed as protocol', async () => {
    const child = fakeChild();
    const err = collector();
    const done = runSupervised({
      command: ['x'],
      spawnFn: (() => child) as never,
      stdin: new EventEmitter() as never,
      stdout: collector().stream as never,
      stderr: err.stream as never
    });
    child.stderr.emit('data', Buffer.from('server log line\n'));
    child.emit('close', 0, null);
    await done;
    expect(err.text()).toBe('server log line\n');
  });

  test('the child exit code propagates', async () => {
    const child = fakeChild();
    const done = runSupervised({
      command: ['x'],
      spawnFn: (() => child) as never,
      stdin: new EventEmitter() as never,
      stdout: collector().stream as never,
      stderr: collector().stream as never
    });
    child.emit('close', 3, null);
    expect(await done).toBe(3);
  });

  test('a signalled child reports the shell convention', async () => {
    const child = fakeChild();
    const done = runSupervised({
      command: ['x'],
      spawnFn: (() => child) as never,
      stdin: new EventEmitter() as never,
      stdout: collector().stream as never,
      stderr: collector().stream as never
    });
    child.emit('close', null, 'SIGTERM');
    expect(await done).toBe(143);
  });

  test('a recorder that throws cannot break the server', async () => {
    const child = fakeChild();
    const out = collector();
    const exploding = {
      started() {
        throw new Error('boom');
      },
      clientFrame() {
        throw new Error('boom');
      },
      serverFrame() {
        throw new Error('boom');
      },
      finished: async () => {
        throw new Error('boom');
      }
    };

    // `started` throwing must not prevent the run; the shim treats every
    // observation failure as "no data", never "no server".
    let code: number;
    try {
      const done = runSupervised({
        command: ['x'],
        spawnFn: (() => child) as never,
        stdin: new EventEmitter() as never,
        stdout: out.stream as never,
        stderr: collector().stream as never,
        recorder: exploding as never
      });
      child.stdout.emit('data', Buffer.from('hello\n'));
      child.emit('close', 0, null);
      code = await done;
    } catch {
      code = -1;
    }
    expect(out.text()).toContain('hello');
    expect(code).toBe(0);
  });
});

describe('frame parsing', () => {
  test('recognises frames split across chunks', () => {
    const seen: unknown[] = [];
    const tee = createFrameTee((f) => seen.push(f));
    tee(Buffer.from('{"method":"tools/'));
    tee(Buffer.from('call","params":{"name":"read_file"}}\n'));
    expect(seen).toHaveLength(1);
    expect(calledToolName(seen[0] as never)).toBe('read_file');
  });

  test('ignores non-JSON lines without throwing', () => {
    const seen: unknown[] = [];
    const tee = createFrameTee((f) => seen.push(f));
    tee(Buffer.from('garbage\n[]\n{"a":1}\n'));
    expect(seen).toHaveLength(1);
  });

  test('drops an unbounded stream with no newlines rather than growing', () => {
    const seen: unknown[] = [];
    const tee = createFrameTee((f) => seen.push(f));
    tee(Buffer.from('x'.repeat(5_000_000)));
    tee(Buffer.from('{"method":"tools/call","params":{"name":"ok"}}\n'));
    expect(seen).toHaveLength(1);
  });

  test('extracts advertised tool names', () => {
    expect(toolNamesFromResult({ tools: [{ name: 'a' }, { name: 'b' }, {}] })).toEqual(['a', 'b']);
    expect(toolNamesFromResult(null)).toEqual([]);
  });
});

describe('session recording', () => {
  test('records tool call counts and advertised tools, never arguments', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-observe-'));
    const recorder = createSessionRecorder({ dataDir: dir, key: 'pkg:npm/x@1' });

    recorder.started(['npx', 'x'], 111);
    recorder.serverFrame({ result: { tools: [{ name: 'read_file' }] } });
    recorder.clientFrame({
      method: 'tools/call',
      params: { name: 'read_file', arguments: { path: '/home/me/.ssh/id_rsa' } }
    });
    recorder.clientFrame({ method: 'tools/call', params: { name: 'read_file' } });
    await recorder.finished(0);

    const sessions = readSessions(dir);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.toolCalls).toEqual({ read_file: 2 });
    expect(sessions[0]!.toolsAdvertised).toEqual(['read_file']);
    expect(sessions[0]!.exitCode).toBe(0);

    // The privacy property: a real path went through the recorder and must not
    // be anywhere on disk. A trust tool that logged its user's activity would
    // be a worse liability than the servers it watches.
    const raw = JSON.stringify(sessions);
    expect(raw).not.toContain('id_rsa');
    expect(raw).not.toContain('arguments');

    rmSync(dir, { recursive: true, force: true });
  });

  test('an unsampled session is not reported as having contacted nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-observe-nosample-'));
    const recorder = createSessionRecorder({ dataDir: dir, key: 'k' });
    recorder.started(['x'], 1);
    await recorder.finished(0);

    const session = readSessions(dir)[0]!;
    expect(session.hostsContacted).toEqual([]);
    // ...and the flag is what distinguishes that from "sampled, saw nothing".
    expect(session.networkSampled).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });

  test('sessions append rather than overwrite', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-observe-append-'));
    for (const key of ['a', 'b', 'c']) {
      const r = createSessionRecorder({ dataDir: dir, key });
      r.started(['x'], 1);
      await r.finished(0);
    }
    expect(readSessions(dir).map((s) => s.key)).toEqual(['a', 'b', 'c']);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a corrupt line is skipped, not fatal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-observe-corrupt-'));
    expect(readSessions(dir)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('connection sampling', () => {
  test('parses lsof peers, ignoring loopback', () => {
    const output = [
      'COMMAND  PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME',
      'node    1234 me    23u  IPv4 0x1      0t0  TCP 192.168.1.5:52341->140.82.114.6:443 (ESTABLISHED)',
      'node    1234 me    24u  IPv4 0x2      0t0  TCP 127.0.0.1:1234->127.0.0.1:5432 (ESTABLISHED)',
      'node    1234 me    25u  IPv4 0x3      0t0  TCP *:8080 (LISTEN)'
    ].join('\n');

    expect(parseLsofHosts(output)).toEqual(['140.82.114.6:443']);
  });

  test('handles IPv6 peers', () => {
    const output =
      'node 1 me 3u IPv6 0x0 0t0 TCP [2001:db8::1]:5000->[2606:4700::1111]:443 (ESTABLISHED)';
    expect(parseLsofHosts(output)).toEqual(['2606:4700::1111:443']);
  });

  test('empty output yields no hosts', () => {
    expect(parseLsofHosts('')).toEqual([]);
  });
});
