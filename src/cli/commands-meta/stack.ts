import type { CommandMeta } from './types.js';

export const COMMANDS: CommandMeta[] = [
  {
    name: 'try',
    group: 'Stack',
    summary: 'Ephemeral test-drive a marketplace MCP server without saving any config',
    usage: 'agora try <id> [--timeout <ms>] [--skip-scan] [--json]',
    details:
      'Spawns the MCP server for the given marketplace item, performs a real MCP ' +
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
    name: 'doctor',
    group: 'Stack',
    summary: 'Health-check configured MCP servers across all agent tools',
    usage: 'agora doctor [--tool <id>] [--probe] [--strict] [--json]',
    details:
      'Checks each configured MCP server for common problems: missing binary, invalid remote URL, ' +
      'all instances disabled, conflicting definitions across tools/scopes. ' +
      'Use --probe to briefly start each local server and verify it launches. ' +
      'Returns exit code 0 by default (informational); use --strict to return 1 when any server has errors.',
    flags: [
      {
        flag: '--tool',
        description: 'Filter to a single tool: opencode, claude-code, cursor, or windsurf'
      },
      { flag: '--probe', description: 'Briefly start each local server to verify it runs' },
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
    summary: "Reconcile your agora.toml manifest into each agent tool's MCP config",
    usage:
      'agora sync [--from <url|path>] [--tool <id>] [--scope project|user] [--prune] [--write --yes] [--json]',
    details:
      'Reads the agora.toml manifest (created by `agora freeze --write`) and reconciles its MCP ' +
      'server entries into the real config files of each detected agent tool. ' +
      'By default runs as a dry-run and prints what would change without touching any files. ' +
      'Pass --write --yes to apply. --prune removes servers not listed in the manifest; ' +
      'without --prune, unmanaged servers are left intact. --scope controls whether project ' +
      'or user config files are targeted (default project).',
    flags: [
      {
        flag: '--from',
        description: 'Apply a shared manifest from a URL or file path instead of ./agora.toml'
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
        description: 'Remove servers from configs that are not in the manifest'
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
      'agora sync --from https://example.com/agora.toml',
      'agora sync --tool opencode',
      'agora sync --write --yes',
      'agora sync --prune --write --yes'
    ]
  },
];
