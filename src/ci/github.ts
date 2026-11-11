// Rendering the report into the two surfaces GitHub Actions actually reads.
//
// Annotations (`::error::`) put a finding on the pull request itself, next to
// the file that configures the offending server, where somebody will see it
// without opening a log. The job summary puts the whole verdict on the run page.
// Both are plain stdout/file protocols with no dependency and no SDK, which is
// the only reason a tool this size can afford to support them at all.
//
// Everything here is inert outside Actions: no annotation is emitted unless
// GITHUB_ACTIONS is set, so local runs stay readable.

import { appendFileSync } from 'node:fs';
import type { CiCheck, CiFinding, CiReport } from './report.js';

/** Actions parses `::` directives out of stdout; these characters would end one early. */
function escapeData(s: string): string {
  return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function escapeProp(s: string): string {
  return escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

export function isGithubActions(env: Record<string, string | undefined> | undefined): boolean {
  return env?.GITHUB_ACTIONS === 'true';
}

/**
 * One annotation per finding. `file=` is set when the finding names a host
 * config, which is what makes the annotation land somewhere navigable rather
 * than at the top of the run.
 */
export function annotationsFor(report: CiReport): string[] {
  const lines: string[] = [];

  for (const check of report.checks) {
    const level = check.state === 'fail' ? 'error' : check.state === 'pass' ? undefined : 'warning';
    if (!level) continue;

    for (const f of check.findings) {
      const props: string[] = [`title=${escapeProp(f.title)}`];
      if (f.where) props.push(`file=${escapeProp(f.where)}`);
      const detail = f.url ? `${f.detail} (${f.url})` : f.detail;
      lines.push(`::${level} ${props.join(',')}::${escapeData(detail)}`);
    }

    // A check can fail or degrade with no individual findings — an unreachable
    // OSV with nothing configured, say. Say so rather than emitting silence.
    if (!check.findings.length) {
      lines.push(`::${level} title=${escapeProp(check.name)}::${escapeData(check.summary)}`);
    }
  }

  return lines;
}

const GLYPH: Record<CiCheck['state'], string> = {
  pass: '✅',
  fail: '❌',
  not_established: '❔',
  unavailable: '⚠️'
};

const LABEL: Record<CiCheck['state'], string> = {
  pass: 'pass',
  fail: 'fail',
  not_established: 'not established',
  unavailable: 'unavailable'
};

const QUESTION: Record<CiCheck['name'], string> = {
  receipts: 'Was each commit made within policy?',
  advisories: 'Does any configured MCP server have a published advisory?'
};

export function jobSummary(report: CiReport): string {
  const rows = report.checks.map(
    (c) =>
      `| ${GLYPH[c.state]} ${LABEL[c.state]} | **${c.name}** — ${QUESTION[c.name]} | ${c.summary} |`
  );

  const out = [
    '## Agora',
    '',
    !report.ok
      ? report.failed.includes('receipts')
        ? 'A commit in this change carries a receipt that does not verify.'
        : 'A configured MCP server has a blocking advisory.'
      : report.notEstablished.length || report.unavailable.length
        ? // Not "all clear". A run with an unanswerable question in it has not
          // earned that sentence, and this is the surface most likely to be read
          // as a guarantee — it is the one thing on the run page.
          `Nothing failed. ${[...report.notEstablished, ...report.unavailable].join(', ')} could not be checked — that is not the same as clean.`
        : 'No known blocking advisories. That is not the same as safe.',
    '',
    '| | Check | Result |',
    '| --- | --- | --- |',
    ...rows,
    ''
  ];

  if (report.receipts.length) {
    out.push('### Receipts', '');
    for (const c of report.receipts) {
      const head =
        c.state === 'valid'
          ? `✅ \`${c.sha.slice(0, 12)}\` receipt verifies · signer ${c.level}`
          : c.state === 'invalid'
            ? `❌ \`${c.sha.slice(0, 12)}\` receipt rejected: ${c.problems.join('; ')}`
            : `❔ \`${c.sha.slice(0, 12)}\` no receipt (not established)`;
      out.push(`<details><summary>${head}</summary>`, '');
      if (c.lines.length) out.push('```', ...c.lines, '```');
      out.push('', '</details>', '');
    }
  }

  const detailed = report.checks.filter((c) => c.state !== 'pass' && c.findings.length);
  if (detailed.length) {
    out.push('### Findings', '');
    for (const check of detailed) {
      for (const f of check.findings) {
        const link = f.url ? ` — [details](${f.url})` : '';
        const where = f.where ? ` \`${f.where}\`` : '';
        out.push(`- **${f.title}**${where} — ${f.detail}${link}`);
      }
    }
    out.push('');
  }

  if (report.notEstablished.length) {
    out.push(
      '> A check that is *not established* has not passed. It means Agora could not ask the ' +
        'question, most often because a commit has no receipt. Use `--fail-on-unknown` to treat ' +
        'that as a failure.',
      ''
    );
  }

  return out.join('\n');
}

/** Best-effort: a summary that cannot be written must never fail the step. */
export function writeJobSummary(
  env: Record<string, string | undefined> | undefined,
  report: CiReport
): boolean {
  const path = env?.GITHUB_STEP_SUMMARY;
  if (!path) return false;
  try {
    appendFileSync(path, `${jobSummary(report)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

export type { CiFinding };
