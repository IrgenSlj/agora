// `agora log show`: a session as a timeline a person can read.

import { headerLine, MEASURE, padRight, rule, status, vlen } from '../cli/components.js';
import { ExitCode } from '../cli/exit-codes.js';
import type { CliIo } from '../cli/flags.js';
import { writeJson, writeLine } from '../cli/helpers.js';
import type { Theme } from '../cli/theme.js';
import { readEvents, readRoot } from './store.js';
import { verifySession } from './verify.js';

const KIND_LABEL: Record<string, string> = {
  session: 'session',
  tool_call: 'tool',
  file_read: 'read',
  file_write: 'write',
  exec: 'exec',
  net: 'net',
  approval: 'prompt',
  canary: 'canary'
};

const short = (id: string) => (id.length > 14 ? `${id.slice(0, 12)}…` : id);

export function renderTimeline(
  dataDir: string,
  session: string,
  io: CliIo,
  theme: Theme,
  json: boolean
): number {
  const verdict = verifySession(dataDir, session);
  if (verdict.events === 0 && !verdict.ok) {
    writeLine(io.stderr, `No session ${session}.`);
    return ExitCode.USAGE;
  }
  // Show only what verifies: a timeline from a broken chain would present
  // tampered lines with the same authority as real ones.
  if (!verdict.ok) {
    writeLine(
      io.stderr,
      `Session ${session} does not verify; run \`agora log verify ${session}\`.`
    );
    return ExitCode.POLICY_FORBID;
  }
  const events = readEvents(dataDir, session);
  if (json) {
    writeJson(io.stdout, { session, root: readRoot(dataDir, session) ?? null, events });
    return ExitCode.OK;
  }

  const first = events[0];
  const denied = events.filter((e) => e.decision === 'denied').length;
  const asked = events.filter((e) => e.decision === 'asked').length;
  writeLine(io.stdout, '');
  writeLine(io.stdout, headerLine(`log show ${short(session)}`, first?.host ?? '', theme));
  writeLine(io.stdout, '');
  const stat = (k: string, v: number | string) => `${theme.muted(k)}  ${v}`;
  writeLine(
    io.stdout,
    `  ${[stat('entries', events.length), stat('denied', denied), stat('asked', asked)].join('    ')}`
  );
  writeLine(io.stdout, '');

  for (const e of events) {
    const time = theme.muted(e.ts.slice(11, 19));
    const isStart = e.kind === 'session' && e.subject.startsWith('start');
    const isEnd = e.kind === 'session' && e.subject.startsWith('end');
    let mark = theme.muted(theme.glyph('link'));
    let kind = KIND_LABEL[e.kind] ?? e.kind;
    let subject = e.subject;
    let right = '';
    if (isStart) {
      mark = theme.muted(theme.glyph('start'));
      kind = 'start';
      subject = `session ${short(session)} · ${e.subject.slice('start:'.length) || 'start'}`;
    } else if (isEnd) {
      mark = theme.muted(theme.glyph('end'));
      kind = 'end';
      subject = e.subject.slice('end:'.length) || 'end';
    } else if (e.kind === 'canary') {
      mark = theme.error(theme.glyph('denied'));
      kind = theme.error('CANARY');
      right = theme.error('blocked');
    } else if (e.decision === 'denied') {
      mark = theme.error(theme.glyph('denied'));
      subject = `${kind} ${e.subject}`;
      kind = theme.error('DENIED');
      right = theme.error('blocked');
    } else if (e.decision === 'asked') {
      mark = theme.warning(theme.glyph('warn'));
      right = theme.warning('asked');
    }
    const pad =
      mark.includes(theme.glyph('start')) || mark.includes(theme.glyph('end')) ? ' ' : '  ';
    const left = `  ${mark}${pad}${time}  ${padRight(kind, 7)} ${subject}`;
    writeLine(io.stdout, right ? `${padRight(left, MEASURE + 2 - vlen(right))}${right}` : left);
  }
  if (verdict.state === 'open')
    writeLine(
      io.stdout,
      `  ${theme.unknown(theme.glyph('rail'))}   ${theme.muted('no end recorded yet')}`
    );

  const tools = events.filter((e) => e.kind !== 'session').length;
  writeLine(io.stdout, '');
  writeLine(io.stdout, rule(theme));
  const h = (x: string | undefined) => {
    const hex = (x ?? '').replace(/^sha256:/, '');
    return `#${hex.slice(0, 4)}${theme.unicode ? '…' : '..'}${hex.slice(-4)}`;
  };
  const link = theme.glyph('link');
  const bar = theme.glyph('rule').repeat(2);
  const chain = `${link}${bar}${link}${bar} ${events.length} links ${bar}${link}${bar}${link}`;
  writeLine(
    io.stdout,
    `  ${theme.muted('chain')}  ${h(first?.hash)} ${theme.muted(chain)} ${h(events.at(-1)?.hash)}`
  );
  writeLine(
    io.stdout,
    verdict.state === 'closed'
      ? `  ${status('success', `intact  ${theme.muted('every entry carries the hash of the one before it')}`, theme)}`
      : `  ${status('unknown', `open  ${theme.muted('no root yet: events removed from the end would not show')}`, theme)}`
  );
  writeLine(
    io.stdout,
    `  ${theme.muted(`${tools} calls · ${tools - denied} allowed · ${denied} denied`)}`
  );
  return ExitCode.OK;
}
