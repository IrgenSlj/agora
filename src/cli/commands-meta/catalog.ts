import type { CommandMeta } from './types.js';

export const COMMANDS: CommandMeta[] = [
  {
    name: 'search',
    group: 'Catalog',
    summary: 'Search the federated catalog for MCP servers, packages, and workflows',
    usage:
      'agora search <query> [--source official|smithery|glama|github|huggingface|local|all] [--category mcp|prompt|workflow|skill] [--limit 10] [--json]',
    details:
      'Federates the official MCP Registry, Smithery, Glama, GitHub, and Hugging Face with the ' +
      'bundled local catalog, deduping matches found across sources (each result keeps its ' +
      'provenance). An unreachable source degrades honestly instead of failing the whole search — ' +
      'local always works offline. ' +
      'Use --category to filter by kind, --source to restrict to one upstream. ' +
      'Add --api to query a self-hosted Agora API instead (unrelated to federation).',
    flags: [
      {
        flag: '--source',
        description:
          'Restrict to one upstream: official, smithery, glama, github, huggingface, local, or all (default all)'
      },
      { flag: '--category, -c', description: 'Filter by category: mcp, prompt, workflow, skill' },
      { flag: '--limit, -n', description: 'Maximum number of results (default 10)' },
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
    usage: 'agora browse <id> [--type package|workflow] [--json]',
    details:
      'Fetches and displays the full metadata for a package or workflow by its id. ' +
      'Use --type to disambiguate when an id is shared by multiple kinds.',
    flags: [
      { flag: '--type, -t', description: 'Item kind: package or workflow' },
      { flag: '--json', description: 'Output as JSON' }
    ],
    examples: ['agora browse mcp-github', 'agora browse mcp-github --type package']
  },
  {
    name: 'trending',
    group: 'Catalog',
    summary: 'Show trending packages and workflows',
    usage: 'agora trending [all|packages|workflows] [--limit 5] [--json]',
    details:
      'Lists the most-starred catalog items. Pass a category filter as the first positional ' +
      'argument, or use --category.',
    flags: [
      {
        flag: '--category, -c',
        description: 'Category filter: all, packages, workflows (default all)'
      },
      { flag: '--limit, -n', description: 'Maximum number of results (default 5)' },
      { flag: '--json', description: 'Output as JSON' }
    ],
    examples: ['agora trending', 'agora trending packages', 'agora trending --limit 10']
  },
  {
    name: 'workflows',
    group: 'Catalog',
    summary: 'List and search AI workflow templates',
    usage: 'agora workflows [query] [--limit 10] [--json]',
    details:
      'Searches the workflow subset of the catalog. Provide an optional keyword to narrow results.',
    flags: [
      { flag: '--limit, -n', description: 'Maximum number of results (default 10)' },
      { flag: '--json', description: 'Output as JSON' }
    ],
    examples: ['agora workflows', 'agora workflows tdd', 'agora workflows security --json']
  },
  {
    name: 'similar',
    group: 'Catalog',
    summary: 'Find similar catalog items by tag overlap',
    usage: 'agora similar <id> [--limit 5] [--type package|workflow] [--json]',
    details:
      'Computes tag-IDF-weighted Jaccard similarity between catalog items. ' +
      'Ranks by similarity score, tiebroken by install count. ' +
      'Use --type to restrict to packages or workflows.',
    flags: [
      { flag: '--type, -t', description: 'Item kind: package or workflow (default all)' },
      { flag: '--limit, -n', description: 'Maximum number of results (default 5)' },
      { flag: '--json', description: 'Output as JSON' }
    ],
    examples: [
      'agora similar mcp-postgres',
      'agora similar mcp-github --limit 3',
      'agora similar wf-tdd-cycle --type workflow'
    ]
  },
  {
    name: 'compare',
    group: 'Catalog',
    summary: 'Compare two or more catalog items side by side',
    usage: 'agora compare <id1> <id2> [<id3>...] [--type package|workflow] [--json]',
    details:
      'Renders a box-drawn table comparing items across attributes: name, author, installs, ' +
      'stars, category, tags, npmPackage. Shared tags are highlighted in the accent colour.',
    flags: [
      { flag: '--type, -t', description: 'Item kind: package or workflow (default all)' },
      { flag: '--json', description: 'Output as JSON' }
    ],
    examples: [
      'agora compare mcp-postgres mcp-supabase',
      'agora compare mcp-github mcp-gitlab mcp-git'
    ]
  },
  {
    name: 'chat',
    group: 'Catalog',
    summary: 'Chat with an AI assistant about the Agora catalog',
    usage: 'agora chat [message] [--continue] [--session <id>] [--model <model>]',
    details:
      'Starts an interactive OpenCode TUI session with a free model. ' +
      'Pass a message for one-shot mode (scriptable). ' +
      'The TUI gives you a full REPL with conversation history, editing, and /agora commands.',
    flags: [
      { flag: '--model, -m', description: 'Model to use (default: deepseek-v4-flash-free)' },
      { flag: '--continue', description: 'Continue the last conversation' },
      { flag: '--session, -s', description: 'Continue a specific session by ID' },
      { flag: '--json', description: 'Output raw JSON events (one-shot mode only)' }
    ],
    examples: [
      'agora chat',
      'agora chat "what MCP servers are for postgres?"',
      'agora chat --continue "follow up question"',
      'agora chat -m nemotron-3-super-free'
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
      { flag: '--type, -t', description: 'Item kind: package or workflow' },
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
      'Resolves an item id or capability query — against the federated catalog (official MCP Registry ' +
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
        description: 'Restrict federation resolution to one upstream source'
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
    usage: 'agora scan <id> [--type package|workflow] [--json]',
    details:
      'Runs the same trust gate `agora acquire` enforces before writing config, against the bundled ' +
      'catalog. Exit codes: 0 pass/ok, 1 policy forbid / scan fail, 2 usage error — both --json and the table honor them. ' +
      'Honest limits: this is static heuristics plus live-probe diffing (injection-pattern checks, ' +
      'permission-manifest diffs, registry status, tool-annotation-hint checks) — never a sandbox. It ' +
      'does not execute or formally verify server code. "pass" means no known red flags, not "safe."',
    flags: [
      { flag: '--type, -t', description: 'Item kind: package or workflow' },
      { flag: '--json', description: 'Output result as JSON' }
    ],
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
    summary: 'Incrementally sync the official MCP registry into the local federation cache.',
    usage: 'agora refresh [--source official] [--json]',
    details:
      "Fetches servers added/changed since the last sync via the official registry's " +
      "`updated_since` filter, and prunes any it has tombstoned as deleted. Powers `agora search`'s " +
      'offline fallback when the live registry is unreachable.',
    flags: [
      {
        flag: '--source',
        description: 'Source to refresh (default: official; the only supported value today)'
      },
      { flag: '--json', description: 'Output result as JSON' }
    ],
    examples: ['agora refresh', 'agora refresh --json']
  },
  {
    name: 'news',
    group: 'Catalog',
    summary: 'Browse ranked tech news from HN, GitHub, arXiv',
    usage: 'agora news [query] [--source hn|gh|arxiv] [--limit 20] [--refresh] [--json]',
    details:
      'Fetches and ranks news stories from multiple sources using a recency-engagement-topic scoring algorithm. ' +
      'Cached locally in ~/.config/agora/news-cache.jsonl. ' +
      'Use --refresh to force re-fetch; --source to filter by source; a positional query to search titles and tags.',
    flags: [
      { flag: '--source, -s', description: 'Source filter: hn, gh, arxiv' },
      { flag: '--limit, -n', description: 'Maximum number of results (default 20)' },
      { flag: '--refresh', description: 'Force re-fetch all enabled sources' },
      { flag: '--json', description: 'Output as JSON' }
    ],
    examples: [
      'agora news',
      'agora news mcp',
      'agora news --source hn --limit 5',
      'agora news --refresh'
    ]
  },
  {
    name: 'today',
    group: 'Catalog',
    summary: 'Daily digest: top news and trending items from the last 24h',
    usage: 'agora today [--section news|market|all] [--json]',
    flags: [
      {
        flag: '--section, -s',
        description: 'Show only one section: news, market, or all (default all)'
      },
      { flag: '--json', description: 'Output { at, news, trending } as JSON' }
    ],
    examples: ['agora today', 'agora today --section news', 'agora today --json']
  },
  {
    name: 'export',
    group: 'Catalog',
    summary: 'Export catalog data in various formats',
    usage:
      'agora export [query] [--category all|mcp|prompt|workflow] [--format json|csv|markdown|table] [--limit N] [--api]',
    details:
      'Exports all catalog items matching the optional query and category filters. ' +
      'Use --format to choose the output format. ' +
      'Add --api to query the live Agora API instead of the bundled offline data.',
    flags: [
      { flag: '--format, -f', description: 'Output format: json (default), csv, markdown, table' },
      { flag: '--category, -c', description: 'Filter by category: all, mcp, prompt, workflow' },
      { flag: '--limit, -n', description: 'Maximum items to export' },
      { flag: '--api', description: 'Query the live Agora API' },
      { flag: '--json', description: 'Alias for --format json' }
    ],
    examples: [
      'agora export',
      'agora export --format csv',
      'agora export --format markdown',
      'agora export --category mcp --limit 20'
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
      'Example: agora watch 5 agora trending watches trending every 5 seconds.',
    flags: [
      { flag: '--count, -n', description: 'Stop after N iterations' },
      { flag: '--once', description: 'Run once and exit' }
    ],
    examples: [
      'agora watch 5 agora trending',
      'agora watch 10 agora search filesystem',
      'agora watch 30 agora news --count 3'
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
  },
  {
    name: 'share',
    group: 'Catalog',
    summary: 'Print a shareable markdown snippet for a catalog item',
    usage: 'agora share <id> [--json]',
    details:
      'Produces a markdown blurb with the item name, description, link, tags, and install ' +
      'command — paste-ready for a community post, README, or chat message.',
    flags: [{ flag: '--json', description: 'Output { id, name, link, snippet } as JSON' }],
    examples: ['agora share mcp-github', 'agora share mcp-filesystem --json']
  },
  {
    name: 'author',
    group: 'Catalog',
    summary: 'List catalog items by a specific author',
    usage: 'agora author <name> [--limit 25] [--page 1] [--json]',
    details:
      'Lists all items where the author matches the given name (case-insensitive). ' +
      'Tries exact match first, then substring. Results are sorted by installs descending.',
    flags: [
      { flag: '--limit, -n', description: 'Items per page (default 25)' },
      { flag: '--page, -p', description: 'Page number (default 1)' },
      { flag: '--json', description: 'Output { author, count, items } as JSON' }
    ],
    examples: [
      'agora author "Anthropic, PBC"',
      'agora author anthropic --json',
      'agora author github --limit 10'
    ]
  },
  {
    name: 'curate',
    group: 'Catalog',
    summary: 'Run AI-powered curation to discover and verify catalog items',
    usage:
      'agora curate [--refresh | --force] [--limit 50] [--concurrency 4] [--stale-days 30] [--status]',
    details:
      'Discovers MCP servers and tools from GitHub and HuggingFace, then uses AI to verify ' +
      'each item is a genuine MCP server/prompt/skill and extract metadata. Results are cached ' +
      'locally and used by catalog search. Three modes are available: incremental ' +
      '(default) only verifies new items; --refresh re-verifies cached items older than ' +
      '--stale-days (default 30) and is suitable for scheduled/cron runs; --force re-verifies ' +
      'everything. Items already present in the bundled catalog are automatically skipped. ' +
      'Candidate processing runs with bounded concurrency (--concurrency, default 4). ' +
      'Requires the `opencode` binary on PATH for AI verification.',
    flags: [
      { flag: '--force', description: 'Re-verify all items regardless of freshness' },
      {
        flag: '--refresh',
        description: 'Re-verify cached items older than --stale-days (default: incremental)'
      },
      {
        flag: '--stale-days',
        description: 'Age threshold in days for --refresh mode (default 30)'
      },
      { flag: '--limit, -n', description: 'Maximum items to process (default 50)' },
      { flag: '--concurrency, -c', description: 'Max parallel verifications (default 4)' },
      { flag: '--status', description: 'Print curation status (count, source, last run) and exit' }
    ],
    examples: [
      'agora curate',
      'agora curate --refresh',
      'agora curate --refresh --stale-days 7',
      'agora curate --force',
      'agora curate --limit 20',
      'agora curate --concurrency 8',
      'agora curate --status',
      'agora curate --status --json'
    ]
  }
];
