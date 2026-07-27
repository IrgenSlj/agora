import { getInstallKind, type MarketplaceItem, renderPermissionLines } from '../catalog/bundled.js';
import { formatNumber } from '../format.js';
import { renderBanner, renderBox } from '../ui.js';
import { COMMANDS } from './commands-meta.js';
import { kvRow, tagList } from './pages/components.js';
import type { Theme } from './theme.js';

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max - 1) + '…';
}

export function formatDate(value: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatItemList(items: MarketplaceItem[], theme: Theme): string {
  const idWidth = Math.max(...items.map((item) => item.id.length));
  return items
    .map((item) => {
      const metrics =
        item.kind === 'package'
          ? `${formatNumber(item.installs)} installs · ${formatNumber(item.stars)} ★`
          : `${formatNumber(item.stars)} ★`;
      return [
        `${theme.accent(item.id.padEnd(idWidth))}  ${theme.dim(metrics)}`,
        theme.dim(item.name),
        truncate(item.description, 88),
        theme.dim(`${item.category} · by ${item.author}`)
      ].join('\n');
    })
    .join('\n\n');
}

export function formatItemTable(items: MarketplaceItem[], theme: Theme): string {
  const idW = Math.max(4, ...items.map((i) => i.id.length));
  const nameW = Math.max(4, ...items.map((i) => i.name.length));
  const starW = 6;
  const installW = 9;
  const totalW = idW + 3 + nameW + 3 + starW + 3 + installW + 4;

  const top = '┌' + '─'.repeat(totalW - 2) + '┐';
  const bot = '└' + '─'.repeat(totalW - 2) + '┘';
  const sep = '│';

  const hdr =
    sep +
    ' ' +
    'id'.padEnd(idW) +
    ' │ ' +
    'name'.padEnd(nameW) +
    ' │ ' +
    'stars'.padStart(starW) +
    ' │ ' +
    'installs'.padStart(installW) +
    ' │';

  const rows = items.map(
    (item) =>
      sep +
      ' ' +
      theme.accent(item.id.padEnd(idW)) +
      ' │ ' +
      theme.dim(item.name.padEnd(nameW)) +
      ' │ ' +
      theme.dim(formatNumber(item.stars).padStart(starW)) +
      ' │ ' +
      theme.dim(formatNumber(item.installs).padStart(installW)) +
      ' │'
  );

  return [top, hdr, ...rows, bot].join('\n');
}

const KV_KEY_WIDTH = 10;

export function formatItemDetail(item: MarketplaceItem, theme: Theme): string {
  const lines = [
    theme.bold(item.name),
    kvRow('id', theme.accent(item.id), KV_KEY_WIDTH, theme),
    kvRow('type', item.kind, KV_KEY_WIDTH, theme),
    kvRow('category', item.category, KV_KEY_WIDTH, theme),
    kvRow('author', item.author, KV_KEY_WIDTH, theme),
    kvRow('stars', formatNumber(item.stars), KV_KEY_WIDTH, theme),
    kvRow('install', getInstallKind(item), KV_KEY_WIDTH, theme),
    '',
    item.description,
    '',
    kvRow('tags', tagList(item.tags, theme), KV_KEY_WIDTH, theme)
  ];

  if (item.kind === 'package') {
    lines.splice(5, 0, kvRow('version', item.version, KV_KEY_WIDTH, theme));
    lines.push(kvRow('installs', formatNumber(item.installs), KV_KEY_WIDTH, theme));
    if (item.repository) lines.push(kvRow('repo', item.repository, KV_KEY_WIDTH, theme));
    if (item.npmPackage) lines.push(kvRow('npm', item.npmPackage, KV_KEY_WIDTH, theme));
    if (item.permissions) {
      const permRows = renderPermissionLines(item.permissions);
      if (permRows.length > 1) {
        lines.push('');
        // First row is "Permissions" label; subsequent rows are the indented values.
        lines.push(theme.muted(permRows[0]!));
        for (const row of permRows.slice(1)) lines.push(row);
      }
    }
  }

  return lines.join('\n');
}
export function welcome(color: boolean, trueColor: boolean, theme: Theme, version: string): string {
  if (!color) {
    return [
      '',
      `agora · the trust plane for agentic tooling · v${version}`,
      '',
      '  Audit     agora doctor · agora installed',
      '  Search    agora search <query> · agora browse <id>',
      '  Acquire   agora scan <id> · agora acquire <id>',
      '  Stack     agora freeze --write · agora plan · agora apply',
      '  Setup     agora init [--mcp] · agora integrate --all',
      ''
    ].join('\n');
  }
  const banner = renderBanner({ color, trueColor });
  const box = renderBox(
    'Welcome to Agora',
    [
      'the trust plane for agentic tooling - type a command, bash or chat:',
      `v${version} · run \`agora help\` to get started`
    ],
    { color, trueColor }
  );
  const hint = [
    `${theme.muted('Audit')}     agora doctor · agora installed`,
    `${theme.muted('Search')}    agora search <query> · agora browse <id>`,
    `${theme.muted('Acquire')}   agora scan <id> · agora acquire <id>`,
    `${theme.muted('Stack')}     agora freeze --write · agora plan · agora apply`,
    `${theme.muted('Setup')}     agora init [--mcp] · agora integrate --all`
  ].join('\n');
  return `\n${banner}\n\n${box}\n\n${hint}\n`;
}

export function header(title: string, meta: string[], theme: Theme): string {
  return [theme.accent(title), ...meta.map((part) => theme.muted(part))].join(theme.dim(' · '));
}

export function usage(theme: Theme, version: string): string {
  const nameWidth = Math.max(...COMMANDS.map((c) => c.name.length));
  const groups = ['Catalog', 'Setup', 'Stack'] as const;

  const lines: string[] = [
    `${theme.accent('agora')}${theme.dim(` · the trust plane for agentic tooling · v${version}`)}`,
    ''
  ];

  for (const group of groups) {
    const groupCmds = COMMANDS.filter((c) => c.group === group);
    if (groupCmds.length === 0) continue;
    lines.push(theme.muted(group));
    for (const cmd of groupCmds) {
      lines.push(`  ${theme.accent(cmd.name.padEnd(nameWidth))}  ${theme.dim(cmd.summary)}`);
    }
    lines.push('');
  }

  lines.push(theme.dim('Run `agora help <command>` for details on any command.'));

  return lines.join('\n');
}
