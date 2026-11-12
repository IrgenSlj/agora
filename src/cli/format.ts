import { renderBanner } from '../ui.js';
import { COMMANDS, type CommandGroup } from './commands-meta.js';
import { leader } from './components.js';
import type { Theme } from './theme.js';

const GROUPS: CommandGroup[] = ['Enforce', 'Record', 'Check', 'Setup'];
// Within a group, the commands people reach for first.
const ORDER = [
  'plan',
  'apply',
  'hook',
  'learn',
  'replay',
  'policy',
  'profile',
  'log',
  'run',
  'observe',
  'receipt',
  'ci',
  'report',
  'doctor',
  'audit',
  'signer',
  'canary',
  'completions'
];
const rank = (name: string) => (ORDER.includes(name) ? ORDER.indexOf(name) : ORDER.length);

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export function header(title: string, meta: string[], theme: Theme): string {
  return [theme.accent(title), ...meta.map((part) => theme.muted(part))].join(theme.dim(' · '));
}

/** The command list: groups in capitals, each command led by dots to its summary. */
export function usage(theme: Theme, version: string): string {
  const lines = [`  ${theme.muted('usage')}  agora <command> [options]`, ''];
  for (const group of GROUPS) {
    const cmds = COMMANDS.filter((c) => c.group === group).sort(
      (a, b) => rank(a.name) - rank(b.name)
    );
    if (!cmds.length) continue;
    lines.push(`  ${theme.bold(group.toUpperCase())}`);
    for (const c of cmds) {
      const name = leader(c.name, '', theme, 20).trimEnd();
      lines.push(
        `    ${theme.accent(c.name)}${name.slice(c.name.length)} ${theme.muted(c.summary)}`
      );
    }
    lines.push('');
  }
  lines.push(`  ${theme.muted(`agora <command> --help for details · v${version}`)}`);
  return lines.join('\n');
}

export function welcome(theme: Theme, version: string, columns?: number): string {
  const banner = renderBanner({
    color: theme.useColor,
    depth: theme.depth,
    unicode: theme.unicode,
    columns
  });
  return `\n${banner}\n\n${usage(theme, version)}\n`;
}
