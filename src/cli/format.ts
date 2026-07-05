import type { Theme } from './theme.js';
import { formatNumber } from '../format.js';
import { getInstallKind, renderPermissionLines, type MarketplaceItem } from '../marketplace.js';
import type { ResolvedSavedItem } from '../state.js';
import type { Tutorial, Pricing } from '../types.js';
import type { ApiReview, ApiProfile } from '../live.js';
import { COMMANDS } from './commands-meta.js';
import { renderBanner, renderBox } from '../ui.js';
import { pill, tagList, kvRow } from './pages/components.js';

function pricingBadge(pricing: Pricing | undefined, theme: Theme): string {
  if (!pricing) return '';
  if (pricing.kind === 'free') return ' ' + pill('FREE', 'success', theme);
  if (pricing.kind === 'paid') return ' ' + pill('PAID', 'accent', theme);
  return '';
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max - 1) + '…';
}

export function formatDate(value: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
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
      const badge = item.kind === 'package' ? pricingBadge(item.pricing, theme) : '';
      return [
        `${theme.accent(item.id.padEnd(idWidth))}  ${theme.dim(metrics)}`,
        theme.dim(item.name) + badge,
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
  const badge = item.kind === 'package' ? pricingBadge(item.pricing, theme) : '';
  const lines = [
    theme.bold(item.name) + badge,
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

  if (item.kind === 'workflow') {
    lines.push(kvRow('forks', String(item.forks), KV_KEY_WIDTH, theme));
    if (item.model) lines.push(kvRow('model', item.model, KV_KEY_WIDTH, theme));
    lines.push('', theme.dim('prompt'), item.prompt);
  }

  return lines.join('\n');
}

export function formatSavedList(items: ResolvedSavedItem[], theme: Theme): string {
  return items
    .map((entry, index) => {
      if (!entry.item) {
        return [
          `${index + 1}. ${theme.accent(entry.saved.id)} ${theme.dim('[missing]')}`,
          `   ${theme.dim('saved ' + formatDate(entry.saved.savedAt))}`
        ].join('\n');
      }

      return [
        `${index + 1}. ${theme.accent(entry.item.id)} ${theme.dim('[' + entry.item.category + ']')}`,
        `   ${theme.dim(entry.item.name)}`,
        `   ${truncate(entry.item.description, 88)}`,
        `   ${theme.dim('saved ' + formatDate(entry.saved.savedAt))}`
      ].join('\n');
    })
    .join('\n\n');
}

export function formatReviewList(reviews: ApiReview[], theme: Theme): string {
  return reviews
    .map((review, index) => {
      return [
        `${index + 1}. ${theme.accent(review.itemId)} ${theme.dim('[' + review.itemType + ']')}`,
        `   ${theme.dim('rating ' + review.rating + '/5 by ' + review.author)}`,
        `   ${truncate(review.content, 88)}`
      ].join('\n');
    })
    .join('\n\n');
}

export function formatProfileDetail(profile: ApiProfile, theme: Theme): string {
  const lines = [
    theme.bold(profile.displayName),
    `${theme.muted('username')} ${theme.accent(profile.username)}`,
    `${theme.muted('packages')} ${formatNumber(profile.packages)}`,
    `${theme.muted('workflows')} ${formatNumber(profile.workflows)}`,
    `${theme.muted('discussions')} ${formatNumber(profile.discussions)}`,
    `${theme.muted('reputation')} ${profile.reputation ?? 0}`
  ];

  if (profile.bio) lines.splice(2, 0, `${theme.muted('bio')} ${profile.bio}`);
  if (profile.avatarUrl) lines.push(`${theme.muted('avatar')} ${profile.avatarUrl}`);
  if (profile.joinedAt) lines.push(`${theme.muted('joined')} ${formatDate(profile.joinedAt)}`);

  return lines.join('\n');
}

export function formatTutorialList(tutorials: Tutorial[], theme: Theme): string {
  return tutorials
    .map((tutorial, index) => {
      return [
        `${index + 1}. ${theme.accent(tutorial.id)} ${theme.dim('[' + tutorial.level + ']')}`,
        `   ${theme.dim(tutorial.title)}`,
        `   ${truncate(tutorial.description, 88)}`,
        `   ${theme.dim(tutorial.duration + ' | ' + tutorial.steps.length + ' steps')}`
      ].join('\n');
    })
    .join('\n\n');
}

export function formatTutorialStep(tutorial: Tutorial, stepNumber: number, theme: Theme): string {
  const step = tutorial.steps[stepNumber - 1];

  if (!step) {
    return [
      theme.bold(tutorial.title),
      theme.dim(`Completed ${tutorial.steps.length}/${tutorial.steps.length} steps.`),
      'Run agora tutorials for more tutorials.'
    ].join('\n');
  }

  const lines = [
    theme.bold(tutorial.title),
    `${theme.dim('id')} ${theme.accent(tutorial.id)}`,
    `${theme.dim('level')} ${tutorial.level}`,
    `${theme.dim('duration')} ${tutorial.duration}`,
    `${theme.dim('step')} ${stepNumber}/${tutorial.steps.length}`,
    '',
    step.title || '',
    step.content || ''
  ];

  if (step.code) {
    lines.push('', theme.dim('code:'), step.code);
  }

  return lines.join('\n');
}

export function welcome(color: boolean, trueColor: boolean, theme: Theme, version: string): string {
  if (!color) {
    return [
      '',
      `agora · the system manager for your agentic stack · v${version}`,
      '',
      '  Search    agora search <query>',
      '  Browse    agora trending · agora browse <id>',
      '  Learn     agora tutorials · agora tutorial <id>',
      '  Install   agora install <id> [--write]',
      '  Setup     agora init [--mcp] · agora use <workflow>',
      '  Auth      agora login [--api-url <url>]',
      ''
    ].join('\n');
  }
  const banner = renderBanner({ color, trueColor });
  const box = renderBox(
    'Welcome to Agora',
    [
      'the system manager for your agentic stack - type a command, bash or chat:',
      `v${version} · run \`agora help\` to get started`
    ],
    { color, trueColor }
  );
  const hint = [
    `${theme.muted('Search')}    agora search <query>`,
    `${theme.muted('Browse')}    agora trending · agora browse <id>`,
    `${theme.muted('Learn')}     agora tutorials · agora tutorial <id>`,
    `${theme.muted('Install')}   agora install <id> [--write]`,
    `${theme.muted('Setup')}     agora init [--mcp] · agora use <workflow>`,
    `${theme.muted('Auth')}      agora login [--api-url <url>]`
  ].join('\n');
  return `\n${banner}\n\n${box}\n\n${hint}\n`;
}

export function header(title: string, meta: string[], theme: Theme): string {
  return [theme.accent(title), ...meta.map((part) => theme.muted(part))].join(theme.dim(' · '));
}

export function usage(theme: Theme, version: string): string {
  const nameWidth = Math.max(...COMMANDS.map((c) => c.name.length));
  const groups = ['Catalog', 'Setup', 'Stack', 'Library', 'Learn'] as const;

  const lines: string[] = [
    `${theme.accent('agora')}${theme.dim(` · the system manager for your agentic stack · v${version}`)}`,
    ''
  ];

  for (const group of groups) {
    const groupCmds = COMMANDS.filter((c) => c.group === group);
    lines.push(theme.muted(group));
    for (const cmd of groupCmds) {
      lines.push(`  ${theme.accent(cmd.name.padEnd(nameWidth))}  ${theme.dim(cmd.summary)}`);
    }
    lines.push('');
  }

  lines.push(theme.dim('Run `agora help <command>` for details on any command.'));

  return lines.join('\n');
}
