import type { Styler } from '../ui.js';

export type CommandGroup = 'Enforce' | 'Record' | 'Check' | 'Setup';

export interface CommandMeta {
  name: string;
  group: CommandGroup;
  summary: string;
  usage: string;
  details?: string;
  flags?: { flag: string; description: string }[];
  examples?: string[];
}

export const COMMANDS: CommandMeta[] = [
  {
    name: 'hook',
    group: 'Enforce',
    summary: 'Deny a revoked MCP tool at the moment an agent calls it',
    usage: 'agora hook install [--dry-run]\nagora hook check',
    details:
      'Installs a Claude Code PreToolUse hook that checks every MCP tool call before it runs. ' +
      'It can only deny or stay silent. It never emits an allow, because that would skip a ' +
      'permission prompt the user would otherwise have seen.\n\n' +
      'Every failure is a non-block: a check that cannot run reports on stderr and lets the ' +
      'call proceed. `agora hook check` is the handler itself; it reads a hook payload on stdin.',
    flags: [
      { flag: '--dry-run', description: 'Print the merged settings.json instead of writing it' }
    ],
    examples: ['agora hook install', 'agora hook install --dry-run']
  },
  {
    name: 'policy',
    group: 'Enforce',
    summary: 'Scaffold, lint and test agora.cedar, the policy file for this repository',
    usage: 'agora policy <init|check|test> [--ci] [--json]',
    details:
      'Policy is evaluated on top of the shipped baseline, which forbids revoked artifacts. ' +
      'A project file can only make that stricter: in Cedar any forbid beats every permit. ' +
      '`check` lints first, because a rule that reads a missing attribute is skipped by Cedar ' +
      'and looks like protection without being it.',
    flags: [
      { flag: '--ci', description: 'Also fail when any decision is inconclusive' },
      { flag: '--json', description: 'Output decisions as JSON' }
    ],
    examples: ['agora policy init', 'agora policy check', 'agora policy test']
  },
  {
    name: 'run',
    group: 'Record',
    summary: 'Run an MCP server through Agora so its tool calls can be recorded',
    usage: 'agora run -- <command…>',
    details:
      'Spawns the real server and forwards stdio byte for byte in both directions. Recording ' +
      'is a tee off that stream and can never alter or delay it: if recording fails, the ' +
      'result is a working server and no data. Tool arguments and results are never stored.',
    examples: ['agora run -- npx -y @modelcontextprotocol/server-filesystem .']
  },
  {
    name: 'observe',
    group: 'Record',
    summary: 'Show recorded MCP activity, and route host configs through `agora run`',
    usage: 'agora observe [status|enable|disable] [--dry-run] [--json]',
    details:
      '`status` reports recorded sessions: tool names and counts and sampled network peers. ' +
      '`enable` rewrites host configs so local servers launch through `agora run --`; ' +
      '`disable` puts every command back. Both show the diff first with --dry-run. ' +
      'Sampling sees only the direct process, so an empty sample means "nothing seen", never ' +
      '"contacted nothing".',
    flags: [
      { flag: '--dry-run', description: 'Show the command diff without writing' },
      { flag: '--json', description: 'Output as JSON' }
    ],
    examples: ['agora observe', 'agora observe enable --dry-run', 'agora observe disable']
  },
  {
    name: 'audit',
    group: 'Check',
    summary: 'Look up every configured MCP server in OSV.dev',
    usage: 'agora audit [--json]',
    details:
      'MCP servers are commands in host configs, not dependencies, so `npm audit` and ' +
      'Dependabot never see them. Servers that cannot be identified as an npm package are ' +
      'reported as unchecked, never counted clean. Exit 1 on a malware, critical or high ' +
      'advisory; exit 3 when OSV is unreachable.',
    flags: [{ flag: '--json', description: 'Output findings as JSON' }],
    examples: ['agora audit', 'agora audit --json']
  },
  {
    name: 'ci',
    group: 'Check',
    summary: 'Check configured MCP servers in CI, with annotations and a job summary',
    usage: 'agora ci [--fail-on-unknown] [--json] [--json-file <path>]',
    details:
      'Read-only: it never starts a configured server. Today it checks published advisories ' +
      'against the servers this repository configures. Receipt verification arrives in a ' +
      'later release. A check that could not run is reported as not established, never as a ' +
      'pass; --fail-on-unknown turns that into exit 3.',
    flags: [
      { flag: '--fail-on-unknown', description: 'Exit 3 when a check could not be established' },
      { flag: '--json', description: 'Output the report as JSON' },
      { flag: '--json-file', description: 'Also write the report to a path' }
    ],
    examples: ['agora ci', 'agora ci --fail-on-unknown']
  },
  {
    name: 'doctor',
    group: 'Setup',
    summary: 'Show what Agora can see and enforce on this machine',
    usage: 'agora doctor [--json]',
    details:
      'Lists detected hosts and their configured MCP servers, whether the hook is installed, ' +
      'whether this repository has an agora.cedar, and any server the bundled revocation list ' +
      'blocks. Informational: exits 0 unless a configured server is revoked.',
    flags: [{ flag: '--json', description: 'Output as JSON' }],
    examples: ['agora doctor', 'agora doctor --json']
  },
  {
    name: 'completions',
    group: 'Setup',
    summary: 'Print a shell completion script for bash, zsh or fish',
    usage: 'agora completions bash|zsh|fish',
    examples: ['eval "$(agora completions bash)"']
  }
];

export function renderManual(meta: CommandMeta, style: Styler): string {
  const lines: string[] = [
    style.accent(meta.name),
    meta.summary,
    '',
    style.dim('Usage:'),
    ...meta.usage.split('\n').map((line) => `  ${line}`)
  ];
  if (meta.flags?.length) {
    const w = Math.max(...meta.flags.map((f) => f.flag.length));
    lines.push('', style.dim('Flags:'));
    for (const f of meta.flags) lines.push(`  ${f.flag.padEnd(w)}  ${style.dim(f.description)}`);
  }
  if (meta.examples?.length) {
    lines.push('', style.dim('Examples:'));
    for (const ex of meta.examples) lines.push(`  ${ex}`);
  }
  if (meta.details) lines.push('', meta.details);
  return lines.join('\n');
}
