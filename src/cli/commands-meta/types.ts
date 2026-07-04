import type { Styler } from '../../ui.js';

export type CommandGroup = 'Catalog' | 'Setup' | 'Library' | 'Learn' | 'Stack';

export interface CommandMeta {
  name: string;
  group: CommandGroup;
  summary: string;
  usage: string;
  details?: string;
  flags?: { flag: string; description: string }[];
  examples?: string[];
}

export function renderManual(meta: CommandMeta, style: Styler): string {
  const lines: string[] = [
    style.accent(meta.name),
    meta.summary,
    '',
    `${style.dim('Usage:')}`,
    ...meta.usage.split('\n').map((line) => `  ${line}`)
  ];

  if (meta.flags && meta.flags.length > 0) {
    const flagWidth = Math.max(...meta.flags.map((f) => f.flag.length));
    lines.push('');
    lines.push(style.dim('Flags:'));
    for (const f of meta.flags) {
      lines.push(`  ${f.flag.padEnd(flagWidth)}  ${style.dim(f.description)}`);
    }
  }

  if (meta.examples && meta.examples.length > 0) {
    lines.push('');
    lines.push(style.dim('Examples:'));
    for (const ex of meta.examples) {
      lines.push(`  ${ex}`);
    }
  }

  if (meta.details) {
    lines.push('');
    lines.push(meta.details);
  }

  return lines.join('\n');
}
