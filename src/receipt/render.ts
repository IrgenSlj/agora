// One way to describe a receipt, shared by the CLI and the CI job summary.

import type { ReceiptPredicate } from './predicate.js';

const list = (c: { items: string[]; truncated: boolean }) =>
  c.items.length ? `${c.items.join(', ')}${c.truncated ? ', …' : ''}` : 'none';

export function receiptLines(p: ReceiptPredicate): string[] {
  const sessions = p.sessions
    .map((s) => `${s.id.slice(0, 8)} (${s.host}, ${s.events} events${s.closed ? ', closed' : ''})`)
    .join(', ');
  return [
    `sessions   ${sessions}`,
    `wrote      ${list(p.touched.written)}`,
    `read       ${list(p.touched.read)}`,
    `ran        ${list(p.touched.commands)}`,
    `reached    ${list(p.touched.peers)}`,
    `mcp        ${p.servers.length ? p.servers.map((s) => `${s.name} (${s.calls})`).join(', ') : 'none'}`,
    `denied     ${p.denied}${p.canary_hits ? ` · canary hits ${p.canary_hits}` : ''}`,
    `policy     ${p.policy_sha256 ? p.policy_sha256.slice(0, 19) : 'no agora.cedar'}`,
    `signer     ${p.signer}`,
    ...p.not_enforced.map((n) => `not seen   ${n}`)
  ];
}
