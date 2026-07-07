import type { CommandMeta } from './types.js';

export const COMMANDS: CommandMeta[] = [
  {
    name: 'auth',
    group: 'Setup',
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
      'Copies a workflow from the catalog into .opencode/skills/ and registers it in opencode.json ' +
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
    summary: 'Open the full-screen Agora TUI (Home · Stack · Market · News · Settings)',
    usage: 'agora tui',
    details:
      'Opens the keyboard-driven TUI with five pages, switched by 1-5 or Tab. ' +
      'j/k navigates, Enter drills in, Esc backs out, ? toggles help, q quits. ' +
      'Pages: Home (recommendation engine), Stack (your MCP servers across every ' +
      'harness — health, drift, probe), Search (federated catalog + gated ' +
      'acquire), News (ranked feed), Settings (account, display, sources).',
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
      'catalog IDs, categories, and common option values.',
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
    name: 'welcome',
    group: 'Setup',
    summary: 'Show a guided onboarding tour of the agora CLI',
    usage: 'agora welcome [--json]',
    details:
      'Displays a five-section guide covering sign-in, the catalog, news, ' +
      'shell completions, and scaffolding an MCP project. ' +
      'Step 1 adapts to show your saved-items commands when you are already signed in. ' +
      'Use --json to get a machine-readable list of steps.',
    flags: [{ flag: '--json', description: 'Output { signedIn, username?, steps } as JSON' }],
    examples: ['agora welcome', 'agora welcome --json']
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
