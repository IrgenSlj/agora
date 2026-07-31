import { readFileSync } from 'node:fs';
import {
  findMarketplaceItem,
  getMarketplaceItems,
  type MarketplaceItem
} from '../../catalog/bundled.js';
import { buildEvidenceBundle } from '../../evidence/bundle.js';
import { createProvenanceResolver } from '../../evidence/resolve-provenance.js';
import { aggregate, divergences } from '../../observe/profile.js';
import { readSessions } from '../../observe/session.js';
import { npmPackageFromCommand, npmPurl } from '../../revocation/installed.js';
import { scanItem } from '../../scan.js';
import { header } from '../format.js';
import {
  detectDataDir,
  numberFlag,
  stringFlag,
  usageError,
  writeJson,
  writeLine
} from '../helpers.js';
import { cliTheme } from '../theme.js';
import type { CommandHandler } from './types.js';

type ExportFormat = 'json' | 'csv' | 'markdown' | 'table';

// Read directly rather than imported from app.ts: app.ts imports this module,
// and the cycle would be resolved by whichever side loaded first.
const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

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
    const name =
      i.name.length > nameW ? i.name.slice(0, nameW - 1) + '\u2026' : i.name.padEnd(nameW);
    return `| ${i.id.padEnd(idW)} | ${name} | ${i.kind.padEnd(4)} | ${i.category.padEnd(catW)} | ${i.author.padEnd(authorW)} | ${String(i.stars ?? 0).padStart(5)} | ${String(i.installs ?? 0).padStart(7)} |`;
  });

  return [hr, hdr, hr, ...rows, hr].join('\n');
}

/**
 * `agora export --attestations <id>` — the evidence for one artifact as an
 * in-toto/DSSE bundle. The rest of this file exports *catalog rows*, which is a
 * different and much older job; this is the one that carries verdicts.
 */
async function exportAttestations(
  parsed: Parameters<CommandHandler>[0],
  io: Parameters<CommandHandler>[1],
  version: string
): Promise<number> {
  const id = parsed.args[0];
  if (!id) {
    return usageError(
      io,
      'export --attestations requires an item id: agora export --attestations <id>'
    );
  }

  const item = findMarketplaceItem(id);
  if (!item) {
    return usageError(io, `Item not found: ${id}. Run \`agora search <query>\` to find one.`);
  }

  const offline = Boolean(parsed.flags.offline);
  const dataDir = detectDataDir(parsed, io);
  const resolveProvenance = createProvenanceResolver({ fetcher: io.fetcher, offline });

  const scan = await scanItem(item, {
    fetcher: io.fetcher,
    githubToken: io.env?.AGORA_GITHUB_TOKEN,
    offline,
    provenance: resolveProvenance
  });

  // Resolved directly rather than read off the scan, for the reason documented
  // in commands/trust.ts: the gate collapses "nothing published" and "could not
  // look" into no row at all, and that difference is the point of an export.
  let provenance: Parameters<typeof buildEvidenceBundle>[0]['evidence']['provenance'];
  if (!item.npmPackage) {
    provenance = undefined;
  } else {
    const evidence = await resolveProvenance(item.npmPackage);
    provenance = evidence
      ? {
          verified: evidence.verified,
          reason: evidence.reason,
          sourceRepo: evidence.source_repo?.replace('https://github.com/', '')
          // No rekorLogIndex: the resolver summary does not carry one, and a
          // transparency-log index is exactly the kind of field that must not
          // be guessed — it is what someone else would use to check us.
        }
      : null;
  }

  let observation: Parameters<typeof buildEvidenceBundle>[0]['evidence']['observation'] = null;
  if (item.npmPackage) {
    const wanted = npmPurl(item.npmPackage);
    const observed = aggregate(readSessions(dataDir)).find(
      (o) => o.key === wanted || npmPackageFromCommand(o.command) === item.npmPackage
    );
    if (observed) {
      observation = {
        sessions: observed.sessions,
        toolCalls: Object.values(observed.toolCalls).reduce((a, b) => a + b, 0),
        networkSampled: observed.networkSampled,
        hostsContacted: observed.hostsContacted,
        divergences: divergences(observed, {})
      };
    }
  }

  const bundle = buildEvidenceBundle({
    version,
    subject: {
      name: item.npmPackage ? npmPurl(item.npmPackage) : `pkg:generic/${item.id}`
      // sha256 is deliberately absent: it comes from agora.lock, and this
      // command does not install. buildEvidenceBundle reports the gap.
    },
    evidence: {
      provenance,
      scan: {
        pass: scan.summary.pass,
        warn: scan.summary.warn,
        fail: scan.summary.fail,
        checks: scan.checks.map((c) => ({
          id: c.name,
          status: c.status,
          detail: c.message
        }))
      },
      observation
    }
  });

  writeJson(io.stdout, bundle);
  return 0;
}

export const commandExport: CommandHandler = async (parsed, io, style) => {
  if (parsed.flags.attestations) {
    return exportAttestations(parsed, io, pkg.version);
  }

  const validFormats: ExportFormat[] = ['json', 'csv', 'markdown', 'table'];
  const flagFormat = stringFlag(parsed, 'format', 'f');
  let positional = parsed.args;
  let format = (flagFormat || 'json') as ExportFormat;
  if (
    !flagFormat &&
    positional.length > 0 &&
    validFormats.includes(positional[0] as ExportFormat)
  ) {
    format = positional[0] as ExportFormat;
    positional = positional.slice(1);
  }
  const query = positional.join(' ');
  const category = stringFlag(parsed, 'category', 'c') || 'all';
  const limit = numberFlag(parsed, 'limit', 'n') || 0;

  if (!validFormats.includes(format)) {
    return usageError(io, `Unknown format "${format}". Use --format json|csv|markdown|table`);
  }

  let items: MarketplaceItem[] = getMarketplaceItems().filter((i) => {
    if (category !== 'all' && i.category !== category) return false;
    if (
      query &&
      !i.id.toLowerCase().includes(query.toLowerCase()) &&
      !i.name.toLowerCase().includes(query.toLowerCase()) &&
      !i.description.toLowerCase().includes(query.toLowerCase())
    )
      return false;
    return true;
  });
  if (limit > 0) items = items.slice(0, limit);

  if (items.length === 0) {
    writeLine(
      io.stdout,
      query
        ? `No items match "${query}". Try a broader query, drop --category, or run \`agora export\` to export everything.`
        : 'No items match the export criteria.'
    );
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

  const theme = cliTheme(style, io);
  if (format === 'markdown') {
    writeLine(io.stdout, header('agora export', [`${items.length} items`, format], theme));
    writeLine(io.stdout, '');
    writeLine(io.stdout, toMarkdown(items));
    return 0;
  }

  writeLine(io.stdout, header('agora export', [`${items.length} items`, format], theme));
  writeLine(io.stdout, '');
  writeLine(io.stdout, toTable(items, style));
  return 0;
};
