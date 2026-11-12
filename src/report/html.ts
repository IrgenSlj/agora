// The report as one self-contained HTML file: no scripts, no external assets,
// readable offline, printable. Every value is escaped; commit subjects are
// text written by whoever made the commit.

import type { Report, ReportCommit } from './build.js';

const esc = (s: unknown): string =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  );

const STATE: Record<ReportCommit['state'], { label: string; cls: string }> = {
  valid: { label: 'receipt verifies', cls: 'ok' },
  invalid: { label: 'receipt rejected', cls: 'bad' },
  missing: { label: 'not established', cls: 'unknown' }
};

function commitRow(c: ReportCommit): string {
  const s = STATE[c.state];
  const p = c.predicate;
  const detail = p
    ? [
        `${p.sessions.length} session${p.sessions.length === 1 ? '' : 's'} (${[...new Set(p.sessions.map((x) => x.host))].join(', ')})`,
        `${p.touched.written.items.length} file${p.touched.written.items.length === 1 ? '' : 's'} written`,
        p.denied ? `${p.denied} denied` : '',
        p.canary_hits ? `${p.canary_hits} canary hit${p.canary_hits === 1 ? '' : 's'}` : ''
      ]
        .filter(Boolean)
        .join(' · ')
    : 'made by hand, or the receipt was not pushed';
  const problems = c.problems.length
    ? `<div class="problems">${c.problems.map(esc).join('<br>')}</div>`
    : '';
  return `<tr>
  <td class="mono">${esc(c.sha.slice(0, 12))}</td>
  <td>${esc(c.date.slice(0, 10))}</td>
  <td>${esc(c.subject)}<div class="muted">${esc(detail)}</div>${problems}</td>
  <td><span class="state ${s.cls}">${s.label}</span>${c.level && c.state === 'valid' ? `<div class="muted">signer ${esc(c.level)}</div>` : ''}</td>
</tr>`;
}

export function renderReportHtml(r: Report): string {
  const t = r.totals;
  const range =
    r.since || r.until
      ? `${r.since ? `from ${esc(r.since)}` : ''}${r.since && r.until ? ' ' : ''}${r.until ? `until ${esc(r.until)}` : ''}`
      : 'all history';
  const stat = (n: number | string, label: string, cls = '') =>
    `<div class="stat ${cls}"><div class="n">${esc(n)}</div><div class="l">${esc(label)}</div></div>`;
  const hosts = Object.entries(t.by_host)
    .map(([h, n]) => `${esc(h)} ${n}`)
    .join(' · ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent evidence report · ${esc(r.repository)}</title>
<style>
:root { --bg:#faf8f4; --fg:#2b2620; --muted:#7a7166; --line:#e4ddd2; --ok:#3f7d4e; --bad:#a8432f; --unknown:#8a6d1f; --panel:#f2eee6; }
@media (prefers-color-scheme: dark) { :root { --bg:#1c1a17; --fg:#ece6dc; --muted:#a39a8d; --line:#3a352e; --ok:#7fbf8e; --bad:#e08a75; --unknown:#d9b75e; --panel:#25221e; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 980px; margin: 0 auto; padding: 32px 16px 64px; }
h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 32px 0 8px; }
.muted { color: var(--muted); font-size: 13px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.stats { display:grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; margin-top: 20px; }
.stat { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 12px; }
.stat .n { font-size: 22px; font-weight: 600; } .stat .l { color: var(--muted); font-size: 13px; }
.stat.ok .n { color: var(--ok); } .stat.bad .n { color: var(--bad); } .stat.unknown .n { color: var(--unknown); }
table { width:100%; border-collapse: collapse; } td { border-top: 1px solid var(--line); padding: 10px 8px; vertical-align: top; }
.table { overflow-x: auto; }
.state { font-size: 13px; font-weight: 600; white-space: nowrap; }
.state.ok { color: var(--ok); } .state.bad { color: var(--bad); } .state.unknown { color: var(--unknown); }
.state.ok::before { content: "✓ "; } .state.bad::before { content: "✗ "; } .state.unknown::before { content: "? "; }
.problems { color: var(--bad); font-size: 13px; margin-top: 4px; }
ul { padding-left: 18px; } li { margin: 2px 0; }
footer { margin-top: 40px; color: var(--muted); font-size: 13px; border-top: 1px solid var(--line); padding-top: 12px; }
@media print { body { background: #fff; } .stat { break-inside: avoid; } }
</style>
</head>
<body>
<main>
<h1>Agent evidence report</h1>
<div class="muted">${esc(r.repository)} · ${esc(r.rev)} · ${range} · generated ${esc(r.generated)}</div>

<div class="stats">
${stat(t.commits, 'commits')}
${stat(t.valid, 'receipt verifies', 'ok')}
${stat(t.invalid, 'receipt rejected', t.invalid ? 'bad' : '')}
${stat(t.missing, 'not established', t.missing ? 'unknown' : '')}
${stat(t.sessions, 'agent sessions')}
${stat(t.denied, 'actions denied')}
${stat(t.canary_hits, 'canary hits', t.canary_hits ? 'bad' : '')}
${stat(t.files_written, 'files written by agents')}
</div>

<h2>How the receipts were signed</h2>
<p class="muted">runner-oidc ${t.by_signer['runner-oidc']} · local-keychain ${t.by_signer['local-keychain']} · none ${t.by_signer.none}${hosts ? ` · sessions by host: ${hosts}` : ''}</p>
<p class="muted">A receipt signed <b>none</b> is a self-report: whoever can write git notes could replace it. <b>local-keychain</b> resists an agent confined by its host's sandbox. <b>runner-oidc</b> was signed by a CI runner, outside the developer's machine.</p>

<h2>Policy</h2>
<p class="muted">${t.policies.length ? t.policies.map((p) => (p === 'none' ? 'no agora.cedar' : `<span class="mono">${esc(p.slice(0, 19))}</span>`)).join(' · ') : 'no receipts in range'}</p>

<h2>Commits</h2>
<div class="table"><table>
${r.commits.map(commitRow).join('\n') || '<tr><td class="muted">No commits in range.</td></tr>'}
</table></div>

<h2>Not seen</h2>
${r.not_enforced.length ? `<ul class="muted">${r.not_enforced.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '<p class="muted">No receipts in range, so nothing is known about what agents could not be checked on.</p>'}

<footer>
Built by <span class="mono">agora report</span> from receipts in <span class="mono">refs/notes/agora</span>. A receipt records what an agent's host reported and Agora could check; the list above says what it could not. This report is evidence for review, not a statement of compliance with any law or standard.
</footer>
</main>
</body>
</html>
`;
}
