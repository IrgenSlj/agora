import { renderBanner } from '../ui.js';
import { COMMANDS, type CommandGroup } from './commands-meta.js';
import type { Theme } from './theme.js';

const TAGLINE = 'a written limit for every coding agent, a receipt for every change';
const GROUPS: CommandGroup[] = ['Enforce', 'Record', 'Check', 'Setup'];

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export function header(title: string, meta: string[], theme: Theme): string {
  return [theme.accent(title), ...meta.map((part) => theme.muted(part))].join(theme.dim(' · '));
}

export function usage(theme: Theme, version: string): string {
  const w = Math.max(...COMMANDS.map((c) => c.name.length));
  const lines = [`${theme.accent('agora')}${theme.dim(` · ${TAGLINE} · v${version}`)}`, ''];
  for (const group of GROUPS) {
    const cmds = COMMANDS.filter((c) => c.group === group);
    if (!cmds.length) continue;
    lines.push(theme.muted(group));
    for (const c of cmds)
      lines.push(`  ${theme.accent(c.name.padEnd(w))}  ${theme.dim(c.summary)}`);
    lines.push('');
  }
  lines.push(theme.dim('Run `agora help <command>` for details on any command.'));
  return lines.join('\n');
}

export function welcome(color: boolean, trueColor: boolean, theme: Theme, version: string): string {
  const body = usage(theme, version);
  if (!color) return `\n${body}\n`;
  return `\n${renderBanner({ color, trueColor })}\n\n${body}\n`;
}
