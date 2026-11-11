// `agora log`: the session logs that every later feature reads.

import { listSessions } from '../../log/store.js';
import { verifySession } from '../../log/verify.js';
import { status } from '../components.js';
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
    for (const s of sessions) {
      writeLine(
        io.stdout,
        `${theme.accent(s.session)}  ${theme.dim(`${s.events} events · ${s.closed ? 'closed' : 'open'} · ${s.modified}`)}`
      );
    }
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
      for (const v of verdicts) {
        const what = `${v.session} · ${v.events} events · ${v.state}`;
        writeLine(io.stdout, status(v.ok ? 'success' : 'error', what, theme));
        for (const p of v.problems)
          writeLine(io.stdout, theme.dim(`    line ${p.line}: ${p.problem}`));
        if (v.ok && v.state === 'open') {
          writeLine(
            io.stdout,
            theme.dim(
              '    open: no root recorded yet, so events removed from the end would not show'
            )
          );
        }
      }
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
