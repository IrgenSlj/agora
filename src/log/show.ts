// `agora log show`: a session as a timeline a person can read.

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
  approval: 'approval',
  canary: 'CANARY'
};

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
  writeLine(
    io.stdout,
    `${theme.accent(session)} ${theme.dim(`· ${first?.host ?? ''} · ${events.length} events · ${verdict.state}`)}`
  );
  writeLine(io.stdout, '');
  const counts = new Map<string, number>();
  for (const e of events) {
    const time = e.ts.slice(11, 19);
    const kind = (KIND_LABEL[e.kind] ?? e.kind).padEnd(8);
    const decision =
      e.decision === 'denied'
        ? theme.error(' denied')
        : e.decision === 'asked'
          ? theme.warning(' asked')
          : '';
    writeLine(io.stdout, `  ${theme.dim(time)}  ${theme.muted(kind)} ${e.subject}${decision}`);
    counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  }
  writeLine(io.stdout, '');
  const denied = events.filter((e) => e.decision === 'denied').length;
  const summary = [...counts.entries()]
    .filter(([k]) => k !== 'session')
    .map(([k, n]) => `${n} ${KIND_LABEL[k] ?? k}`)
    .join(' · ');
  writeLine(io.stdout, theme.dim(`  ${summary}${denied ? ` · ${denied} denied` : ''}`));
  return ExitCode.OK;
}
