import type { CommandMeta } from './types.js';

export const COMMANDS: CommandMeta[] = [
  {
    name: 'try',
    group: 'Stack',
    summary: 'Ephemeral test-drive an MCP server without saving any config',
    usage: 'agora try <id> [--timeout <ms>] [--skip-scan] [--json]',
    details:
      'Spawns the MCP server for the given catalog item, performs a real MCP ' +
      'initialize + tools/list handshake over stdio, reports the server name and tools, ' +
      'then kills the process — without writing any configuration file. ' +
      'Runs the pre-install scan by default (same as agora install); pass --skip-scan ' +
      'to bypass. Use --timeout to override the default 15-second probe window. ' +
      'Returns exit code 1 if the probe fails or scan blocks.',
    flags: [
      { flag: '--timeout', description: 'Probe timeout in milliseconds (default 15000)' },
      {
        flag: '--skip-scan',
        description: 'Bypass the pre-install scan gate'
      },
      { flag: '--json', description: 'Output { item, command, scan, probe } as JSON' }
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
    summary: 'Manage the lockfile (agora.lock) — verify integrity and detect drift',
    usage: 'agora lock verify [--store <path>] [--json]',
    details:
      'Recomputes all hashes in the lockfile (manifest_sha256, per-tool description and schema hashes) ' +
      'and compares them against the current manifest in the local SQLite store. ANY mismatch indicates ' +
      'drift — the artifact may have been modified after installation (rug-pull detection, §5.5). ' +
      'Exits 1 on drift, 0 on clean verification.',
    flags: [
      {
        flag: '--store',
        description: 'Path to the Agora SQLite store (default: ~/.agora/agora.db)'
      },
      {
        flag: '--json',
        description: 'Output { ok, lockfile_version, generated_by, artifacts } as JSON'
      }
    ],
    examples: ['agora lock verify', 'agora lock verify --json']
  }
];
