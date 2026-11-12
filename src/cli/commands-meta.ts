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
    name: 'learn',
    group: 'Enforce',
    summary: 'Propose a minimal agora.cedar from what agents did in this repository',
    usage: 'agora learn [--apply] [--session <id> | --all] [--json]',
    details:
      'Reads the recorded sessions for this repository (only those whose log verifies, and only ' +
      'actions that ran) and proposes one permit per thing seen: paths grouped by top-level ' +
      'directory, programs, hosts, MCP tools per server and built-in tools. Paths outside the ' +
      'repository are permitted by class and flagged for review. Each rule says how often it was ' +
      'seen. Shown as a diff; nothing is written without --apply, which replaces only the ' +
      'learned block and keeps your own rules.',
    flags: [
      { flag: '--apply', description: 'Write the proposal to agora.cedar' },
      { flag: '--session', description: 'Learn from one session' },
      { flag: '--all', description: 'Learn from sessions in every repository' },
      { flag: '--json', description: 'Output as JSON' }
    ],
    examples: ['agora learn', 'agora learn --apply', 'agora replay']
  },
  {
    name: 'plan',
    group: 'Enforce',
    summary: "Show how agora.cedar compiles into each host's settings; write nothing",
    usage: 'agora plan [--json]',
    details:
      'Compiles agora.cedar for Claude Code. The hooks enforce the whole policy: the PreToolUse ' +
      'check denies anything it does not permit, before Claude Code asks. Permits that translate ' +
      'exactly also become permissions.allow rules, so permitted actions stop prompting. Every ' +
      'rule is listed as compiled, enforced by the hook only, or not enforceable because Claude ' +
      'Code cannot see it. Allow rules are only ever copies of permits in agora.cedar. When the ' +
      'repository uses OpenCode (.opencode/ or opencode.json), it also writes a plugin to ' +
      '.opencode/plugins/agora.js that runs the same check before every OpenCode tool call.',
    flags: [{ flag: '--json', description: 'Output as JSON' }],
    examples: ['agora plan', 'agora apply']
  },
  {
    name: 'apply',
    group: 'Enforce',
    summary: 'Write what `agora plan` shows into .claude/settings.json',
    usage: 'agora apply [--json]',
    details:
      'Merges the hooks and compiled allow rules into .claude/settings.json, keeping every other ' +
      'key, hook and allow rule. Agora tracks the rules it wrote in .agora/compiled.json, so a ' +
      'permit removed from agora.cedar is removed from settings on the next apply, and nothing ' +
      'a person wrote is. Commit both files.',
    flags: [{ flag: '--json', description: 'Output as JSON' }],
    examples: ['agora apply']
  },
  {
    name: 'policy',
    group: 'Enforce',
    summary: 'Scaffold and validate agora.cedar, what agents may do in this repository',
    usage: 'agora policy <init|check> [--json]',
    details:
      'agora.cedar holds Cedar rules over agent actions: read and write on File, exec on ' +
      'Program, connect on Peer, call on Tool. With it present, anything no rule permits is ' +
      'denied. The shipped baseline is always added and only forbids (revoked MCP servers). ' +
      '`check` validates the file strictly against the schema, so a rule reading an attribute ' +
      'that does not exist fails here rather than silently never firing. Start a real policy ' +
      'with `agora learn`, and test a change with `agora replay`.',
    flags: [{ flag: '--json', description: 'Output as JSON' }],
    examples: ['agora policy init', 'agora policy check']
  },
  {
    name: 'replay',
    group: 'Enforce',
    summary: 'Report what a policy would have denied in sessions that already ran',
    usage: 'agora replay [--policy <file>] [--session <id> | --all] [--json]',
    details:
      "Evaluates every action that actually ran in this repository's recorded sessions " +
      'against a policy (default agora.cedar) and the baseline, and groups what it would have ' +
      'denied. Sessions whose log does not verify are skipped and named. Exits 1 when anything ' +
      'would have been denied, or when a rule was skipped on error.',
    flags: [
      { flag: '--policy', description: 'Policy file to replay (default agora.cedar)' },
      { flag: '--session', description: 'Replay one session' },
      { flag: '--all', description: 'Replay sessions from every repository' },
      { flag: '--json', description: 'Output as JSON' }
    ],
    examples: ['agora replay', 'agora replay --policy stricter.cedar']
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
    name: 'log',
    group: 'Record',
    summary: 'List, show and verify the hash-chained session logs',
    usage: 'agora log [list|show|verify] [<session>] [--all] [--json]',
    details:
      'Each agent session is one append-only log in which every event carries the hash of the one ' +
      'before it. `verify` recomputes the chain; any changed byte fails it. A closed session also ' +
      'records its final hash, so events removed from the end fail too; an open session cannot ' +
      'detect that, and says so. Events hold tool names, paths, program names and network peers, ' +
      'never arguments, results, prompts or file contents. Exits 1 when a log does not verify.',
    flags: [
      { flag: '--all', description: 'Verify every recorded session' },
      { flag: '--json', description: 'Output as JSON' }
    ],
    examples: ['agora log', 'agora log show', 'agora log verify --all']
  },
  {
    name: 'receipt',
    group: 'Check',
    summary: 'Write, show and verify the receipt that says how agents produced a commit',
    usage:
      'agora receipt write [<commit>] [--dry-run] [--no-sign]\n' +
      'agora receipt show [<commit>]\n' +
      'agora receipt verify [<commit>] [--trusted-from <rev>] [--fail-on-unknown]',
    details:
      'A receipt is an in-toto statement about one commit, stored as a git note under ' +
      'refs/notes/agora. It names the agent sessions that ran in this repository between the ' +
      'parent commit and this one, the hash of each session log at that point, and what they ' +
      'touched: files written and read, programs run, hosts reached, MCP tools called and ' +
      'calls denied. It also states what the host could not see. Never arguments or contents.\n\n' +
      'A receipt states its signer level. `none` is a self-reported log that an agent with ' +
      'shell access could forge. A signed level verifies only against keys listed in ' +
      '.agora/signers.json at --trusted-from (default HEAD; CI uses the pull request base). ' +
      'Push receipts with `git push origin refs/notes/agora`. `write` refuses a log that does ' +
      'not verify. `verify` exits 1 on an invalid receipt; a missing one is not established.',
    flags: [
      { flag: '--dry-run', description: 'Print the receipt instead of writing the note' },
      { flag: '--no-sign', description: 'Write an unsigned receipt' },
      { flag: '--trusted-from', description: 'Read trusted keys from this revision' },
      { flag: '--fail-on-unknown', description: 'Exit 3 when the commit has no receipt' },
      { flag: '--json', description: 'Output as JSON' }
    ],
    examples: [
      'agora receipt write',
      'agora receipt show HEAD~1',
      'git push origin refs/notes/agora'
    ]
  },
  {
    name: 'canary',
    group: 'Setup',
    summary: 'Plant a decoy credential file that no agent task should touch',
    usage: 'agora canary [status|install|remove] [--file <path>] [--tool] [--json]',
    details:
      '`install` writes fake credentials to .env.production.local (or --file) and hides it from ' +
      'git through .git/info/exclude. The hook denies any tool call that reads or writes it, or ' +
      'any shell command that names it, and records a canary event; receipts count hits and ' +
      '`agora ci` fails on them. A program that opens the file without naming it is not seen. ' +
      '`--tool` also offers a decoy MCP tool, deploy-vault/get_deploy_credentials: registered ' +
      'for you alone in ~/.claude.json for this repository, and by the OpenCode plugin.',
    flags: [
      { flag: '--tool', description: 'Also offer a decoy tool to the agent' },
      { flag: '--file', description: 'Where to plant the decoy, relative to the repository' },
      { flag: '--json', description: 'Output as JSON' }
    ],
    examples: ['agora canary install --tool', 'agora canary status', 'agora canary remove']
  },
  {
    name: 'signer',
    group: 'Setup',
    summary: 'Create and trust the key that signs receipts on this machine',
    usage: 'agora signer [status|init|trust] [--name <label>] [--json]',
    details:
      '`init` creates an ed25519 key in the OS keystore (macOS Keychain, or the Linux Secret ' +
      'Service through secret-tool) and nowhere else. `trust` adds its public key to ' +
      '.agora/signers.json in this repository; commit that file. With a key, `agora receipt ' +
      'write` signs at level local-keychain: an agent confined by the host sandbox could not have ' +
      'rewritten and re-signed the log. Without a keystore, receipts stay unsigned and say so.',
    flags: [
      { flag: '--name', description: 'Label for the key in .agora/signers.json' },
      { flag: '--json', description: 'Output as JSON' }
    ],
    examples: ['agora signer init', 'agora signer trust --name laptop', 'agora signer status']
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
