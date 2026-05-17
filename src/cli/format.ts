import type { Styler } from '../ui.js';
import { formatNumber } from '../format.js';
import { getInstallKind, type MarketplaceItem } from '../marketplace.js';
import type { ResolvedSavedItem } from '../state.js';
import type { Tutorial, Pricing } from '../types.js';
import type { ApiReview, ApiProfile } from '../live.js';
import { COMMANDS } from './commands-meta.js';
import { renderBanner, renderBox } from '../ui.js';

function pricingBadge(pricing: Pricing | undefined, style: Styler): string {
  if (!pricing) return '';
  if (pricing.kind === 'free') return ' ' + style.dim('FREE');
  if (pricing.kind === 'paid') return ' ' + style.accent('PAID');
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

export function formatItemList(items: MarketplaceItem[], style: Styler): string {
  const idWidth = Math.max(...items.map((item) => item.id.length));
  return items
    .map((item) => {
      const metrics =
        item.kind === 'package'
          ? `${formatNumber(item.installs)} installs · ${formatNumber(item.stars)} ★`
          : `${formatNumber(item.stars)} ★`;
      const badge = item.kind === 'package' ? pricingBadge(item.pricing, style) : '';
      return [
        `${style.accent(item.id.padEnd(idWidth))}  ${style.dim(metrics)}`,
        style.dim(item.name) + badge,
        truncate(item.description, 88),
        style.dim(`${item.category} · by ${item.author}`)
      ].join('\n');
    })
    .join('\n\n');
}

export function formatItemTable(items: MarketplaceItem[], style: Styler): string {
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
      style.accent(item.id.padEnd(idW)) +
      ' │ ' +
      style.dim(item.name.padEnd(nameW)) +
      ' │ ' +
      style.dim(formatNumber(item.stars).padStart(starW)) +
      ' │ ' +
      style.dim(formatNumber(item.installs).padStart(installW)) +
      ' │'
  );

  return [top, hdr, ...rows, bot].join('\n');
}

export function formatItemDetail(item: MarketplaceItem, style: Styler): string {
  const badge = item.kind === 'package' ? pricingBadge(item.pricing, style) : '';
  const lines = [
    style.bold(item.name) + badge,
    `${style.dim('id')}        ${style.accent(item.id)}`,
    `${style.dim('type')}      ${item.kind}`,
    `${style.dim('category')}  ${item.category}`,
    `${style.dim('author')}    ${item.author}`,
    `${style.dim('stars')}     ${formatNumber(item.stars)}`,
    `${style.dim('install')}   ${getInstallKind(item)}`,
    '',
    item.description,
    '',
    `${style.dim('tags')}      ${item.tags.join(', ')}`
  ];

  if (item.kind === 'package') {
    lines.splice(5, 0, `${style.dim('version')}   ${item.version}`);
    lines.push(`${style.dim('installs')}  ${formatNumber(item.installs)}`);
    if (item.repository) lines.push(`${style.dim('repo')}      ${item.repository}`);
    if (item.npmPackage) lines.push(`${style.dim('npm')}       ${item.npmPackage}`);
  }

  if (item.kind === 'workflow') {
    lines.push(`${style.dim('forks')}     ${item.forks}`);
    if (item.model) lines.push(`${style.dim('model')}     ${item.model}`);
    lines.push('', style.dim('prompt'), item.prompt);
  }

  return lines.join('\n');
}

export function formatSavedList(items: ResolvedSavedItem[], style: Styler): string {
  return items
    .map((entry, index) => {
      if (!entry.item) {
        return [
          `${index + 1}. ${style.accent(entry.saved.id)} ${style.dim('[missing]')}`,
          `   ${style.dim('saved ' + formatDate(entry.saved.savedAt))}`
        ].join('\n');
      }

      return [
        `${index + 1}. ${style.accent(entry.item.id)} ${style.dim('[' + entry.item.category + ']')}`,
        `   ${style.dim(entry.item.name)}`,
        `   ${truncate(entry.item.description, 88)}`,
        `   ${style.dim('saved ' + formatDate(entry.saved.savedAt))}`
      ].join('\n');
    })
    .join('\n\n');
}

export function formatReviewList(reviews: ApiReview[], style: Styler): string {
  return reviews
    .map((review, index) => {
      return [
        `${index + 1}. ${style.accent(review.itemId)} ${style.dim('[' + review.itemType + ']')}`,
        `   ${style.dim('rating ' + review.rating + '/5 by ' + review.author)}`,
        `   ${truncate(review.content, 88)}`
      ].join('\n');
    })
    .join('\n\n');
}

