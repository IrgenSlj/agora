import { getMarketplaceItems, type MarketplaceItem } from '../../marketplace.js';
import { searchMarketplaceSource } from '../../live.js';
import {
  stringFlag,
  numberFlag,
  sourceOptions,
  warnFallback,
  writeLine,
  writeJson,
  usageError
} from '../helpers.js';
import { header } from '../format.js';
import type { CommandHandler } from './types.js';

type ExportFormat = 'json' | 'csv' | 'markdown' | 'table';

function toCsv(items: MarketplaceItem[]): string {
  const headerRow = 'id,name,kind,category,author,stars,installs,tags,description';
  const rows = items.map((i) => {
    const fields = [
      escapeCsv(i.id),
      escapeCsv(i.name),
      i.kind,
      i.category,
      escapeCsv(i.author),
      String(i.stars ?? 0),
      String(i.installs ?? 0),
      escapeCsv((i.tags ?? []).join(';')),
      escapeCsv(i.description)
    ];
    return fields.join(',');
  });
  return [headerRow, ...rows].join('\n');
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toMarkdown(items: MarketplaceItem[]): string {
  const lines: string[] = ['| id | name | kind | category | author | stars | installs | tags |'];
  lines.push('|' + ['---', '---', '---', '---', '---', '---', '---', '---'].join('|') + '|');
  for (const i of items) {
    lines.push(
      `| ${i.id} | ${escapeMd(i.name)} | ${i.kind} | ${i.category} | ${escapeMd(i.author)} | ${i.stars ?? 0} | ${i.installs ?? 0} | ${(i.tags ?? []).join(', ')} |`
    );
  }
  return lines.join('\n');
}

function escapeMd(value: string): string {
  return value.replace(/\|/g, '\\|');
}

function toTable(items: MarketplaceItem[], _style: unknown): string {
  const idW = Math.max(4, ...items.map((i) => i.id.length));
  const nameW = Math.max(4, ...items.map((i) => i.name.length));
  const catW = Math.max(8, ...items.map((i) => i.category.length));
  const authorW = Math.max(6, ...items.map((i) => i.author.length));

  const hr = `+-${'-'.repeat(idW)}-+-${'-'.repeat(nameW)}-+-${'-'.repeat(4)}-+-${'-'.repeat(catW)}-+-${'-'.repeat(authorW)}-+-${'-'.repeat(6)}-+-${'-'.repeat(8)}-+`;
  const hdr = `| ${'id'.padEnd(idW)} | ${'name'.padEnd(nameW)} | kind | ${'category'.padEnd(catW)} | ${'author'.padEnd(authorW)} | stars | installs |`;

  const rows = items.map((i) => {
    const name = i.name.length > nameW ? i.name.slice(0, nameW - 1) + '\u2026' : i.name.padEnd(nameW);
    return `| ${i.id.padEnd(idW)} | ${name} | ${i.kind.padEnd(4)} | ${i.category.padEnd(catW)} | ${i.author.padEnd(authorW)} | ${String(i.stars ?? 0).padStart(5)} | ${String(i.installs ?? 0).padStart(7)} |`;
  });

  return [hr, hdr, hr, ...rows, hr].join('\n');
}

export const commandExport: CommandHandler = async (parsed, io, style) => {
  const format = (stringFlag(parsed, 'format', 'f') || 'json') as ExportFormat;
  const query = parsed.args.join(' ');
  const category = stringFlag(parsed, 'category', 'c') || 'all';
  const limit = numberFlag(parsed, 'limit', 'n') || 0;

  const validFormats: ExportFormat[] = ['json', 'csv', 'markdown', 'table'];
  if (!validFormats.includes(format)) {
    return usageError(io, `Unknown format "${format}". Use --format json|csv|markdown|table`);
  }

  let items: MarketplaceItem[];

  if (parsed.flags.api || parsed.flags.live) {
    const result = await searchMarketplaceSource({
      ...(await sourceOptions(parsed, io)),
      query,
      category,
      limit: limit || 1000
    });
    items = result.data;
    warnFallback(result, io);
  } else {
    items = getMarketplaceItems()
      .filter((i) => {
        if (category !== 'all' && i.category !== category) return false;
        if (query && !i.id.toLowerCase().includes(query.toLowerCase()) && !i.name.toLowerCase().includes(query.toLowerCase()) && !i.description.toLowerCase().includes(query.toLowerCase())) return false;
        return true;
      });
    if (limit > 0) items = items.slice(0, limit);
  }

  if (items.length === 0) {
    writeLine(io.stdout, 'No items match the export criteria.');
    return 0;
  }

  if (format === 'json') {
    writeJson(io.stdout, { count: items.length, items });
    return 0;
  }

  if (format === 'csv') {
    writeLine(io.stdout, toCsv(items));
    return 0;
  }

  if (format === 'markdown') {
    writeLine(io.stdout, header('agora export', [`${items.length} items`, format], style));
    writeLine(io.stdout, '');
    writeLine(io.stdout, toMarkdown(items));
    return 0;
  }

  writeLine(io.stdout, header('agora export', [`${items.length} items`, format], style));
  writeLine(io.stdout, '');
  writeLine(io.stdout, toTable(items, style));
  return 0;
};
