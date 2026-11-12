// A receipt on the terminal (docs/TERMINAL.md): what the sessions did, how it
// was signed, and everything the receipt cannot speak for.

import { headerLine, leader, MEASURE, rule, section, status, wrap } from '../cli/components.js';
import type { Theme } from '../cli/theme.js';
import type { ReceiptPredicate, SignerLevel } from './predicate.js';
import type { ReceiptVerdict } from './verify.js';

const METER: Record<SignerLevel, number> = { none: 0, 'local-keychain': 2, 'runner-oidc': 3 };
const SIGNER: Record<SignerLevel, string> = {
  none: 'a self-report: whoever can push notes can replace it',
  'local-keychain': "this machine's keychain key",
  'runner-oidc': 'sigstore keyless, signed by a CI runner'
};

export interface ReceiptView {
  sha: string;
  subject?: string;
  verdict: ReceiptVerdict;
  /** Files the commit changed that no recorded session wrote. */
  unseen?: string[];
  command?: string;
}

export function renderReceiptView(v: ReceiptView, theme: Theme): string[] {
  const p = v.verdict.predicate as ReceiptPredicate;
  const out: string[] = [''];
  const short = v.sha.slice(0, 12);
  out.push(headerLine(`${v.command ?? 'receipt show'} ${short}`, '', theme), '');
  const kv = (k: string, val: string) => `  ${theme.muted(k.padEnd(8))} ${val}`;
  out.push(kv('commit', `${theme.accent(short)}  ${v.subject ?? ''}`.trimEnd()));

  const level = v.verdict.valid ? v.verdict.level : 'none';
  const signed = level !== 'none';
  const meter = theme.unicode
    ? `${'█'.repeat(METER[level])}${'░'.repeat(3 - METER[level])}`
    : `${'#'.repeat(METER[level])}${'.'.repeat(3 - METER[level])}`;
  const mark = signed
    ? theme.success(`${theme.glyph('signed')} signed`)
    : theme.warning(`${theme.glyph('unsigned')} unsigned`);
  out.push(kv('signer', `${mark}  ${theme.muted(level)}  ${theme.accent(meter)}`));
  out.push(kv('', theme.muted(v.verdict.runner ?? SIGNER[level])));
  out.push(
    kv(
      'policy',
      p.policy_sha256 ? `#${p.policy_sha256.slice(7, 19)}` : theme.muted('no agora.cedar')
    )
  );
  for (const problem of v.verdict.problems) out.push(`  ${status('error', problem, theme)}`);

  const counted = (title: string, items: { items: string[]; truncated: boolean }) => {
    out.push('', section(title, theme, `${items.items.length}${items.truncated ? '+' : ''}`));
    for (const i of items.items) out.push(`  ${i}`);
  };
  out.push('', section('Sessions', theme, String(p.sessions.length)));
  for (const s of p.sessions) {
    const right = s.closed ? 'closed' : 'open';
    out.push(
      `  ${theme.muted(theme.glyph('link'))} ${leader(
        `${s.id.slice(0, 12)} ${theme.muted(s.host)}`,
        `${s.events} events · ${right}`,
        theme,
        MEASURE - 2
      )}`
    );
  }
  if (p.denied || p.canary_hits)
    out.push(
      `  ${status('error', `${p.denied} denied${p.canary_hits ? ` · ${p.canary_hits} canary hit${p.canary_hits === 1 ? '' : 's'}` : ''}`, theme)}`
    );
  counted('Files written', p.touched.written);
  if (p.touched.read.items.length) counted('Files read', p.touched.read);
  if (p.touched.commands.items.length) counted('Programs run', p.touched.commands);
  if (p.touched.peers.items.length) counted('Hosts reached', p.touched.peers);
  if (p.touched.tools.items.length) counted('Tools called', p.touched.tools);

  const unseen = v.unseen ?? [];
  out.push('', section('Not seen', theme, String(unseen.length + p.not_enforced.length)));
  for (const f of unseen)
    out.push(
      `  ${status('unknown', leader(f, theme.muted('in the commit, in no recorded session'), theme, MEASURE - 2), theme)}`
    );
  for (const g of p.not_enforced) {
    const [head, ...rest] = wrap(g, MEASURE - 2);
    out.push(`  ${status('unknown', theme.muted(head ?? ''), theme)}`);
    for (const r of rest) out.push(`    ${theme.muted(r)}`);
  }
  out.push(
    `  ${status('info', theme.muted('This receipt covers what agora recorded. It does not show'), theme)}`,
    `    ${theme.muted('that nothing else happened.')}`
  );

  out.push('', rule(theme));
  const verdict = v.verdict.valid
    ? theme.success(`${theme.glyph('ok')} verifies`)
    : theme.error(`${theme.glyph('fail')} does not verify`);
  const parts = [
    signed
      ? theme.success(`${theme.glyph('signed')} signed`)
      : theme.warning(`${theme.glyph('unsigned')} unsigned`),
    verdict
  ];
  if (unseen.length)
    parts.push(
      theme.unknown(
        `${theme.glyph('unknown')} ${unseen.length} file${unseen.length === 1 ? '' : 's'} not seen`
      )
    );
  out.push(`  ${parts.join(theme.muted(` ${theme.glyph('leader')} `))}`, '');
  return out;
}
