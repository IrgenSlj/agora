import type { CommandMeta } from './types.js';

export const COMMANDS: CommandMeta[] = [
  {
    name: 'observe',
    group: 'Stack',
    summary: 'See recorded MCP activity and sampled peers, and switch observation on across hosts',
    usage: 'agora observe [status|enable|disable] [--dry-run] [--json]',
    details:
      'Observation records bounded evidence in the real environment, rather than a one-shot ' +
      'sandbox run a server could detect. status (default) reports recorded sessions: tool ' +
      'names and counts, advertised tools, and sampled network peers. enable rewrites every ' +
      'host config so servers launch through `agora run --`, which is what makes observation ' +
      'something you switch on rather than wire by hand; disable puts every command back ' +
      'exactly as it was. Both plan first — run with --dry-run to see the diff. Remote servers ' +
      'and Agora itself are skipped with a reason. NEVER recorded: tool arguments, results, ' +
      'prompt text, or anything derived from them — nothing leaves the machine. Network ' +
      'sampling polls the direct process, so short-lived or descendant-only connections may not ' +
      'be seen; unavailable sampling stays unknown, and an empty successful sample means only ' +
      '"no peers seen while sampling".',
    flags: [
      { flag: '--dry-run', description: 'Show the command diff without writing' },
      { flag: '--json', description: 'Output as JSON' }
    ],
    examples: [
      'agora observe',
      'agora observe enable --dry-run',
      'agora observe enable',
      'agora observe disable'
    ]
  },
  {
    name: 'run',
    group: 'Stack',
    summary: 'Run an MCP server through Agora so bounded runtime evidence can be recorded',
    usage: 'agora run -- <command…>',
    details:
      'The supervising shim. Spawns the real server, forwards stdio byte-for-byte in both ' +
      'directions, and propagates its exit code and signals. Observation is a tee off that ' +
      'stream and can never alter or delay it — if anything in the observation layer fails, the ' +
      'result is a perfectly working server and no data. Normally invoked by your host config ' +
      'rather than by hand.',
    flags: [],
    examples: ['agora run -- npx @modelcontextprotocol/server-filesystem']
  },
  {
    name: 'audit',
    group: 'Stack',
    summary: 'Check your configured MCP servers against published security advisories',
    usage: 'agora audit [--json]',
    details:
      'Reads every MCP server configured across your hosts and looks each one up in OSV.dev, ' +
      'the free public vulnerability database. This is a surface no other tool covers: MCP ' +
      'servers are spawned commands in host configs, not dependencies, so they appear in no ' +
      'package.json and `npm audit`, Dependabot and Snyk cannot see them by construction. ' +
      'Exit codes: 0 nothing blocking, 1 a MALWARE/CRITICAL/HIGH advisory was found. Servers ' +
      'that cannot be identified as an npm package (remote, or a custom launcher) are reported ' +
      'as unchecked rather than counted clean, and an unreachable OSV is reported as unreachable ' +
      '— "no known advisories" means only what has been published, never "safe".',
    flags: [{ flag: '--json', description: 'Output findings as JSON' }],
    examples: ['agora audit', 'agora audit --json']
  },
  {
    name: 'ci',
    group: 'Stack',
    summary: 'Answer the whole post-install question once, with an exit code',
    usage: 'agora ci [--fail-on-unknown] [--json]',
    details:
      'Runs the three checks that together mean "nothing I trusted has changed": published ' +
      'advisories against the servers you actually run, lockfile drift against what you ' +
      'approved, and whether the stack still resolves. Read-only — it never starts a ' +
      "configured server, because a CI runner executing a stranger's processes on a pull " +
      'request is worse than anything this command could report. Under GitHub Actions it also ' +
      'emits annotations on the offending host config and writes a job summary. Exit codes: 0 ' +
      'nothing failed, 1 a blocking advisory or drift, 3 OSV unreachable. A check Agora could ' +
      'not perform is reported as not established, never as a pass; `--fail-on-unknown` turns ' +
      'that absence into a failure.',
    flags: [
      {
        flag: '--fail-on-unknown',
        description: 'Exit 1 when a check could not be established (e.g. no agora.lock)'
      },
      { flag: '--json', description: 'Output the full CiReport as JSON' },
      {
        flag: '--json-file',
        description: 'Also write the CiReport to a path, leaving stdout for humans and annotations'
      }
    ],
    examples: [
      'agora ci',
      'agora ci --fail-on-unknown',
      'agora ci --json',
      'agora ci --json-file agora-ci.json'
    ]
  },
  {
    name: 'hook',
    group: 'Stack',
    summary: 'Block a revoked or drifted MCP tool at the moment it is called',
    usage: 'agora hook install [--dry-run]\nagora hook check',
    details:
      'Installs a Claude Code PreToolUse hook that checks every MCP tool call against the ' +
      'revocation feed and your approved baseline before it runs. This is the only surface where ' +
      'Agora stops something rather than reporting it, and it runs on your machine with no ' +
      'service to operate.\n\n' +
      'It can only block. It never emits an allow decision, because that would bypass the ' +
      'permission prompt Claude Code would otherwise have shown you — and "no known red flags" ' +
      'is not a permission the user granted.\n\n' +
      'Every failure is a non-block. A check that cannot run reports on stderr and lets the call ' +
      'proceed: a security tool that breaks the agent gets uninstalled, and an uninstalled ' +
      'tripwire protects nobody.\n\n' +
      '`agora hook check` is the handler itself. It reads a PreToolUse payload on stdin and is ' +
      'not meant to be run by hand.',
    flags: [
      { flag: '--dry-run', description: 'Print the merged settings.json instead of writing it' }
    ],
    examples: ['agora hook install', 'agora hook install --dry-run']
  },
  {
    name: 'approve',
    group: 'Stack',
    summary: 'Review install intents and re-run the gate before acting',
    usage: 'agora approve [id] [--deny] [--tool <host>] [--dry-run] [--json]',
    details:
      'An agent-facing request records intent without changing host configuration. This command ' +
      'is the human-oriented review path, but a terminal alone is not a strong authorization ' +
      'boundary when an agent also has shell access; use it only after personally reviewing the ' +
      'request. With no id, lists what is ' +
      'pending. With an id, shows the request and then runs the full acquire gate: scan, policy, ' +
      'revocation. The evidence the agent saw is displayed for context and never used as the ' +
      'decision, because a request may be hours old and an allow computed against stale evidence ' +
      'is not an allow. A blocked request stays pending rather than being discarded.',
    flags: [
      { flag: '--deny', description: 'Discard the request without installing' },
      { flag: '--tool', description: 'Override the target host the agent named' },
      { flag: '--dry-run', description: 'Run the gate and report, but write nothing' },
      { flag: '--json', description: 'Output pending requests as JSON' }
    ],
    examples: ['agora approve', 'agora approve k7m2xq', 'agora approve k7m2xq --deny']
  },
  {
    name: 'quarantine',
    group: 'Stack',
    summary: 'List servers held back after their tool descriptions changed',
    usage: 'agora quarantine [list] [--json]',
    details:
      'A server is quarantined when `agora doctor --probe` finds its advertised tools no longer ' +
      'match the baseline you approved — the rug-pull shape Agora exists to catch. Quarantined ' +
      'servers are skipped by `agora sync` and `agora apply` so they are never silently ' +
      'reintroduced from agora.toml. Exits 1 when anything is quarantined, so CI can gate on it. ' +
      'An empty list means no probe has caught a change; it is not proof of good behaviour.',
    flags: [{ flag: '--json', description: 'Output as JSON' }],
    examples: ['agora quarantine', 'agora quarantine list --json']
  },
  {
    name: 'unquarantine',
    group: 'Stack',
    summary: 'Release a quarantined server, accepting its changed tool descriptions',
    usage: 'agora unquarantine <name> --accept-risk [--json]',
    details:
      'Approves the drifted tool descriptions as the new baseline and re-enables the server. ' +
      '--accept-risk is required: releasing means accepting a change that was made to a server ' +
      'after you approved it. Inspect the drift with `agora doctor --probe` first. ' +
      'Run `agora sync` afterwards to write it back to your hosts.',
    flags: [
      { flag: '--accept-risk', description: 'Required. Accept the changed tool descriptions' },
      { flag: '--json', description: 'Output as JSON' }
    ],
    examples: ['agora unquarantine my-server --accept-risk']
  },
  {
    name: 'remove',
    group: 'Stack',
    summary: 'Remove an entry from agora.toml',
    usage: 'agora remove <name> [--dry-run] [--json]',
    details:
      'Removes the entry from your agora.toml profile. Agora is declarative: agora.toml is the ' +
      'source of truth and host configs are reconciled to it, so this does not touch host ' +
      'configs directly. Run `agora plan` to preview and `agora apply --prune` to propagate ' +
      'the removal.',
    flags: [
      { flag: '--dry-run', description: 'Show what would be removed without writing' },
      { flag: '--json', description: 'Output as JSON' }
    ],
    examples: ['agora remove my-server', 'agora remove my-server --dry-run']
  },
  {
    name: 'policy',
    group: 'Stack',
    summary: 'Scaffold, check, and test your Cedar policy over installed servers',
    usage: 'agora policy <init|check|test> [--ci] [--json]',
    details:
      'Policy is evaluated on top of the shipped baseline, which already forbids revoked ' +
      'artifacts, tripped canaries, and installing something whose evidence critically ' +
      'contradicts its claims. A project file can only make that stricter — Cedar is ' +
      'order-independent and any forbid beats every permit. `check` lints first: a rule that ' +
      'reads a missing attribute is skipped by Cedar and silently evaluates to allow, so an ' +
      'unguarded forbid looks like protection without being it. Register files under [policy] ' +
      'in agora.toml.',
    flags: [
      { flag: '--ci', description: 'Also fail when any decision is inconclusive' },
      { flag: '--json', description: 'Output decisions as JSON' }
    ],
    examples: [
      'agora policy init',
      'agora policy check',
      'agora policy check --ci',
      'agora policy test'
    ]
  },
  {
    name: 'try',
    group: 'Stack',
    summary: 'Ephemeral test-drive an MCP server without saving any config',
    usage: 'agora try <id> [--timeout <ms>] [--skip-scan] [--accept-risk] [--json]',
    details:
      'Spawns the MCP server for the given catalog item, performs a real MCP ' +
      'initialize + tools/list handshake over stdio, reports the server name and tools, ' +
      'then kills the process — without writing any configuration file. ' +
      "A try-run executes the server's code, so it passes the same gate as an install: " +
      'revocation and Cedar policy always decide, and a scan that was skipped or could not ' +
      'run leaves an explicit unknown that only --accept-risk clears. Use --timeout to ' +
      'override the default 15-second probe window. Returns exit code 1 if the probe fails ' +
      'or the gate refuses.',
    flags: [
      { flag: '--timeout', description: 'Probe timeout in milliseconds (default 15000)' },
      {
        flag: '--skip-scan',
        description: 'Do not run the heuristic scan; the gate then has an explicit unknown'
      },
      {
        flag: '--accept-risk',
        description: 'Run it although the scan never ran. Recorded in the local gate audit log'
      },
      {
        flag: '--json',
        description: 'Output { item, command, scan, authorization, probe } as JSON'
      }
    ],
    examples: ['agora try mcp-github', 'agora try mcp-filesystem --timeout 20000']
  },
  {
    name: 'capabilities',
    group: 'Stack',
    summary: 'List and search MCP tools discovered across configured servers',
    usage: 'agora capabilities [query] [--server <name>] [--json]',
    details:
      'Reads the local capability cache (populated by `agora doctor --probe` or `agora try`) ' +
      'and lists every MCP tool exposed by your configured servers. ' +
      'Provide a query to rank results with BM25 — "which of my servers can do X". ' +
      'Use --server to filter to a single server (case-insensitive exact match, else substring).',
    flags: [
      { flag: '--server', description: 'Filter to a specific server (exact or substring match)' },
      { flag: '--json', description: 'Output as JSON: { query, server, results, summary }' }
    ],
    examples: [
      'agora capabilities',
      'agora capabilities "query a database"',
      'agora capabilities --server github'
    ]
  },
  {
    name: 'installed',
    group: 'Stack',
    summary: 'List MCP servers configured across all agent tools',
    usage: 'agora installed [--tool <id>] [--json]',
    details:
      'Reads configuration files for all supported agent tools (opencode, claude-code, cursor, windsurf) ' +
      'and lists every MCP server found. Servers configured in multiple tools or scopes are grouped ' +
      'by name. Use --tool to filter to a single agent tool. When no servers are found, detected tools ' +
      'are reported and hints to `agora search` / `agora install` are shown.',
    flags: [
      {
        flag: '--tool',
        description: 'Filter to a single tool: opencode, claude-code, cursor, or windsurf'
      },
      { flag: '--json', description: 'Output as JSON: { servers, tools, summary }' }
    ],
    examples: [
      'agora installed',
      'agora installed --tool opencode',
      'agora installed --tool cursor --json'
    ]
  },
  {
    name: 'update',
    group: 'Stack',
    summary: 'Check and apply npm version bumps for installed MCP servers',
    usage: 'agora update [server] [--tool <id>] [--scope project|user] [--write --yes] [--json]',
    details:
      'Reads configured MCP servers across supported agent tools, resolves each pinned npm ' +
      'package in local server commands, and reports whether a newer npm version is available. ' +
      'Servers using a dist-tag, an unpinned package, a remote URL, or an unresolvable command are ' +
      'reported without writing anything. By default this is a dry-run; pass --write --yes to apply ' +
      'version bumps to the selected scope while preserving unrelated config keys. Local capability ' +
      'cache drift or quarantine blocks the check before npm lookup or host writes and exits 1.',
    flags: [
      {
        flag: '--tool',
        description: 'Filter to a single tool: opencode, claude-code, cursor, or windsurf'
      },
      {
        flag: '--scope',
        description: 'Config scope to write: project (default) or user'
      },
      {
        flag: '--write',
        description: 'Enable write mode (must be combined with --yes)'
      },
      {
        flag: '--yes',
        description: 'Confirm write (required when --write is set)'
      },
      { flag: '--json', description: 'Output { mode, entries, summary } as JSON' }
    ],
    examples: [
      'agora update',
      'agora update --json',
      'agora update my-server',
      'agora update --tool opencode',
      'agora update --write --yes'
    ]
  },
  {
    name: 'doctor',
    group: 'Stack',
    summary: 'Health-check configured MCP servers across all agent tools',
    usage: 'agora doctor [--tool <id>] [--probe] [--strict] [--json]',
    details:
      'Checks each configured MCP server for common problems: missing binary, invalid remote URL, ' +
      'all instances disabled, conflicting definitions across tools/scopes. ' +
      'Use --probe to briefly start each local server, verify it launches, and compare its tool ' +
      'schemas against the approved baseline; drift is printed and quarantined by disabling/removing ' +
      'the affected host config entry. ' +
      'Returns exit code 0 by default (informational); use --strict to return 1 when any server has errors.',
    flags: [
      {
        flag: '--tool',
        description: 'Filter to a single tool: opencode, claude-code, cursor, or windsurf'
      },
      {
        flag: '--probe',
        description:
          'Briefly start each local server, refresh capability data, and quarantine schema drift'
      },
      {
        flag: '--strict',
        description: 'Exit 1 if any server has errors (for CI/scripting)'
      },
      { flag: '--json', description: 'Output StackHealth object as JSON' }
    ],
    examples: [
      'agora doctor',
      'agora doctor --tool opencode',
      'agora doctor --strict',
      'agora doctor --json',
      'agora doctor --probe --strict'
    ]
  },
  {
    name: 'freeze',
    group: 'Stack',
    summary: 'Snapshot your MCP stack into an agora.toml manifest',
    usage: 'agora freeze [--tool <id>] [--write] [--out <path>] [--force] [--json]',
    details:
      'Reads all configured MCP servers across supported agent tools and emits an agora.toml ' +
      'stack manifest. Without --write the serialized TOML is printed to stdout (safe preview). ' +
      'With --write the manifest is written to agora.toml in the current directory (or --out). ' +
      'Refuses to overwrite an existing file unless --force is passed. ' +
      'Environment values are never copied; named references are emitted and resolved from the ' +
      'local environment during plan/apply. ' +
      'When a server name appears in multiple tools the first occurrence wins and a warning is emitted.',
    flags: [
      {
        flag: '--tool',
        description: 'Filter to a single tool: opencode, claude-code, cursor, or windsurf'
      },
      { flag: '--write', description: 'Write the manifest to disk (default: print to stdout)' },
      { flag: '--out', description: 'Override the output path (default: agora.toml in cwd)' },
      { flag: '--force', description: 'Overwrite an existing agora.toml without prompting' },
      { flag: '--json', description: 'Output the manifest as JSON instead of TOML' }
    ],
    examples: [
      'agora freeze',
      'agora freeze --write',
      'agora freeze --write --force',
      'agora freeze --tool opencode',
      'agora freeze --out ~/my-stack.toml --write',
      'agora freeze --json'
    ]
  },
  {
    name: 'sync',
    group: 'Stack',
    summary: "Reconcile your agora.toml manifest into each agent tool's config (plan && apply)",
    usage:
      'agora sync [--from <url|path>] [--tool <id>] [--scope project|user] [--prune] [--write --yes] [--json]',
    details:
      'Reads the agora.toml manifest (created by `agora freeze --write`) and reconciles its MCP ' +
      'server entries AND managed instruction artifacts (CLAUDE.md, AGENTS.md, .cursor/rules, ' +
      'OpenCode instructions — see `agora plan`/`agora apply`) into the real config files/instruction ' +
      'files of each detected agent tool. `sync` is a continuity alias for `plan && apply`: by default ' +
      'it dry-runs (equivalent to `agora plan`) and prints what would change without touching any files; ' +
      'pass --write --yes to apply (equivalent to `agora apply`). --prune removes servers/instructions ' +
      'not listed in the manifest; without --prune, unmanaged entries are left intact. --scope controls ' +
      'whether project or user config files are targeted (default project). --from <git-url|gist|path> ' +
      "clones someone else's profile: it fetches agora.toml plus any referenced instruction files, then " +
      'runs the scan gate (the same `scanItem` trust gate used by `agora acquire`) on every mcp/instruction ' +
      'entry BEFORE writing anything — a hard fail refuses the whole sync (exit 1). ' +
      'Local capability-cache drift/quarantine state also blocks sync before any host write (exit 1), ' +
      'so a quarantined server is never silently reintroduced from agora.toml. ' +
      'Exit codes: 0 ok, 1 policy forbid / gate blocked / drift blocked, 2 usage error. --write --yes returns 0 on ' +
      'success; dry-run also returns 0 and reports pending changes in the output.',
    flags: [
      {
        flag: '--from',
        description:
          'Clone a shared profile from a URL, gist, or file path instead of ./agora.toml — gated by a scan before anything is written'
      },
      {
        flag: '--tool',
        description: 'Target a single tool: opencode, claude-code, cursor, or windsurf'
      },
      {
        flag: '--scope',
        description: 'Config scope to write: project (default) or user'
      },
      {
        flag: '--prune',
        description: 'Remove servers/instructions from configs that are not in the manifest'
      },
      {
        flag: '--write',
        description: 'Enable write mode (must be combined with --yes)'
      },
      {
        flag: '--yes',
        description: 'Confirm write (required when --write is set)'
      },
      { flag: '--json', description: 'Output plan or applied result as JSON' }
    ],
    examples: [
      'agora sync',
      'agora sync --from https://github.com/someone/agent-profile',
      'agora sync --tool opencode',
      'agora sync --write --yes',
      'agora sync --prune --write --yes'
    ]
  },
  {
    name: 'plan',
    group: 'Stack',
    summary: 'Read-only diff of agora.toml against your real MCP config and instruction files',
    usage: 'agora plan [--from <url|path>] [--tool <id>] [--scope project|user] [--prune] [--json]',
    details:
      'Computes what `agora apply` (or `agora sync --write --yes`) WOULD change — both MCP servers ' +
      'and managed instruction artifacts (CLAUDE.md, AGENTS.md, .cursor/rules, OpenCode instructions) — ' +
      'across every detected agent tool, without writing anything (Terraform-style plan/apply split, P3). ' +
      "--from <git-url|gist|path> previews someone else's profile: it fetches agora.toml plus any " +
      'referenced instruction files and runs the scan gate on every entry first — a hard fail exits 1 ' +
      'before any diff is even computed. Exit codes: 0 ok (the output communicates changes), ' +
      '1 policy forbid / gate blocked, 2 usage error.',
    flags: [
      {
        flag: '--from',
        description:
          'Preview a shared profile from a URL, gist, or file path instead of ./agora.toml'
      },
      {
        flag: '--tool',
        description: 'Target a single tool: opencode, claude-code, cursor, or windsurf'
      },
      { flag: '--scope', description: 'Config scope to diff: project (default) or user' },
      {
        flag: '--prune',
        description: 'Include removal of unmanaged servers/instructions in the diff'
      },
      { flag: '--json', description: 'Output { mode: "plan", tools, instructions } as JSON' }
    ],
    examples: [
      'agora plan',
      'agora plan --tool opencode',
      'agora plan --from https://github.com/someone/agent-profile --json'
    ]
  },
  {
    name: 'apply',
    group: 'Stack',
    summary: 'Execute the plan: reconcile agora.toml into every target tool',
    usage:
      'agora apply [--from <url|path>] [--tool <id>] [--scope project|user] [--prune] [--json]',
    details:
      "Reconciles agora.toml's MCP servers and managed instruction artifacts into the real config " +
      'files/instruction files of every detected agent tool — the write half of the plan/apply split ' +
      '(P3). Surgical, atomic writes only: every adapter preserves unrelated keys/files exactly as ' +
      "writeServers already does. --from <git-url|gist|path> applies someone else's profile directly: " +
      'it fetches agora.toml plus any referenced instruction files and runs the scan gate on every entry ' +
      'first — a hard fail refuses to write anything (exit 1). Exit codes: 0 applied, ' +
      '1 policy forbid / gate blocked / apply error, 2 usage error.',
    flags: [
      {
        flag: '--from',
        description: 'Apply a shared profile from a URL, gist, or file path instead of ./agora.toml'
      },
      {
        flag: '--tool',
        description: 'Target a single tool: opencode, claude-code, cursor, or windsurf'
      },
      { flag: '--scope', description: 'Config scope to write: project (default) or user' },
      {
        flag: '--prune',
        description: 'Remove servers/instructions from configs that are not in the manifest'
      },
      { flag: '--json', description: 'Output { mode: "applied", tools, instructions } as JSON' }
    ],
    examples: [
      'agora apply',
      'agora apply --tool opencode --prune',
      'agora apply --from https://github.com/someone/agent-profile'
    ]
  },
  {
    name: 'integrate',
    group: 'Stack',
    summary: 'Install agora itself into a harness (or every detected harness) as an MCP server',
    usage: 'agora integrate <harness>|--all [--scope project|user] [--dry-run] [--json]',
    details:
      "Dogfoods agora's own stack manager: writes one `agora` MCP server entry — the zero-install " +
      "npx launcher `npx -y agora-hub mcp` — into the target harness's config using that harness's " +
      'ToolAdapter.writeServers, the same surgical/atomic write path `agora sync` uses (every other ' +
      'key in the config file is preserved untouched). Defaults to user scope (unlike sync/plan/apply) ' +
      "since the point is for agora's tools to be available to that harness everywhere, not just the " +
      'current project. --all integrates every detected harness (falling back to every supported ' +
      'harness on a fresh machine with nothing detected yet); a bare harness id integrates just that ' +
      'one. --dry-run previews what would be written without writing anything. Exit codes: 0 ok, ' +
      '1 error (a harness config could not be written).',
    flags: [
      {
        flag: '--all',
        description:
          'Integrate every detected harness (or every supported harness if none are detected)'
      },
      {
        flag: '--scope',
        description: 'Config scope to write: user (default) or project'
      },
      { flag: '--dry-run', description: 'Preview what would be written without writing anything' },
      { flag: '--json', description: 'Output { mode, scope, command, targets } as JSON' }
    ],
    examples: [
      'agora integrate --all',
      'agora integrate claude-code',
      'agora integrate cursor --dry-run',
      'agora integrate --all --json'
    ]
  },
  {
    name: 'lock',
    group: 'Stack',
    summary: 'Manage the lockfile (agora.lock) — pin what is installed, then detect drift',
    usage:
      'agora lock write [--dry-run] [--no-fetch] [--json]\nagora lock verify [--store <path>] [--json]',
    details:
      "`write` pins what is currently installed: it records each server's advertised tools, " +
      'descriptions and input schemas as the approved baseline, in agora.lock and in the local ' +
      'store together — either alone is inert. It needs a capability baseline, so run ' +
      '`agora doctor --probe` first, and it refuses to lock a server whose descriptions have ' +
      'already drifted rather than blessing the change. It also downloads and hashes each pinned ' +
      'tarball, so the lockfile records the bytes npm actually served rather than what npm says ' +
      'about them; published versions are supposed to be immutable, so a later mismatch is an ' +
      'event that should not be possible. --no-fetch skips that and leaves the hash absent, and a ' +
      "tarball disagreeing with npm's own published integrity is reported loudly. " +
      'Commit the result; `agora ci` compares against it on every run. Provenance and a policy ' +
      'verdict are left absent here rather than filled with plausible values — those need an ' +
      'install-time gate run, which `agora acquire` has and this does not. ' +
      '`verify` recomputes every hash and compares. ANY mismatch is drift — the artifact may ' +
      'have been modified after installation (rug-pull detection, §5.5). Exits 1 on drift, 0 on ' +
      'clean verification.',
    flags: [
      {
        flag: '--dry-run',
        description: 'write: print the lockfile that would be written, and write nothing'
      },
      {
        flag: '--no-fetch',
        description: 'write: skip downloading tarballs; leaves tarball_sha256 absent'
      },
      {
        flag: '--store',
        description: 'Path to the Agora SQLite store (default: ~/.agora/agora.db)'
      },
      {
        flag: '--json',
        description: 'Output the result as JSON'
      }
    ],
    examples: [
      'agora doctor --probe && agora lock write',
      'agora lock write --dry-run',
      'agora lock verify',
      'agora lock verify --json'
    ]
  }
];
