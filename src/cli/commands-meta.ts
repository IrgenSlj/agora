import type { Styler } from '../ui.js';

export type CommandGroup = 'Marketplace' | 'Setup' | 'Library' | 'Learn' | 'Community' | 'Stack';

export interface CommandMeta {
  name: string;
  group: CommandGroup;
  summary: string;
  usage: string;
  details?: string;
  flags?: { flag: string; description: string }[];
  examples?: string[];
}

/**
 * Renders a command manual page using the provided styler.
 * Used by both `agora help <command>` (scriptable) and the interactive menu (TTY).
 */
export function renderManual(meta: CommandMeta, style: Styler): string {
  const lines: string[] = [
    style.accent(meta.name),
    meta.summary,
    '',
    `${style.dim('Usage:')}`,
    ...meta.usage.split('\n').map((line) => `  ${line}`)
  ];

  if (meta.flags && meta.flags.length > 0) {
    const flagWidth = Math.max(...meta.flags.map((f) => f.flag.length));
    lines.push('');
    lines.push(style.dim('Flags:'));
    for (const f of meta.flags) {
      lines.push(`  ${f.flag.padEnd(flagWidth)}  ${style.dim(f.description)}`);
    }
  }

  if (meta.examples && meta.examples.length > 0) {
    lines.push('');
    lines.push(style.dim('Examples:'));
    for (const ex of meta.examples) {
      lines.push(`  ${ex}`);
    }
  }

  if (meta.details) {
    lines.push('');
    lines.push(meta.details);
  }

  return lines.join('\n');
}

