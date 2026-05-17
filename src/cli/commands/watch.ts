import { numberFlag, writeLine, usageError } from '../helpers.js';
import type { CommandHandler } from './types.js';

export const commandWatch: CommandHandler = async (parsed, io, style) => {
  const args = parsed.args;
  if (args.length === 0) {
    return usageError(io, 'watch requires a command to run.\nUsage: agora watch <interval> <command...>\n  agora watch 5 agora trending\n  agora watch 1 agora search filesystem');
  }

  const intervalArg = args[0];
  const interval = parseInt(intervalArg, 10);
  if (isNaN(interval) || interval < 1) {
    return usageError(io, `Invalid interval "${intervalArg}". Must be a positive number of seconds.`);
  }

  const cmdArgs = args.slice(1);
  if (cmdArgs.length === 0) {
    return usageError(io, 'watch requires a command to run after the interval.');
  }

  const cmd = cmdArgs.join(' ');
  const { runCli } = await import('../app.js');

  const clearScreen = '\x1b[2J\x1b[H';

  let iteration = 0;
  for (;;) {
    const now = new Date();
    const timestamp = now.toLocaleTimeString();

    writeLine(io.stdout, clearScreen);
    writeLine(io.stdout, style.accent(`Every ${interval}s · ${cmd} · ${timestamp} (iteration ${++iteration})`));
    writeLine(io.stdout, style.dim('\u2500'.repeat(60)));
    writeLine(io.stdout, '');

    const innerIo = { ...io };
    const exitCode = await runCli(cmdArgs, innerIo);

    writeLine(io.stdout, '');
    writeLine(io.stdout, style.dim(`\u2500`.repeat(60)));
    writeLine(io.stdout, `Exit code: ${exitCode}`);

    if (parsed.flags.once || iteration >= (numberFlag(parsed, 'count', 'n') || Infinity)) break;

    await sleep(interval * 1000);
  }

  return 0;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
