import type { CommandMeta } from './types.js';

export const COMMANDS: CommandMeta[] = [
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
];
