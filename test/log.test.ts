import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { EventDraft } from '../src/events/schema';
import { appendEvent, closeSession, listSessions, logPath, readEvents } from '../src/log/store';
import { verifySession } from '../src/log/verify';

let dir: string;
const S = 'session-1';
const draft = (subject: string): EventDraft => ({
  host: 'claude-code',
  kind: 'file_read',
  subject,
  decision: 'allowed'
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agora-log-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function write3(): void {
  for (const s of ['a.ts', 'b.ts', 'c.ts']) appendEvent(dir, S, draft(s));
}

describe('session log', () => {
  test('a written chain verifies', () => {
    write3();
    const v = verifySession(dir, S);
    expect(v).toMatchObject({ ok: true, events: 3, state: 'open' });
    expect(readEvents(dir, S).map((e) => e.seq)).toEqual([0, 1, 2]);
  });

  test('changing any single byte of the log fails verification', () => {
    write3();
    const path = logPath(dir, S);
    const original = readFileSync(path);
    // Every byte position except the final newline.
    for (let i = 0; i < original.length - 1; i++) {
      const tampered = Buffer.from(original);
      tampered[i] = tampered[i] === 0x41 ? 0x42 : 0x41;
      writeFileSync(path, tampered);
      expect(verifySession(dir, S).ok, `byte ${i} changed and still verified`).toBe(false);
    }
  });

  test('removing an event from the middle fails verification', () => {
    write3();
    const path = logPath(dir, S);
    const lines = readFileSync(path, 'utf8').split('\n');
    writeFileSync(path, [lines[0], lines[2], ''].join('\n'));
    expect(verifySession(dir, S).ok).toBe(false);
  });

  test('truncating a closed session fails against its root', () => {
    write3();
    closeSession(dir, S, 'prompt_input_exit', 'claude-code');
    expect(verifySession(dir, S)).toMatchObject({ ok: true, state: 'closed', events: 4 });

    const path = logPath(dir, S);
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    writeFileSync(path, `${lines.slice(0, 2).join('\n')}\n`);
    expect(verifySession(dir, S).ok).toBe(false);
  });

  test('a closed session accepts no more events', () => {
    write3();
    closeSession(dir, S, 'other', 'claude-code');
    expect(appendEvent(dir, S, draft('d.ts')).status).toBe('skipped');
    expect(verifySession(dir, S).ok).toBe(true);
  });

  test('closing an unknown session does nothing', () => {
    expect(closeSession(dir, 'nope', 'other', 'claude-code')).toBeUndefined();
  });

  test('rejects a session id that could escape the directory', () => {
    expect(() => appendEvent(dir, '../evil', draft('x'))).toThrow();
  });

  test('lists sessions with their state', () => {
    write3();
    appendEvent(dir, 'session-2', draft('x'));
    closeSession(dir, 'session-2', 'other', 'claude-code');
    const sessions = listSessions(dir);
    expect(sessions.map((s) => [s.session, s.closed]).sort()).toEqual([
      ['session-1', false],
      ['session-2', true]
    ]);
  });
});

describe('concurrent writers', () => {
  test('parallel processes appending to one session keep the chain intact', async () => {
    const { spawn } = await import('node:child_process');
    const store = join(__dirname, '..', 'src', 'log', 'store.ts');
    const script = `
      const { appendEvent } = await import(${JSON.stringify(store)});
      let skipped = 0;
      for (let i = 0; i < 10; i++) {
        const r = appendEvent(process.argv[1], 'race', { host: 'claude-code', kind: 'exec', subject: 'git', decision: 'allowed' });
        if (r.status !== 'appended') skipped++;
      }
      process.stdout.write(String(skipped));
    `;
    const runs = await Promise.all(
      Array.from(
        { length: 6 },
        () =>
          new Promise<number>((resolve, reject) => {
            const p = spawn('bun', ['-e', script, dir], { stdio: ['ignore', 'pipe', 'inherit'] });
            let out = '';
            p.stdout.on('data', (d) => (out += d));
            p.on('error', reject);
            p.on('close', () => resolve(Number(out || '0')));
          })
      )
    );
    const skipped = runs.reduce((a, b) => a + b, 0);
    const v = verifySession(dir, 'race');
    expect(v.problems).toEqual([]);
    expect(v.events + skipped).toBe(60);
  }, 30_000);
});

describe('agora log', () => {
  async function run(args: string[]) {
    const { runCli } = await import('../src/cli/app');
    const out: string[] = [];
    const io = {
      stdout: { write: (s: string) => void out.push(s) },
      stderr: { write: (s: string) => void out.push(s) },
      env: { AGORA_HOME: dir, NO_COLOR: '1' },
      cwd: dir
    };
    const code = await runCli(['log', ...args], io as never);
    return { code, out: out.join('') };
  }

  test('list with nothing recorded exits 0', async () => {
    expect((await run([])).code).toBe(0);
  });

  test('verify with nothing recorded exits 2', async () => {
    expect((await run(['verify'])).code).toBe(2);
  });

  test('verify exits 0 on a good chain and 1 on a tampered one', async () => {
    write3();
    expect((await run(['verify', S])).code).toBe(0);
    const path = logPath(dir, S);
    writeFileSync(path, readFileSync(path, 'utf8').replace('b.ts', 'x.ts'));
    const bad = await run(['verify', '--all']);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain('hash does not match');
  });

  test('show renders the timeline, and refuses a log that does not verify', async () => {
    write3();
    const ok = await run(['show', S]);
    expect(ok.code).toBe(0);
    expect(ok.out).toMatch(/● +[0-9:]+  read +b\.ts/);
    const path = logPath(dir, S);
    writeFileSync(path, readFileSync(path, 'utf8').replace('b.ts', 'x.ts'));
    expect((await run(['show', S])).code).toBe(1);
  });

  test('show --json carries the events', async () => {
    write3();
    const { code, out } = await run(['show', S, '--json']);
    expect(code).toBe(0);
    expect(JSON.parse(out).events).toHaveLength(3);
  });
});
