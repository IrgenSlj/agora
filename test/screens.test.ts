// Golden screens: every main screen rendered from fixed data in three modes and
// compared with the committed copies in test/__screens__/. A change to the look
// shows up as a readable diff; refresh with `bunx vitest run test/screens -u`.
// Spec: docs/TERMINAL.md.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { runCli } from '../src/cli/app';
import { appendEvent, closeSession, ensureMeta } from '../src/log/store';
import { commitAt } from './helpers/git';

type Mode = 'color' | 'plain' | 'ascii';
const MODES: Record<Mode, Record<string, string>> = {
  color: { COLORTERM: 'truecolor', LANG: 'en_US.UTF-8' },
  plain: { NO_COLOR: '1', LANG: 'en_US.UTF-8' },
  ascii: { NO_COLOR: '1', AGORA_ASCII: '1' }
};

let root: string;
let repo: string;
let dataDir: string;
const at = (s: number) => new Date((1_700_000_000 + s) * 1000);

beforeAll(async () => {
  // Resolved, so macOS's /private prefix never reaches a screen and HOME shows as ~.
  root = realpathSync(mkdtempSync(join(tmpdir(), 'agora-screens-')));
  repo = join(root, 'repo');
  dataDir = join(root, 'agora');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  commitAt(repo, 1000, 'README.md');
  const s = 'ses_screens0001';
  ensureMeta(dataDir, s, repo);
  const ev = (seconds: number, kind: string, subject: string, decision?: string) =>
    appendEvent(
      dataDir,
      s,
      { host: 'claude-code', kind, subject, ...(decision ? { decision } : {}) } as never,
      at(seconds)
    );
  ev(1100, 'session', 'start:startup');
  ev(1110, 'file_read', 'src/orders/schema.ts', 'allowed');
  ev(1130, 'file_write', 'src/orders/price.ts', 'allowed');
  ev(1150, 'exec', 'bun', 'allowed');
  ev(1170, 'net', 'registry.npmjs.org:443', 'allowed');
  ev(1190, 'exec', 'curl', 'denied');
  ev(1200, 'approval', 'git', 'asked');
  closeSession(dataDir, s, 'prompt_input_exit', 'claude-code', at(1210));
  mkdirSync(join(repo, 'src', 'orders'), { recursive: true });
  writeFileSync(join(repo, 'src', 'orders', 'price.ts'), 'x');
  commitAt(repo, 2000, 'notes.md');
  writeFileSync(
    join(repo, 'agora.cedar'),
    [
      '@id("read-src") permit (principal, action == Action::"read", resource) when { resource.path like "src/*" };',
      '@id("exec-tools") permit (principal, action == Action::"exec", resource) when { ["bun", "git"].contains(resource.name) };',
      '@id("no-rm") forbid (principal, action == Action::"exec", resource) when { resource.name == "rm" };',
      ''
    ].join('\n')
  );
  await cli(['receipt', 'write', '--no-sign'], 'plain');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function cli(args: string[], mode: Mode): Promise<string> {
  const out: string[] = [];
  const io = {
    stdout: { isTTY: mode === 'color', write: (x: string) => void out.push(x) },
    stderr: { write: () => undefined },
    env: { HOME: root, AGORA_HOME: dataDir, AGORA_KEYCHAIN: join(root, 'kc'), ...MODES[mode] },
    cwd: repo,
    fetcher: (() => Promise.reject(new Error('offline'))) as never
  };
  await runCli(args, io as never);
  return out
    .join('')
    .replaceAll(root, '<tmp>')
    .replace(/v\d+\.\d+\.\d+/g, 'v<version>')
    .replace(/last [^·\n]*?(?= {2}| ·|\n)/g, 'last <time>')
    .replace(/\d+ (min|h|days) ago|just now/g, '<ago>');
}

const SCREENS: [string, string[]][] = [
  ['help', []],
  ['doctor', ['doctor']],
  ['log-show', ['log', 'show', 'ses_screens0001']],
  ['receipt-show', ['receipt', 'show']],
  ['plan', ['plan']],
  ['manual', ['help', 'receipt']]
];

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping escapes
const visible = (line: string) => [...line.replace(/\x1b\[[0-9;]*m/g, '')].length;

describe.each(SCREENS)('%s', (name, args) => {
  test.each(Object.keys(MODES) as Mode[])('%s', async (mode) => {
    const screen = await cli(args, mode);
    await expect(screen).toMatchFileSnapshot(`./__screens__/${name}.${mode}.txt`);
    if (mode === 'ascii') expect(screen).toMatch(/^[\x00-\x7f]*$/);
    if (mode !== 'color') expect(screen).not.toContain('\x1b[');
    // The 62-column measure plus its indent; wrapped prose and long paths aside.
    for (const line of screen.split('\n'))
      if (!line.includes('/') && !line.includes('<tmp>') && !line.startsWith('    agora '))
        expect(visible(line)).toBeLessThanOrEqual(66);
  });
});
