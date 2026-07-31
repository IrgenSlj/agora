import type { CommandMeta } from './types.js';

export const COMMANDS: CommandMeta[] = [
  {
    name: 'search',
    group: 'Catalog',
    summary: 'Search the multi-source catalog for MCP servers and Agent Skills',
    usage:
      'agora search <query> [--source official|glama|pulsemcp|skills-github|smithery|github|huggingface|local|all] [--kind mcp-server|agent-skill] [--category mcp|prompt|workflow|skill] [--limit 10] [--json]',
    details:
      'Searches the official MCP Registry, Glama, PulseMCP, GitHub Skills, GitHub, and the bundled local catalog. ' +
      'Smithery and Hugging Face are non-canonical opt-in sources; set AGORA_ENABLE_NONCANONICAL_SOURCES=1, ' +
      'AGORA_ENABLE_SMITHERY=1, AGORA_ENABLE_HUGGINGFACE=1, or AGORA_NONCANONICAL_SOURCES=smithery,huggingface to enable them. ' +
      'Dedupes matches found across sources (each result keeps its ' +
      'provenance). An unreachable source degrades honestly instead of failing the whole search — ' +
      'local always works offline. ' +
      'Use --kind for v2 artifact kinds, --category for legacy catalog categories, --source to restrict to one upstream, and --offline to ' +
      'read only local sync/cache data.',
    flags: [
      {
        flag: '--source',
        description:
          'Restrict to one upstream: official, glama, pulsemcp, skills-github, smithery, github, huggingface, local, or all (default all)'
      },
      { flag: '--kind', description: 'Filter by v2 artifact kind: mcp-server or agent-skill' },
      { flag: '--category, -c', description: 'Filter by category: mcp, prompt, skill, other' },
      { flag: '--limit, -n', description: 'Maximum number of results (default 10)' },
      { flag: '--offline', description: 'Read local sync/cache data without contacting upstreams' },
      { flag: '--json', description: 'Output results as JSON, including per-item provenance' }
    ],
    examples: [
      'agora search postgres',
      'agora search postgres --source official',
      'agora search github --category mcp --limit 5 --json'
    ]
  },
  {
    name: 'browse',
    group: 'Catalog',
    summary: 'View full details for a single catalog item',
    usage: 'agora browse <id> [--json]',
    details:
      'Fetches and displays the full metadata for a catalog item by its id. ' +
      'Use --type to disambiguate when an id is shared by multiple kinds.',
    flags: [{ flag: '--json', description: 'Output as JSON' }],
    examples: ['agora browse mcp-github', 'agora browse mcp-github --type package']
  },
  {
    name: 'info',
    group: 'Catalog',
    summary: 'Inspect a synced artifact by purl from the local store',
    usage: 'agora info <purl> [--store <path>] [--json]',
    details:
      'Reads the local SQLite/CAS sync store, showing the normalized artifact row, ' +
      'source references, and cached source-item summaries without contacting upstream registries. ' +
      'Run agora refresh first to populate the local store.',
    flags: [
      { flag: '--store', description: 'SQLite store path (default AGORA_HOME/agora.db)' },
      { flag: '--cas-dir', description: 'CAS blob directory (default next to the store)' },
      { flag: '--json', description: 'Output artifact, sources, and source items as JSON' }
    ],
    examples: [
      'agora info pkg:npm/@modelcontextprotocol/server-filesystem@2026.1.0',
      'agora info pkg:npm/@modelcontextprotocol/server-filesystem@2026.1.0 --json'
    ]
  },
  {
    name: 'install',
    group: 'Catalog',
    summary: 'Install a package into your OpenCode config',
    usage: 'agora install <id> [--write] [--config path] [--json]',
    details:
      'Generates an install plan for a catalog package. Without --write the plan is previewed only. ' +
      'With --write, opencode.json is updated and any required npm packages are installed.',
    flags: [
      { flag: '--write', description: 'Apply the install plan (update config + run npm install)' },
      {
        flag: '--save',
        description: 'Also record the installed server in agora.toml (requires --write)'
      },
      { flag: '--config', description: 'Path to opencode.json (auto-detected by default)' },
      {
        flag: '--skip-scan',
        description: 'Bypass the pre-install scan gate (use only when you understand the risk)'
      },
      { flag: '--json', description: 'Output plan as JSON' }
    ],
    examples: [
      'agora install mcp-github',
      'agora install mcp-github --write',
      'agora install mcp-github --write --save',
      'agora install mcp-github --write --config ./opencode.json'
    ]
  },
  {
    name: 'acquire',
    group: 'Catalog',
    summary: 'Scan-gated capability acquisition for MCP servers',
    usage:
      'agora acquire <id|query> [--tool opencode|claude-code|cursor|windsurf] [--source official|smithery|glama|github|huggingface|local] [--accept-warnings] [--save] [--dry-run] [--json]',
    details:
      'Resolves an item id or capability query — against the multi-source catalog (official MCP Registry ' +
      'first, then the bundled offline catalog) as well as the bundled catalog directly — creates an ' +
      'install plan, runs the pre-install scan gate, and writes the MCP server to the target config only ' +
      'when the scan has no failures. Warnings require --accept-warnings; --dry-run prints the plan and ' +
      'scan without writing. With --save, the scan verdict and description-drift baseline are recorded ' +
      'alongside agora.toml under a namespaced trust key so a later re-acquire or a cloned profile can ' +
      'detect drift. Exit codes: 0 ok/dry-run, 1 policy forbid / scan fail, 2 usage or missing confirmation. ' +
      'Honest limits: the gate is static heuristics plus live-probe diffing — pattern checks, manifest ' +
      'diffs, registry status, tool-annotation-hint checks. It is not a sandbox and does not execute or ' +
      'formally verify server code. A clean scan means "no known red flags," not "safe."',
    flags: [
      {
        flag: '--tool',
        description: 'Target agent config to write (default: opencode)'
      },
      { flag: '--config', description: 'Explicit config path for the target tool' },
      {
        flag: '--source',
        description: 'Restrict resolution to one upstream source'
      },
      {
        flag: '--accept-warnings',
        description: 'Proceed when the scan has warnings but no failures'
      },
      { flag: '--save', description: 'Also record the server (and its trust data) in agora.toml' },
      { flag: '--dry-run', description: 'Plan and scan only; write nothing' },
      { flag: '--json', description: 'Output result as JSON' }
    ],
    examples: [
      'agora acquire mcp-postgres --dry-run',
      'agora acquire "postgres database" --accept-warnings',
      'agora acquire mcp-github --save --accept-warnings',
      'agora acquire io.github.acme/postgres-mcp --source official --json'
    ]
  },
  {
    name: 'scan',
    group: 'Catalog',
    summary: 'Pre-install safety scan for a catalog or live item.',
    usage: 'agora scan <id> [--json]',
    details:
      'Runs the same trust gate `agora acquire` enforces before writing config, against the bundled ' +
      'catalog. Exit codes: 0 pass/ok, 1 policy forbid / scan fail, 2 usage error — both --json and the table honor them. ' +
      'Honest limits: this is static heuristics plus live-probe diffing (injection-pattern checks, ' +
      'permission-manifest diffs, registry status, tool-annotation-hint checks) — never a sandbox. It ' +
      'does not execute or formally verify server code. "pass" means no known red flags, not "safe."',
    flags: [{ flag: '--json', description: 'Output result as JSON' }],
    examples: ['agora scan mcp-github', 'agora scan some-pkg --json']
  },
  {
    name: 'outdated',
    group: 'Catalog',
    summary: 'List MCP packages from opencode.json with their latest npm versions.',
    usage: 'agora outdated [--config <path>] [--json]',
    flags: [
      { flag: '--config', description: 'Path to opencode.json (auto-detected by default)' },
      { flag: '--json', description: 'Output as JSON' }
    ],
    examples: ['agora outdated', 'agora outdated --json']
  },
  {
    name: 'refresh',
    group: 'Catalog',
    summary: 'Incrementally sync the official MCP registry into the local sync cache.',
    usage: 'agora refresh [--source official] [--store <path>] [--json]',
    details:
      "Fetches servers added/changed since the last sync via the official registry's " +
      "`updated_since` filter, and prunes any it has tombstoned as deleted. Powers `agora search`'s " +
      'offline fallback when the live registry is unreachable.',
    flags: [
      {
        flag: '--source',
        description: 'Source to refresh (default: official; the only supported value today)'
      },
      {
        flag: '--store',
        description:
          'SQLite store path for the refreshed source index (default: <data-dir>/agora.db)'
      },
      { flag: '--json', description: 'Output result as JSON' }
    ],
    examples: ['agora refresh', 'agora refresh --store ~/.agora/agora.db --json']
  },
  {
    name: 'trust',
    group: 'Catalog',
    summary: 'Every plane’s verdict for one artifact — including what is not known',
    usage: 'agora trust <id> [--offline] [--json]',
    details:
      'Shows provenance, the heuristic scan, policy, revocation and observed behaviour side by ' +
      'side. Checks that did not run are reported as unknown rather than omitted or rounded to ' +
      'a pass: no published attestation is not a failed signature, an allow reached with Cedar ' +
      'rules skipped is not a permit, an uncached revocation feed is not "not revoked", and a ' +
      'server never run through `agora run` has not been shown to behave. Exits 1 on any ' +
      'blocking finding.',
    flags: [
      { flag: '--offline', description: 'Skip network checks (provenance, repo, npm)' },
      { flag: '--json', description: 'Output as JSON' }
    ],
    examples: ['agora trust mcp-filesystem', 'agora trust mcp-postgres --json']
  },
  {
    name: 'today',
    group: 'Catalog',
    summary: 'Daily digest: top news and trending items from the last 24h',
    usage: 'agora today [--section news|market|all] [--refresh] [--offline] [--json]',
    details:
      'Refreshes any news source whose cache has gone stale, then shows the top stories and ' +
      'trending catalog items. Cached in ~/.config/agora/news-cache.jsonl. ' +
      'Use --offline to read the cache without touching the network, or --refresh to force a ' +
      'refetch. A source that cannot be reached keeps its cached items and is named in the ' +
      'output, so fewer stories never silently reads as a quiet day.',
    flags: [
      {
        flag: '--section, -s',
        description: 'Show only one section: news, market, or all (default all)'
      },
      { flag: '--refresh', description: 'Force re-fetch of all enabled news sources' },
      { flag: '--offline', description: 'Read the cache only; never touch the network' },
      { flag: '--json', description: 'Output { at, news, unreachableSources, trending } as JSON' }
    ],
    examples: [
      'agora today',
      'agora today --section news',
      'agora today --refresh',
      'agora today --offline --json'
    ]
  },
  {
    name: 'export',
    group: 'Catalog',
    summary: 'Export catalog rows, or one artifact’s evidence as an in-toto bundle',
    usage:
      'agora export [format] [query] [--category all|mcp|prompt|skill] [--format json|csv|markdown|table] [--limit N]\n' +
      '  agora export --attestations <id>',
    details:
      'Two jobs. By default, exports catalog items matching the optional query and category ' +
      'filters — pass the format as the first positional argument (json, csv, markdown, table) ' +
      'or use --format. With --attestations, exports one artifact’s evidence instead, as an ' +
      'in-toto/DSSE bundle other tooling can read: a statement per plane that produced evidence, ' +
      'and an explicit not_established entry for every plane that did not. Envelopes are ' +
      'unsigned (tier "none") — Agora has no attestation-signing identity, and the bundle ' +
      'attests to what Agora observed, not to who Agora is. Statements bind to a content digest ' +
      'from agora.lock; an artifact that is not pinned yields no statements at all rather than a ' +
      'made-up hash.',
    flags: [
      {
        flag: '--attestations',
        description: 'Export one artifact’s evidence as an in-toto bundle'
      },
      { flag: '--format, -f', description: 'Output format: json (default), csv, markdown, table' },
      { flag: '--category, -c', description: 'Filter by category: all, mcp, prompt, skill' },
      { flag: '--limit, -n', description: 'Maximum items to export' },
      { flag: '--json', description: 'Alias for --format json' }
    ],
    examples: [
      'agora export',
      'agora export json',
      'agora export csv mcp',
      'agora export --format csv',
      'agora export --category mcp --limit 20',
      'agora export --attestations mcp-filesystem'
    ]
  },
  {
    name: 'watch',
    group: 'Catalog',
    summary: 'Repeat a command at a regular interval (like UNIX watch)',
    usage: 'agora watch <interval> <command...> [--count N] [--once]',
    details:
      'Repeatedly runs an agora command at the given interval in seconds. ' +
      'Clears the screen between runs. Use --count to limit the number of iterations. ' +
      'Example: agora watch 5 agora today watches the daily digest every 5 seconds.',
    flags: [
      { flag: '--count, -n', description: 'Stop after N iterations' },
      { flag: '--once', description: 'Run once and exit' }
    ],
    examples: [
      'agora watch 5 agora today',
      'agora watch 10 agora search filesystem',
      'agora watch 30 agora today --section news'
    ]
  },
  {
    name: 'open',
    group: 'Catalog',
    summary: 'Open a catalog item or URL in the browser',
    usage: 'agora open <id|url> [--print] [--json]',
    details:
      'Resolves the item by id and opens its repository or npm page in the default browser. ' +
      'Pass a full URL to open it directly. Use --print to print the URL without opening.',
    flags: [
      { flag: '--print', description: 'Print the URL instead of opening the browser' },
      { flag: '--json', description: 'Output { id, url, opened } as JSON' }
    ],
    examples: [
      'agora open mcp-github',
      'agora open mcp-github --print',
      'agora open https://github.com/modelcontextprotocol/servers'
    ]
  }
];
