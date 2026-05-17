import { cancel, intro, isCancel, multiselect, select, text } from '@clack/prompts';
import { execSync } from 'child_process';
import * as readline from 'node:readline';
import { COMMANDS, renderManual } from './commands-meta.js';
import { renderBanner, renderBox, supportsTrueColor, type Styler } from '../ui.js';

interface MenuIo {
  env?: Record<string, string | undefined>;
}

const GROUPS = ['Marketplace', 'Setup', 'Library', 'Learn', 'Community'] as const;

const INTERACTIVE_COMMANDS = new Set(['menu', 'tui']);

function getPositionalArgs(usage: string): string[] {
  const rest = usage.replace(/^agora\s+\S+\s*/, '');
  const args: string[] = [];
  const re = /<([^>]+)>/g;
  let match;
  while ((match = re.exec(rest)) !== null) {
    args.push(match[1]);
  }
  return args;
}

function getFlagValueName(usage: string, flagName: string): string | null {
  const esc = flagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${esc}\\s+([^-\\[\\]\\s]\\S*)`);
  const match = re.exec(usage);
  return match ? match[1].replace(/[<>]/g, '') : null;
}

async function buildCommand(cmd: (typeof COMMANDS)[number], style: Styler): Promise<string | null> {
  const parts: string[] = [cmd.name];
  const positional = getPositionalArgs(cmd.usage);

  for (const arg of positional) {
    const val = await text({
      message: `Enter ${arg}:`,
      validate: (v) => (v && v.length > 0 ? undefined : `${arg} is required`)
    });
    if (isCancel(val)) return null;
    parts.push(val);
  }

  if (cmd.flags && cmd.flags.length > 0) {
    type FlagOpt = { value: string; label: string; hint: string; takesValue: boolean };
    const flagOptions: FlagOpt[] = [
      { value: '__none__', label: 'None (no flags)', hint: 'Skip all flags', takesValue: false },
      ...cmd.flags.map((f) => {
        const primary = f.flag.split(',')[0].trim();
        const takesValue = getFlagValueName(cmd.usage, primary) !== null;
        return {
          value: primary,
          label: takesValue
            ? `${primary}  (value: ${getFlagValueName(cmd.usage, primary)})`
            : primary,
          hint: f.description,
          takesValue
        };
      })
    ];

    const selected = await multiselect({
      message: 'Select flags to include:',
      options: flagOptions,
      required: false
    });

    if (isCancel(selected)) return null;

    const effectiveFlags = selected.includes('__none__') ? [] : selected;

    const flagValues: Record<string, string> = {};
    for (const flag of effectiveFlags) {
      const fo = flagOptions.find((o) => o.value === flag);
      if (fo?.takesValue) {
        const hint = getFlagValueName(cmd.usage, flag) ?? '';
        const val = await text({
          message: `Value for ${flag}:`,
          placeholder: hint
        });
        if (isCancel(val)) return null;
        flagValues[flag] = val;
      }
    }

    for (const flag of effectiveFlags) {
      parts.push(flag);
      if (flagValues[flag] !== undefined) {
        parts.push(flagValues[flag]);
      }
    }
  }

  const fullCmd = parts.join(' ');
  const displayCmd = `agora ${fullCmd}`;
  process.stdout.write(
    `\n${style.bold(style.orange('Command:'))}  ${style.accent(displayCmd)}\n\n`
  );

  const edited = await new Promise<string | null>((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true
    });

    const onSigint = () => {
      rl.close();
      process.removeListener('SIGINT', onSigint);
      resolve(null);
    };
    process.on('SIGINT', onSigint);

    rl.question('edit \u2192 ', (answer) => {
      process.removeListener('SIGINT', onSigint);
      rl.close();
      resolve(answer === '' ? displayCmd : answer);
    });

    rl.write(displayCmd);
  });

  if (edited === null) return null;

  const trimmed = edited.trim();
  return trimmed.startsWith('agora ') ? trimmed.slice(6).trim() : trimmed;
}

export async function runInteractiveMenu(io: MenuIo, style: Styler): Promise<number> {
  const env = io.env ?? {};
  const trueColor = supportsTrueColor(env);

  const banner = renderBanner({ color: true, trueColor });
  const box = renderBox(
    'Welcome to Agora',
    ["The developer's terminal marketplace for OpenCode", 'Pick a command to read its manual.'],
    { color: true, trueColor }
  );
  process.stdout.write(`\n${banner}\n\n${box}\n\n`);

  intro('Command browser — navigate with ↑ ↓, select with Enter, Ctrl+C to quit.');

  const options = GROUPS.flatMap((group) =>
    COMMANDS.filter((c) => c.group === group).map((c) => ({
      value: c.name,
      label: `[${group}] ${c.name}`,
      hint: c.summary
    }))
  );

  for (;;) {
    const picked = await select({
      message: 'Select a command to view its manual:',
      options
    });

    if (isCancel(picked)) {
      cancel('Bye!');
      return 0;
    }

    const cmd = COMMANDS.find((c) => c.name === picked)!;
    const manual = renderManual(cmd, style);
    process.stdout.write(`\n${manual}\n\n`);

    for (;;) {
      const next = await select({
        message: 'What next?',
        options: [
          ...(INTERACTIVE_COMMANDS.has(cmd.name)
            ? []
            : [
                {
                  value: 'build' as const,
                  label: 'Build this command',
                  hint: 'Walk through args and flags'
                }
              ]),
          { value: 'again' as const, label: 'View another command' },
          { value: 'quit' as const, label: 'Quit' }
        ]
      });

      if (isCancel(next) || next === 'quit') {
        if (isCancel(next)) cancel('Bye!');
        return 0;
      }

      if (next === 'again') break;

      if (next === 'build') {
        const cmdStr = await buildCommand(cmd, style);
        if (cmdStr === null) continue;

        process.stdout.write('\n');
        try {
          execSync(`agora ${cmdStr}`, { stdio: 'inherit' });
        } catch {
          // non-zero exit is fine — output already shown
        }
        process.stdout.write('\n');
      }
    }
  }
}
