import type { CommandMeta } from './types.js';

// This file used to hold the full community-boards command group (community,
// thread, post, reply, vote, flag, admin, discussions, discuss, publish,
// review, reviews, profile). That surface is frozen per AGORA_BRIEF.md D4/D11
// — see docs/frozen/README.md. `auth` is the only survivor: it isn't
// community-specific, it's the shared credential store other live-hub
// features (e.g. src/live/search.ts) still read.
export const COMMANDS: CommandMeta[] = [
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
  }
];