export function formatProfileDetail(profile: ApiProfile, style: Styler): string {
  const lines = [
    style.bold(profile.displayName),
    `${style.dim('username')} ${style.accent(profile.username)}`,
    `${style.dim('packages')} ${formatNumber(profile.packages)}`,
    `${style.dim('workflows')} ${formatNumber(profile.workflows)}`,
    `${style.dim('discussions')} ${formatNumber(profile.discussions)}`
  ];

  if (profile.bio) lines.splice(2, 0, `${style.dim('bio')} ${profile.bio}`);
  if (profile.avatarUrl) lines.push(`${style.dim('avatar')} ${profile.avatarUrl}`);
  if (profile.joinedAt) lines.push(`${style.dim('joined')} ${formatDate(profile.joinedAt)}`);

  return lines.join('\n');
}

export function formatTutorialList(tutorials: Tutorial[], style: Styler): string {
  return tutorials
    .map((tutorial, index) => {
      return [
        `${index + 1}. ${style.accent(tutorial.id)} ${style.dim('[' + tutorial.level + ']')}`,
        `   ${style.dim(tutorial.title)}`,
        `   ${truncate(tutorial.description, 88)}`,
        `   ${style.dim(tutorial.duration + ' | ' + tutorial.steps.length + ' steps')}`
      ].join('\n');
    })
    .join('\n\n');
}

export function formatTutorialStep(tutorial: Tutorial, stepNumber: number, style: Styler): string {
  const step = tutorial.steps[stepNumber - 1];

  if (!step) {
    return [
      style.bold(tutorial.title),
      style.dim(`Completed ${tutorial.steps.length}/${tutorial.steps.length} steps.`),
      'Run agora tutorials for more tutorials.'
    ].join('\n');
  }

  const lines = [
    style.bold(tutorial.title),
    `${style.dim('id')} ${style.accent(tutorial.id)}`,
    `${style.dim('level')} ${tutorial.level}`,
    `${style.dim('duration')} ${tutorial.duration}`,
    `${style.dim('step')} ${stepNumber}/${tutorial.steps.length}`,
    '',
    step.title || '',
    step.content || ''
  ];

  if (step.code) {
    lines.push('', style.dim('code:'), step.code);
  }

  return lines.join('\n');
}

export function welcome(
  color: boolean,
  trueColor: boolean,
  style: Styler,
  version: string
): string {
  if (!color) {
    return [
      '',
      `agora · Developers' CLI marketplace and community hub · v${version}`,
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
      "Developers' CLI marketplace and community hub - type a command, bash or chat:",
      `v${version} · run \`agora help\` to get started`
    ],
    { color, trueColor }
  );
  const hint = [
    `${style.dim('Search')}    agora search <query>`,
    `${style.dim('Browse')}    agora trending · agora browse <id>`,
    `${style.dim('Learn')}     agora tutorials · agora tutorial <id>`,
    `${style.dim('Install')}   agora install <id> [--write]`,
    `${style.dim('Setup')}     agora init [--mcp] · agora use <workflow>`,
    `${style.dim('Auth')}      agora login [--api-url <url>]`
  ].join('\n');
  return `\n${banner}\n\n${box}\n\n${hint}\n`;
}

export function header(title: string, meta: string[], style: Styler): string {
  return [style.accent(title), ...meta.map((part) => style.dim(part))].join(style.dim(' · '));
}

export function usage(style: Styler, version: string): string {
  const nameWidth = Math.max(...COMMANDS.map((c) => c.name.length));
  const groups = ['Marketplace', 'Setup', 'Library', 'Learn', 'Community'] as const;

  const lines: string[] = [
    `${style.accent('agora')}${style.dim(` · Developers' CLI marketplace and community hub · v${version}`)}`,
    ''
  ];

  for (const group of groups) {
    const groupCmds = COMMANDS.filter((c) => c.group === group);
    lines.push(style.dim(group));
    for (const cmd of groupCmds) {
      lines.push(`  ${style.accent(cmd.name.padEnd(nameWidth))}  ${style.dim(cmd.summary)}`);
    }
    lines.push('');
  }

  lines.push(style.dim('Run `agora help <command>` for details on any command.'));

  return lines.join('\n');
}