export const COMMANDS: CommandMeta[] = [
  // Marketplace
  {
    name: 'search',
    group: 'Marketplace',
    summary: 'Search the marketplace for packages and workflows',
    usage: 'agora search <query> [--category mcp|prompt|workflow|skill] [--limit 10] [--json]',
    details:
      'Searches all marketplace items by keyword. Use --category to filter by kind. ' +
      'Add --api to query the live Agora API; without it, the bundled offline data is used.',
    flags: [
      { flag: '--category, -c', description: 'Filter by category: mcp, prompt, workflow, skill' },
      { flag: '--limit, -n', description: 'Maximum number of results (default 10)' },
      { flag: '--json', description: 'Output results as JSON' }
    ],
    examples: [
      'agora search filesystem',
      'agora search filesystem --api',
      'agora search github --category mcp --limit 5'
    ]
  },
  {
    name: 'browse',
    group: 'Marketplace',
    summary: 'View full details for a single marketplace item',
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
    group: 'Marketplace',
    summary: 'Show trending packages and workflows',
    usage: 'agora trending [all|packages|workflows] [--limit 5] [--json]',
    details:
      'Lists the most-starred marketplace items. Pass a category filter as the first positional ' +
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
    group: 'Marketplace',
    summary: 'List and search AI workflow templates',
    usage: 'agora workflows [query] [--limit 10] [--json]',
    details:
      'Searches the workflow subset of the marketplace. Provide an optional keyword to narrow results.',
    flags: [
      { flag: '--limit, -n', description: 'Maximum number of results (default 10)' },
      { flag: '--json', description: 'Output as JSON' }
    ],
    examples: ['agora workflows', 'agora workflows tdd', 'agora workflows security --json']
  },
  {
    name: 'similar',
    group: 'Marketplace',
    summary: 'Find similar marketplace items by tag overlap',
    usage: 'agora similar <id> [--limit 5] [--type package|workflow] [--json]',
    details:
      'Computes tag-IDF-weighted Jaccard similarity between marketplace items. ' +
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
    group: 'Marketplace',
    summary: 'Compare two or more marketplace items side by side',
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
    group: 'Marketplace',
    summary: 'Chat with an AI assistant about the Agora marketplace',
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
    group: 'Marketplace',
    summary: 'Install a package into your OpenCode config',
    usage: 'agora install <id> [--write] [--config path] [--json]',
    details:
      'Generates an install plan for a marketplace package. Without --write the plan is previewed only. ' +
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
    name: 'scan',
    group: 'Marketplace',
    summary: 'Pre-install safety scan for a catalog or live item.',
    usage: 'agora scan <id> [--type package|workflow] [--json]',
    flags: [
      { flag: '--type, -t', description: 'Item kind: package or workflow' },
      { flag: '--json', description: 'Output result as JSON' }
    ],
    examples: ['agora scan mcp-github', 'agora scan some-pkg --json']
  },
  {
    name: 'outdated',
    group: 'Marketplace',
    summary: 'List MCP packages from opencode.json with their latest npm versions.',
    usage: 'agora outdated [--config <path>] [--json]',
    flags: [
      { flag: '--config', description: 'Path to opencode.json (auto-detected by default)' },
      { flag: '--json', description: 'Output as JSON' }
    ],
    examples: ['agora outdated', 'agora outdated --json']
  },

  // Setup
  {
    name: 'init',
    group: 'Setup',
    summary: 'Scaffold Agora into the current project, or generate MCP server templates',
    usage: 'agora init [--dry-run] [--json] [--mcp]\n  agora init --template node-mcp|python-mcp',
    details:
      'Without --template, scans the current directory, generates an opencode.json with recommended MCP servers, ' +
      'and installs the /agora slash command. Use --dry-run to preview without writing.\n\n' +
      'With --template, scaffolds a complete MCP server project in the current directory.',
    flags: [
      { flag: '--dry-run', description: 'Preview what would be written without applying changes' },
      { flag: '--json', description: 'Output the generated config as JSON' },
      { flag: '--mcp', description: 'Also register the Agora MCP server in the config' },
      { flag: '--template', description: 'Scaffold a project: node-mcp or python-mcp' }
    ],
    examples: [
      'agora init',
      'agora init --dry-run',
      'agora init --mcp',
      'agora init --template node-mcp',
      'agora init --template python-mcp'
    ]
  },
  {
    name: 'use',
    group: 'Setup',
    summary: 'Apply a workflow template as an OpenCode skill',
    usage: 'agora use <workflow-id> [--json]',
    details:
      'Copies a workflow from the marketplace into .opencode/skills/ and registers it in opencode.json ' +
      'so OpenCode can load it on the next restart.',
    flags: [{ flag: '--json', description: 'Output result as JSON' }],
    examples: ['agora use wf-tdd-cycle', 'agora use wf-security-audit']
  },
  {
    name: 'menu',
    group: 'Setup',
    summary: 'Browse commands interactively (the old menu)',
    usage: 'agora menu',
    details: 'Opens the interactive command browser powered by @clack/prompts.',
    examples: ['agora menu']
  },
  {
    name: 'tui',
    group: 'Setup',
    summary: 'Open the full-screen Agora TUI (Home · Market · Comm · News · Settings)',
    usage: 'agora tui',
    details:
      'Opens the keyboard-driven TUI with five pages, switched by 1-5 or Tab. ' +
      'j/k navigates, Enter drills in, Esc backs out, ? toggles help, q quits. ' +
      'Pages: Home (recommendation engine), Marketplace (browse + install preview), ' +
      'Community (boards/threads/reader against fixtures until backend lands), ' +
      'News (ranked feed against fixtures until news adapters land), ' +
      'Settings (account, display, news sources, community defaults).',
    examples: ['agora tui']
  },
  {
    name: 'config',
    group: 'Setup',
    summary: 'Inspect, validate, diff, fix, show, or edit your OpenCode configuration',
    usage:
      'agora config doctor [--fix] [--deep] [--config path] [--json]\n' +
      '  agora config show [--config path] [--json]\n' +
      '  agora config edit [--config path]\n' +
      '  agora config diff <path1> <path2> [--json]',
    details:
      'Doctor runs a health-check on opencode.json: reports path, validity, MCP server count, and plugins. ' +
      'Add --fix to auto-heal common issues (missing $schema, duplicate plugins, empty MCP entries). ' +
      'Add --deep for full diagnostics (opencode PATH, npm package checks, GitHub token, data dir). ' +
      'Show prints the full compiled config. Edit opens the config in $EDITOR. ' +
      'Diff compares two config files side by side, showing MCP and plugin deltas.',
    flags: [
      { flag: '--fix', description: 'Auto-heal common config issues' },
      { flag: '--deep', description: 'Full diagnostics (opencode PATH, npm checks, tokens)' },
      { flag: '--config', description: 'Explicit path to opencode.json' },
      { flag: '--json', description: 'Output report as JSON' }
    ],
    examples: [
      'agora config doctor',
      'agora config doctor --fix',
      'agora config doctor --deep',
      'agora config show',
      'agora config edit',
      'agora config diff opencode.json ~/.config/opencode/opencode.json'
    ]
  },

  // Library
  {
    name: 'save',
    group: 'Library',
    summary: 'Save a marketplace item to your local library',
    usage: 'agora save <id> [--data-dir path] [--json]',
    details:
      'Persists a package or workflow reference in the Agora state file so you can recall it later ' +
      'with `agora saved`.',
    flags: [
      { flag: '--data-dir', description: 'Override the Agora data directory' },
      { flag: '--type, -t', description: 'Item kind: package or workflow' },
      { flag: '--json', description: 'Output result as JSON' }
    ],
    examples: ['agora save wf-security-audit', 'agora save mcp-github --data-dir ~/.agora']
  },
  {
    name: 'saved',
    group: 'Library',
    summary: 'List saved marketplace items',
    usage: 'agora saved [query] [--data-dir path] [--json]',
    details: 'Shows all items in your local library. Provide a keyword to filter the list.',
    flags: [
      { flag: '--data-dir', description: 'Override the Agora data directory' },
      { flag: '--json', description: 'Output list as JSON' }
    ],
    examples: ['agora saved', 'agora saved github', 'agora saved --json']
  },
  {
    name: 'remove',
    group: 'Library',
    summary: 'Remove an item from your saved library',
    usage: 'agora remove <id> [--data-dir path] [--json]',
    details: 'Deletes a saved item from the Agora state file by its id.',
    flags: [
      { flag: '--data-dir', description: 'Override the Agora data directory' },
      { flag: '--json', description: 'Output result as JSON' }
    ],
    examples: ['agora remove wf-security-audit', 'agora remove mcp-github']
  },

  // Learn
  {
    name: 'tutorials',
    group: 'Learn',
    summary: 'List available step-by-step tutorials',
    usage: 'agora tutorials [query] [--level beginner|intermediate|advanced] [--limit 20] [--json]',
    details:
      'Browses the tutorial catalog. Filter by keyword and skill level. ' +
      'Use `agora tutorial <id>` to start a specific tutorial.',
    flags: [
      { flag: '--level', description: 'Skill level: beginner, intermediate, or advanced' },
      { flag: '--limit, -n', description: 'Maximum number of results (default 20)' },
      { flag: '--json', description: 'Output as JSON' }
    ],
    examples: ['agora tutorials', 'agora tutorials mcp', 'agora tutorials --level beginner']
  },
  {
    name: 'tutorial',
    group: 'Learn',
    summary: 'Read a tutorial step-by-step',
    usage: 'agora tutorial <id> [step] [--json]',
    details:
      'Displays a single tutorial step. Omit the step number to start from step 1. ' +
      'Increment the step number to advance through the tutorial.',
    flags: [
      { flag: '--step', description: 'Step number to display (default 1)' },
      { flag: '--json', description: 'Output step as JSON' }
    ],
    examples: [
      'agora tutorial tut-mcp-basics',
      'agora tutorial tut-mcp-basics 2',
      'agora tutorial tut-mcp-basics --json'
    ]
  },

  // Community
  {
    name: 'discuss',
    group: 'Community',
    summary: 'Post a new community discussion',
    usage:
      'agora discuss --title <title> (--content <text>|--content-file path) [--category question|idea|showcase|discussion]',
    details:
      'Creates a new discussion thread via the Agora API. Requires --api-url and a token ' +
      '(via --token, AGORA_TOKEN, or `agora auth login`).',
    flags: [
      { flag: '--title', description: 'Discussion title (required)' },
      { flag: '--content', description: 'Discussion body as inline text' },
      { flag: '--content-file', description: 'Read discussion body from a file' },
      {
        flag: '--category, -c',
        description: 'Category: question, idea, showcase, discussion (default discussion)'
      },
      { flag: '--json', description: 'Output created discussion as JSON' }
    ],
    examples: [
      'agora discuss --title "MCP question" --content "How are you composing servers?" --category question',
      'agora discuss --title "My workflow" --content-file ./prompt.md --category showcase'
    ]
  },
  {
    name: 'discussions',
    group: 'Community',
    summary: 'Browse community discussions',
    usage: 'agora discussions [query] [--category question|idea|showcase|discussion] [--json]',
    details:
      'Lists community discussion threads from the Agora API. Requires --api-url. ' +
      'Filter by keyword or category.',
    flags: [
      {
        flag: '--category, -c',
        description: 'Category filter: question, idea, showcase, or discussion'
      },
      { flag: '--json', description: 'Output as JSON' }
    ],
    examples: [
      'agora discussions',
      'agora discussions --category question',
      'agora discussions mcp --json'
    ]
  },
  {
    name: 'review',
    group: 'Community',
    summary: 'Post a rating and review for a marketplace item',
    usage: 'agora review <id> --rating 5 --content <text>',
    details:
      'Submits a review to the Agora API. Requires --api-url and a token ' +
      '(via --token, AGORA_TOKEN, or `agora auth login`). Rating must be 1–5.',
    flags: [
      { flag: '--rating, -r', description: 'Star rating 1–5 (required)' },
      { flag: '--content', description: 'Review text (required)' },
      { flag: '--type, -t', description: 'Item kind: package or workflow (auto-detected)' },
      { flag: '--json', description: 'Output created review as JSON' }
    ],
    examples: [
      'agora review mcp-github --rating 5 --content "Works well"',
      'agora review wf-security-audit --rating 4 --content "Solid workflow" --type workflow'
    ]
  },
  {
    name: 'reviews',
    group: 'Community',
    summary: 'List reviews for a marketplace item',
    usage: 'agora reviews [id] [--type package|workflow] [--api-url url] [--json]',
    details:
      'Fetches reviews from the Agora API. Requires --api-url. ' +
      'Omit the id to list all recent reviews.',
    flags: [
      { flag: '--type, -t', description: 'Item kind: package or workflow' },
      { flag: '--json', description: 'Output as JSON' }
    ],
    examples: [
      'agora reviews mcp-github --api-url https://agora.example.com',
      'agora reviews --json'
    ]
  },
  {
    name: 'profile',
    group: 'Community',
    summary: 'View a community member profile',
    usage: 'agora profile <username> [--json]',
    details:
      'Retrieves a user profile from the Agora API. Requires --api-url. ' +
      'Displays packages, workflows, and discussion counts.',
    flags: [
      { flag: '--username', description: 'Username (alternative to positional argument)' },
      { flag: '--json', description: 'Output as JSON' }
    ],
    examples: ['agora profile alice', 'agora profile alice --api-url https://agora.example.com']
  },
  {
    name: 'publish',
    group: 'Community',
    summary: 'Publish a package or workflow to the marketplace',
    usage:
      'agora publish package --name <name> --description <text> --npm <package> [--token token]\n' +
      '  agora publish workflow --name <name> --description <text> --prompt-file <path> [--token token]',
    details:
      'Submits a new package or workflow to the Agora API. Requires --api-url and a token ' +
      '(via --token, AGORA_TOKEN, or `agora auth login`).',
    flags: [
      { flag: '--name', description: 'Item name (required)' },
      { flag: '--description, -d', description: 'Short description (required)' },
      { flag: '--npm', description: 'npm package name (required for MCP packages)' },
      {
        flag: '--prompt-file',
        description: 'Path to workflow prompt file (required for workflows)'
      },
      { flag: '--prompt', description: 'Workflow prompt as inline text' },
      { flag: '--version', description: 'Package version (default 1.0.0)' },
      { flag: '--category, -c', description: 'Category (default mcp)' },
      { flag: '--tags', description: 'Comma-separated tags' },
      { flag: '--repo, --repository', description: 'Repository URL' },
      { flag: '--model', description: 'Preferred model for workflow' },
      { flag: '--json', description: 'Output published item as JSON' }
    ],
    examples: [
      'agora publish package --name @you/server --description "MCP server" --npm @you/server',
      'agora publish workflow --name "My Workflow" --description "Review workflow" --prompt-file ./prompt.md'
    ]
  },
  {
    name: 'news',
    group: 'Marketplace',
    summary: 'Browse ranked tech news from HN, Reddit, GitHub, arXiv',
    usage: 'agora news [query] [--source hn|reddit|gh|arxiv] [--limit 20] [--refresh] [--json]',
    details:
      'Fetches and ranks news stories from multiple sources using a recency-engagement-topic scoring algorithm. ' +
      'Cached locally in ~/.config/agora/news-cache.jsonl. ' +
      'Use --refresh to force re-fetch; --source to filter by source; a positional query to search titles and tags.',
    flags: [
      { flag: '--source, -s', description: 'Source filter: hn, reddit, gh, arxiv' },
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
    group: 'Marketplace',
    summary: 'Daily digest: top news, community threads, and trending items from the last 24h',
    usage: 'agora today [--section news|community|market|all] [--json]',
    flags: [
      {
        flag: '--section, -s',
        description: 'Show only one section: news, community, market, or all (default all)'
      },
      { flag: '--json', description: 'Output { at, news, threads, trending } as JSON' }
    ],
    examples: ['agora today', 'agora today --section news', 'agora today --json']
  },
  {
    name: 'community',
    group: 'Community',
    summary: 'Browse community boards and threads',
    usage: 'agora community [board] [--sort top|new|active] [--json]',
    details:
      'Without a board, lists all available boards with thread counts. ' +
      'With a board (e.g. mcp, agents), lists threads in that board sorted by activity. ' +
      'Use `agora thread <id>` to read a specific thread.',
    flags: [
      { flag: '--sort', description: 'Sort order: top, new, active (default active)' },
      { flag: '--json', description: 'Output as JSON' }
    ],
    examples: ['agora community', 'agora community mcp', 'agora community agents --sort top']
  },
  {
    name: 'thread',
    group: 'Community',
    summary: 'Read a community thread with replies',
    usage: 'agora thread <id> [--json]',
    details: 'Displays a full thread with its reply tree.',
    flags: [{ flag: '--json', description: 'Output as JSON' }],
    examples: ['agora thread t-mcp-1']
  },
  {
    name: 'post',
    group: 'Community',
    summary: 'Create a new community thread',
    usage:
      'agora post --board <board> --title <title> (--content <text>|--content-file <path>) [--json]',
    details:
      'Posts a new thread to a community board. Requires --api-url and a token ' +
      '(via --token, AGORA_TOKEN, or `agora auth login`). ' +
      'Boards: mcp, agents, tools, workflows, show, ask, meta.',
    flags: [
      { flag: '--board, -b', description: 'Target board (required)' },
      { flag: '--title', description: 'Thread title (required)' },
      { flag: '--content', description: 'Thread body as inline text' },
      { flag: '--content-file', description: 'Read body from a file' },
      { flag: '--json', description: 'Output created thread as JSON' }
    ],
    examples: [
      'agora post --board mcp --title "My question" --content "How do I?"',
      'agora post --board show --title "My project" --content-file ./readme.md'
    ]
  },
  {
    name: 'reply',
    group: 'Community',
    summary: 'Reply to a thread or another reply',
    usage: 'agora reply <id> (--content <text>|--content-file <path>) [--parent-id <id>] [--json]',
    details: 'Posts a reply to an existing thread or reply. ' + 'Requires --api-url and a token.',
    flags: [
      { flag: '--content', description: 'Reply body as inline text' },
      { flag: '--content-file', description: 'Read body from a file' },
      { flag: '--parent-id', description: 'Optional parent reply id for nested replies' },
      { flag: '--json', description: 'Output as JSON' }
    ],
    examples: [
      'agora reply t-mcp-1 --content "Great point!"',
      'agora reply r-mcp-1-1 --content "Thanks"'
    ]
  },
  {
    name: 'vote',
    group: 'Community',
    summary: 'Upvote or downvote a thread or reply',
    usage: 'agora vote <id> --up|--down [--type discussion|reply] [--json]',
    details: 'Cast a vote on a community item. Requires --api-url and a token.',
    flags: [
      { flag: '--up', description: 'Upvote' },
      { flag: '--down', description: 'Downvote' },
      { flag: '--type', description: 'Target type: discussion or reply (default discussion)' },
      { flag: '--json', description: 'Output as JSON' }
    ],
    examples: ['agora vote t-mcp-1 --up', 'agora vote r-mcp-1-1 --down']
  },
  {
    name: 'admin',
    group: 'Community',
    summary: 'Maintainer-only kill-switch: hide content and view the audit log',
    usage:
      'agora admin hide <id> --reason <r> [--type discussion|reply]\n' +
      '  agora admin log [--limit 50]',
    details:
      'Requires admin privileges (AGORA_ADMIN_USER_IDS on the server). ' +
      'Every hide action is recorded in the kill_switch_log audit table. ' +
      'Use `agora admin log` to list recent entries.',
    flags: [
      { flag: '--reason', description: 'Reason for hiding content (required for hide)' },
      { flag: '--type', description: 'Target type: discussion or reply (default discussion)' },
      { flag: '--limit, -n', description: 'Max log entries to show (default 50)' },
      { flag: '--json', description: 'Output as JSON' }
    ],
    examples: [
      'agora admin hide t-mcp-1 --reason "confirmed malware"',
      'agora admin hide r-mcp-1-1 --reason "CSAM" --type reply',
      'agora admin log',
      'agora admin log --limit 20'
    ]
  },
  {
    name: 'flag',
    group: 'Community',
    summary: 'Flag a thread, reply, or marketplace item',
    usage:
      'agora flag <id> [--reason spam|harassment|undisclosed-llm|malicious|other] [--type discussion|reply|package|workflow] [--notes <text>] [--json]',
    details:
      'Flags content for moderator review. Community items require --api-url and a token. ' +
      'Marketplace items (packages/workflows) can be flagged without API auth.',
    flags: [
      {
        flag: '--reason',
        description: 'Reason: spam, harassment, undisclosed-llm, malicious, other'
      },
      { flag: '--type', description: 'Target type: discussion, reply, package, workflow' },
      { flag: '--notes', description: 'Optional notes for moderators' },
      { flag: '--json', description: 'Output as JSON' }
    ],
    examples: ['agora flag t-mcp-1 --reason spam', 'agora flag mcp-github --reason malicious']
  },
  {
    name: 'auth',
    group: 'Community',
    summary: 'Manage Agora API credentials',
    usage:
      'agora auth login [--api-url url] [--data-dir path]\n' +
      '  agora auth login --token <token> [--api-url url]\n' +
      '  agora auth status [--data-dir path] [--json]\n' +
      '  agora auth logout [--data-dir path]',
    details:
      'Stores or clears API credentials in the Agora state file. ' +
      'Without --token, runs the device-code login flow: opens your browser to ' +
      'authorize via GitHub and returns a short-lived JWT. ' +
      'Pass --token (or set AGORA_TOKEN / AGORA_API_TOKEN) for headless/CI use. ' +
      'Saved credentials are used automatically by write commands.',
    flags: [
      { flag: '--token', description: 'API auth token (also AGORA_TOKEN / AGORA_API_TOKEN env)' },
      { flag: '--api-url', description: 'Override AGORA_API_URL for stored auth' },
      { flag: '--data-dir', description: 'Override the Agora data directory' },
      { flag: '--json', description: 'Output status as JSON' }
    ],
    examples: [
      'agora auth login --api-url https://api.agora.example.com',
      'agora auth login --token $AGORA_TOKEN --api-url https://agora.example.com',
      'agora auth status',
      'agora auth logout'
    ]
  },
  {
    name: 'preferences',
    group: 'Setup',
    summary: 'View or set local preferences',
    usage: 'agora preferences [<key> <value>] [--json]',
    details:
      'Preferences are stored locally on disk and work without an account. ' +
      'Keys: theme (dark|light|auto), verbosity (verbose|medium|quiet), ' +
      'username, email, bio.',
    flags: [{ flag: '--json', description: 'Output preferences as JSON' }],
    examples: [
      'agora preferences',
      'agora preferences theme light',
      'agora preferences verbosity quiet',
      'agora preferences username "Jane Doe"'
    ]
  },
  {
    name: 'history',
    group: 'Setup',
    summary: 'View search and chat history',
    usage: 'agora history [--limit N] [--clear] [--json]',
    details:
      'Shows recent searches and chat messages. History is stored locally and ' +
      'works offline. Use --clear to erase all history.',
    flags: [
      { flag: '--limit', description: 'Number of entries to show (default: 50)' },
      { flag: '--clear', description: 'Clear all history' },
      { flag: '--json', description: 'Output as JSON' }
    ],
    examples: ['agora history', 'agora history --limit 10', 'agora history --clear']
  },
  {
    name: 'completions',
    group: 'Setup',
    summary: 'Generate shell completion scripts for bash, zsh, or fish',
    usage: 'agora completions bash|zsh|fish',
    details:
      "Generates shell completion scripts for the agora CLI. Pipe the output to your shell's " +
      'completions directory or source it directly. Completions include all commands, flags, ' +
      'marketplace IDs, categories, and common option values.',
    examples: [
      'agora completions bash > /usr/local/etc/bash_completion.d/agora',
      'agora completions zsh > /usr/local/share/zsh/site-functions/_agora',
      'agora completions fish > ~/.config/fish/completions/agora.fish',
      'eval "$(agora completions bash)"'
    ]
  },
  {
    name: 'shell',
    group: 'Setup',
    summary: 'Start the interactive Agora shell (bash + chat hybrid)',
    usage: 'agora shell [--verbose|--quiet]',
    details:
      'Opens an interactive REPL that dispatches between bash and AI chat. ' +
      'Commands found on PATH run as bash; questions and everything else go to AI. ' +
      'Special prefixes: !<cmd> force bash, ?<msg> force chat. ' +
      'Type /help to see all meta commands. History is persisted across sessions. ' +
      'Shell meta-commands: /env to view or set tracked environment variables.',
    flags: [
      { flag: '--verbose', description: 'Detailed AI responses' },
      { flag: '--quiet', description: 'Minimal AI responses' }
    ],
    examples: ['agora shell']
  },
  {
    name: 'export',
    group: 'Marketplace',
    summary: 'Export marketplace data in various formats',
    usage:
      'agora export [format] [query] [--category all|mcp|prompt|workflow] [--format json|csv|markdown|table] [--limit N] [--api]',
    details:
      'Exports all marketplace items matching the optional query and category filters. ' +
      'Pass the format as the first positional argument (json, csv, markdown, table) or use --format. ' +
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
      'agora export json',
      'agora export csv mcp',
      'agora export --format csv',
      'agora export --format markdown',
      'agora export --category mcp --limit 20'
    ]
  },
  {
    name: 'watch',
    group: 'Marketplace',
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
    group: 'Marketplace',
    summary: 'Open a marketplace item or URL in the browser',
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
    group: 'Marketplace',
    summary: 'Print a shareable markdown snippet for a marketplace item',
    usage: 'agora share <id> [--json]',
    details:
      'Produces a markdown blurb with the item name, description, link, tags, and install ' +
      'command — paste-ready for a community post, README, or chat message.',
    flags: [{ flag: '--json', description: 'Output { id, name, link, snippet } as JSON' }],
    examples: ['agora share mcp-github', 'agora share mcp-filesystem --json']
  },
  {
    name: 'author',
    group: 'Marketplace',
    summary: 'List marketplace items by a specific author',
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
    name: 'ping',
    group: 'Setup',
    summary: 'Check the configured backend is reachable',
    usage: 'agora ping [--api-url <url>] [--json]',
    details:
      'Sends a GET /api/community/boards to the configured backend and reports the HTTP ' +
      'status, response time, and whether the request was authenticated. Picks the URL ' +
      'from --api-url, AGORA_API_URL, or the persisted auth state in that order.',
    flags: [
      { flag: '--api-url <url>', description: 'Override the backend URL' },
      { flag: '--json', description: 'Output { apiUrl, status, okBoards, durationMs } as JSON' }
    ],
    examples: ['agora ping', 'agora ping --api-url https://api.agora.example', 'agora ping --json']
  },
  {
    name: 'bookmarks',
    group: 'Library',
    summary: 'View all bookmarked marketplace items and news',
    usage: 'agora bookmarks [--kind marketplace|news|all] [--data-dir path] [--json]',
    details:
      'Shows saved marketplace items and saved news stories in two sections. ' +
      'Use --kind to filter to one section. News bookmarks are set in the TUI news page.',
    flags: [
      { flag: '--kind', description: 'Filter: marketplace, news, or all (default all)' },
      { flag: '--data-dir', description: 'Override the Agora data directory' },
      { flag: '--json', description: 'Output { marketplace, news } as JSON' }
    ],
    examples: ['agora bookmarks', 'agora bookmarks --kind marketplace', 'agora bookmarks --json']
  },
  {
    name: 'welcome',
    group: 'Setup',
    summary: 'Show a guided onboarding tour of the agora CLI',
    usage: 'agora welcome [--json]',
    details:
      'Displays a six-section guide covering sign-in, the marketplace, news, community, ' +
      'shell completions, and scaffolding an MCP project. ' +
      'Step 1 adapts to show your profile commands when you are already signed in. ' +
      'Use --json to get a machine-readable list of steps.',
    flags: [{ flag: '--json', description: 'Output { signedIn, username?, steps } as JSON' }],
    examples: ['agora welcome', 'agora welcome --json']
  },
  {
    name: 'curate',
    group: 'Marketplace',
    summary: 'Run AI-powered curation to discover and verify marketplace items',
    usage:
      'agora curate [--refresh | --force] [--limit 50] [--concurrency 4] [--stale-days 30] [--status]',
    details:
      'Discovers MCP servers and tools from GitHub and HuggingFace, then uses AI to verify ' +
      'each item is a genuine MCP server/prompt/skill and extract metadata. Results are cached ' +
      'locally and used by the marketplace search. Three modes are available: incremental ' +
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
  },
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
  {
    name: 'notify',
    group: 'Setup',
    summary: 'Send a desktop notification via macOS, Linux, or Windows',
    usage: 'agora notify <message> [--title "Agora"] [--sound] [--json]',
    details:
      'Sends a native desktop notification. Uses osascript on macOS, notify-send on Linux, ' +
      'and PowerShell toast notifications on Windows.',
    flags: [
      { flag: '--title, -t', description: 'Notification title (default: Agora)' },
      { flag: '--sound', description: 'Play notification sound' },
      { flag: '--json', description: 'Output as JSON' }
    ],
    examples: [
      'agora notify "Install complete"',
      'agora notify "Deploy finished" --title "CI" --sound',
      'agora watch 60 agora news --count 1 && agora notify "News updated"'
    ]
  }
];
