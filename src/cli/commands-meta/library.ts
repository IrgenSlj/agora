import type { CommandMeta } from './types.js';

export const COMMANDS: CommandMeta[] = [
  {
    name: 'save',
    group: 'Library',
    summary: 'Save a catalog item to your local library',
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
    summary: 'List saved catalog items',
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
  {
    name: 'bookmarks',
    group: 'Library',
    summary: 'View all bookmarked catalog items and news',
    usage: 'agora bookmarks [--kind catalog|news|all] [--data-dir path] [--json]',
    details:
      'Shows saved catalog items and saved news stories in two sections. ' +
      'Use --kind to filter to one section. News bookmarks are set in the TUI news page.',
    flags: [
      { flag: '--kind', description: 'Filter: catalog, news, or all (default all)' },
      { flag: '--data-dir', description: 'Override the Agora data directory' },
      { flag: '--json', description: 'Output { catalog, news } as JSON' }
    ],
    examples: ['agora bookmarks', 'agora bookmarks --kind catalog', 'agora bookmarks --json']
  }
];
