// `agora log`: the session logs that every later feature reads.

import { listSessions } from '../../log/store.js';
import { verifySession } from '../../log/verify.js';
import {
  ago,
  headerLine,
  leader,
  MEASURE,
  row,
  rule,
  section,
  status,
  tally
} from '../components.js';
import { ExitCode } from '../exit-codes.js';
import { detectDataDir, usageError, writeJson, writeLine } from '../helpers.js';
import { cliTheme } from '../theme.js';
import type { CommandHandler } from './types.js';

export const commandLog: CommandHandler = async (parsed, io, style) => {
  const sub = parsed.args[0] ?? 'list';
  const dataDir = detectDataDir(parsed, io);
  const theme = cliTheme(style, io);

  if (sub === 'list') {
    const sessions = listSessions(dataDir);
    if (parsed.flags.json) {
      writeJson(io.stdout, { sessions });
      return ExitCode.OK;
    }
    if (!sessions.length) {
      writeLine(
        io.stdout,
        theme.muted('No sessions recorded yet. Run `agora hook install` in a repository.')
      );
      return ExitCode.OK;
    }
    const out = (l = '') => writeLine(io.stdout, l);
    out('');
    out(
      headerLine('log list', `${sessions.length} session${sessions.length === 1 ? '' : 's'}`, theme)
    );
    out('');
    out(section('Sessions', theme, 'events · asked · state'));
    for (const s of sessions) {
      const mark = s.closed ? theme.muted(theme.glyph('link')) : theme.unknown(theme.glyph('link'));
      const right = `${s.events} ${theme.glyph('leader')} ${s.prompts} ${theme.glyph('leader')} ${s.closed ? 'closed' : 'open'}`;
      out(
        `  ${mark} ${leader(`${theme.accent(s.session.slice(0, 12))} ${theme.muted(s.host)}`, `${theme.muted(ago(s.modified))}  ${right}`, theme, MEASURE - 2)}`
      );
    }
    out('');
    out(`  ${theme.muted('agora log show <id> for a timeline · agora log verify --all')}`);
    out('');
    return ExitCode.OK;
  }

  if (sub === 'verify') {
    const all = parsed.flags.all === true;
    const targets = all
      ? listSessions(dataDir).map((s) => s.session)
      : [parsed.args[1] ?? listSessions(dataDir)[0]?.session].filter((s): s is string =>
          Boolean(s)
        );
    if (!targets.length) {
      return usageError(io, 'No session to verify. Pass a session id, or --all.');
    }
    const verdicts = targets.map((session) => verifySession(dataDir, session));
    if (parsed.flags.json) {
      writeJson(io.stdout, { sessions: verdicts });
    } else {
      const out = (l = '') => writeLine(io.stdout, l);
      out('');
      out(
        headerLine(
          'log verify',
          `${verdicts.length} session${verdicts.length === 1 ? '' : 's'}`,
          theme
        )
      );
      out('');
      for (const v of verdicts) {
        const tone = !v.ok ? 'error' : v.state === 'open' ? 'unknown' : 'success';
        const right = !v.ok ? 'broken' : v.state === 'open' ? 'open' : 'intact';
        out(row(tone, v.session.slice(0, 12), `${v.events} entries`, right, theme, 16));
        for (const p of v.problems) out(`      ${theme.error(`line ${p.line}: ${p.problem}`)}`);
      }
      out('');
      out(rule(theme));
      out(
        tally(
          [
            [verdicts.filter((v) => v.ok && v.state === 'closed').length, 'intact'],
            [verdicts.filter((v) => v.ok && v.state === 'open').length, 'open'],
            [verdicts.filter((v) => !v.ok).length, 'broken']
          ],
          theme
        )
      );
      if (verdicts.some((v) => v.ok && v.state === 'open'))
        out(
          `  ${status('unknown', theme.muted('open: no root recorded yet, so events removed from the end would not show'), theme)}`
        );
      out('');
    }
    return verdicts.every((v) => v.ok) ? ExitCode.OK : ExitCode.POLICY_FORBID;
  }

  if (sub === 'show') {
    const { renderTimeline } = await import('../../log/show.js');
    const session = parsed.args[1] ?? listSessions(dataDir)[0]?.session;
    if (!session) return usageError(io, 'No session to show. Pass a session id.');
    return renderTimeline(dataDir, session, io, theme, Boolean(parsed.flags.json));
  }

  return usageError(io, `Unknown log subcommand: ${sub}. Use list, show or verify.`);
};
