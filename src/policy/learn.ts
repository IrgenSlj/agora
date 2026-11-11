// Learn: a minimal policy from what agents actually did.
//
// Input is the allowed actions of verified sessions; output is a block of
// Cedar permits, one per thing seen, generalised only as far as the top-level
// directory of the repository. Anything outside the repository is permitted by
// class and marked as such, so a reviewer sees it stand out. Every rule says
// how often it was seen, so a one-off can be deleted with confidence.

import type { AgentEvent } from '../events/schema.js';

export const BEGIN =
  '// --- agora learn: begin (generated; `agora learn --apply` replaces this block) ---';
export const END = '// --- agora learn: end ---';
const PLACEHOLDER =
  /@id\("placeholder-permit-all"\)\s*\npermit \(principal, action, resource\);\n?/;

interface Seen {
  count: number;
  sessions: Set<string>;
}

const lit = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const likeLit = (prefix: string) => lit(`${prefix.replace(/\*/g, '\\*')}/*`);
const idPart = (s: string) =>
  s
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'root';

function note(seen: Seen): string {
  const s = seen.sessions.size;
  return `// seen ${seen.count} time${seen.count === 1 ? '' : 's'} in ${s} session${s === 1 ? '' : 's'}`;
}

function tally(map: Map<string, Seen>, key: string, session: string): void {
  const seen = map.get(key) ?? { count: 0, sessions: new Set() };
  seen.count++;
  seen.sessions.add(session);
  map.set(key, seen);
}

const merge = (seens: Seen[]): Seen => ({
  count: seens.reduce((a, s) => a + s.count, 0),
  sessions: new Set(seens.flatMap((s) => [...s.sessions]))
});

/** Groups a repository path by its top-level directory; a root file stays itself. */
function pathGroup(path: string): { kind: 'dir' | 'file' | 'class'; key: string } {
  if (path.startsWith('class:')) return { kind: 'class', key: path.slice('class:'.length) };
  const slash = path.indexOf('/');
  return slash > 0 ? { kind: 'dir', key: path.slice(0, slash) } : { kind: 'file', key: path };
}

export interface LearnInput {
  id: string;
  events: readonly AgentEvent[];
}

export function learnPolicy(sessions: readonly LearnInput[]): { block: string; rules: number } {
  const paths = { read: new Map<string, Seen>(), write: new Map<string, Seen>() };
  const programs = new Map<string, Seen>();
  const hosts = new Map<string, Seen>();
  const mcp = new Map<string, Map<string, Seen>>();
  const builtin = new Map<string, Seen>();

  for (const { id, events } of sessions) {
    for (const e of events) {
      if (e.decision !== 'allowed') continue;
      if (e.kind === 'file_read') tally(paths.read, e.subject, id);
      else if (e.kind === 'file_write') tally(paths.write, e.subject, id);
      else if (e.kind === 'exec' && e.subject !== 'unknown') tally(programs, e.subject, id);
      else if (e.kind === 'net') tally(hosts, e.subject.replace(/:\d+$/, ''), id);
      else if (e.kind === 'tool_call') {
        const m = /^mcp:([^/]+)\/(.+)$/.exec(e.subject);
        if (m?.[1] && m[2]) {
          const tools = mcp.get(m[1]) ?? new Map<string, Seen>();
          tally(tools, m[2], id);
          mcp.set(m[1], tools);
        } else if (e.subject.startsWith('tool:') && e.subject !== 'tool:unknown') {
          tally(builtin, e.subject.slice(5), id);
        }
      }
    }
  }

  const rules: string[] = [];
  const rule = (comment: string, id: string, action: string, when: string) =>
    rules.push(
      `${comment}\n@id(${lit(id)})\npermit (principal, action == Action::${lit(action)}, resource)\nwhen { ${when} };`
    );

  for (const action of ['read', 'write'] as const) {
    const groups = new Map<
      string,
      { kind: 'dir' | 'file' | 'class'; key: string; seens: Seen[] }
    >();
    for (const [path, seen] of paths[action]) {
      const g = pathGroup(path);
      const k = `${g.kind}:${g.key}`;
      const entry = groups.get(k) ?? { ...g, seens: [] };
      entry.seens.push(seen);
      groups.set(k, entry);
    }
    for (const g of [...groups.values()].sort(
      (a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key)
    )) {
      const seen = merge(g.seens);
      if (g.kind === 'dir')
        rule(
          note(seen),
          `learn-${action}-${idPart(g.key)}`,
          action,
          `resource.path like ${likeLit(g.key)}`
        );
      else if (g.kind === 'file')
        rule(
          note(seen),
          `learn-${action}-${idPart(g.key)}`,
          action,
          `resource.path == ${lit(g.key)}`
        );
      else
        rule(
          `${note(seen)}\n// OUTSIDE THE REPOSITORY: any ${g.key} path. Review before keeping.`,
          `learn-${action}-outside-${idPart(g.key)}`,
          action,
          `resource.class == ${lit(g.key)}`
        );
    }
  }

  const list = (m: Map<string, Seen>) => [...m.keys()].sort().map(lit).join(', ');
  if (programs.size)
    rule(
      note(merge([...programs.values()])),
      'learn-exec',
      'exec',
      `[${list(programs)}].contains(resource.name)`
    );
  if (hosts.size)
    rule(
      note(merge([...hosts.values()])),
      'learn-connect',
      'connect',
      `[${list(hosts)}].contains(resource.host)`
    );
  for (const server of [...mcp.keys()].sort()) {
    const tools = mcp.get(server) as Map<string, Seen>;
    rule(
      note(merge([...tools.values()])),
      `learn-mcp-${idPart(server)}`,
      'call',
      `resource.mcp && resource.server == ${lit(server)} && [${list(tools)}].contains(resource.name)`
    );
  }
  if (builtin.size)
    rule(
      note(merge([...builtin.values()])),
      'learn-tools',
      'call',
      `!resource.mcp && [${list(builtin)}].contains(resource.name)`
    );

  return { block: [BEGIN, ...rules.flatMap((r) => [r, '']), END].join('\n'), rules: rules.length };
}

/** The policy file with its learned block replaced, or appended, and the placeholder dropped. */
export function applyBlock(current: string | undefined, block: string): string {
  const header =
    '// agora.cedar: what coding agents may do in this repository.\n' +
    '// Anything no rule permits is denied. Rules outside the learned block are yours.\n\n';
  if (current === undefined) return `${header}${block}\n`;
  const withoutPlaceholder = current.replace(PLACEHOLDER, '');
  const start = withoutPlaceholder.indexOf(BEGIN);
  const end = withoutPlaceholder.indexOf(END);
  if (start >= 0 && end > start) {
    return `${withoutPlaceholder.slice(0, start)}${block}${withoutPlaceholder.slice(end + END.length)}`;
  }
  return `${withoutPlaceholder.trimEnd()}\n\n${block}\n`;
}

/** A minimal line diff for review: `-` removed, `+` added, ` ` kept. */
export function lineDiff(before: string, after: string): string[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push(`  ${a[i]}`);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) out.push(`- ${a[i++]}`);
    else out.push(`+ ${b[j++]}`);
  }
  while (i < a.length) out.push(`- ${a[i++]}`);
  while (j < b.length) out.push(`+ ${b[j++]}`);
  return out;
}
