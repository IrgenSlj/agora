import type { CommandMeta } from './types.js';

export const COMMANDS: CommandMeta[] = [
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
];
