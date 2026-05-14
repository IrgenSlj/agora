import { cancel, intro, isCancel, outro, select } from '@clack/prompts';
import { COMMANDS, renderManual } from './commands-meta.js';
import { renderBanner, renderBox, supportsTrueColor, type Styler } from '../ui.js';

/** Minimal IO shape needed by the interactive menu (matches CliIo from app.ts). */
interface MenuIo {
  env?: Record<string, string | undefined>;
}

const GROUPS = ['Marketplace', 'Setup', 'Library', 'Learn', 'Community'] as const;

export async function runInteractiveMenu(io: MenuIo, style: Styler): Promise<number> {
  const env = io.env ?? {};
  const trueColor = supportsTrueColor(env);

  // Print banner + welcome box once at the top (colour always on — we're in a TTY).
  const banner = renderBanner({ color: true, trueColor });
  const box = renderBox(
    'Welcome to Agora',
    ["The developer's terminal marketplace for OpenCode", 'Pick a command to read its manual.'],
    { color: true, trueColor }
  );
  process.stdout.write(`\n${banner}\n\n${box}\n\n`);

  intro('Command browser — navigate with ↑ ↓, select with Enter, Ctrl+C to quit.');

  // Build options ordered by group.
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

    const manual = renderManual(COMMANDS.find((c) => c.name === picked)!, style);
    process.stdout.write(`\n${manual}\n\n`);

    const next = await select({
      message: 'What next?',
      options: [
        { value: 'again', label: 'View another command' },
        { value: 'quit', label: 'Quit' }
      ]
    });

    if (isCancel(next) || next === 'quit') {
      if (isCancel(next)) cancel('Bye!');
      break;
    }
  }

  outro('Run `agora help` anytime, or `agora <command>`.');
  return 0;
}
