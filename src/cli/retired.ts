// Commands that existed in an earlier release and no longer do.
//
// Removing a command is a promise broken. `Unknown command: search` reads as a
// broken install. Every removal names itself, says why, and points at the
// nearest thing that still works, or says plainly that nothing does.

export interface RetiredCommand {
  /** What replaced it, or undefined when nothing did. */
  replacement?: string;
  /** The release that removed it. */
  since: string;
  why: string;
}

const PIVOT =
  'Agora 0.9 narrowed to one job: a written limit for coding agents and a receipt for ' +
  'what they did. Finding and installing tools is left to the hosts and registries.';
const STACK =
  'The agora.toml stack manager was removed with the 0.9 narrowing. Hosts manage their ' +
  'own MCP servers; Agora now reads their configs and never installs into them.';
const RETURNS = (what: string) =>
  `${STACK} \`${what}\` returns in a later release as the policy compiler: agora.cedar ` +
  "translated into each host's native permissions.";

const at = (since: string, why: string, replacement?: string): RetiredCommand =>
  replacement ? { since, why, replacement } : { since, why };

export const RETIRED_COMMANDS: Record<string, RetiredCommand> = {
  // ── 0.9.0: discovery and installation ───────────────────────────────────
  search: at('0.9.0', PIVOT),
  info: at('0.9.0', PIVOT),
  browse: at('0.9.0', PIVOT),
  open: at('0.9.0', PIVOT),
  install: at('0.9.0', PIVOT),
  acquire: at('0.9.0', PIVOT),
  try: at('0.9.0', PIVOT),
  approve: at('0.9.0', 'Install requests were removed with installation itself.'),
  mcp: at('0.9.0', 'The agent-facing MCP server existed to search and install; both were removed.'),
  scan: at('0.9.0', 'The regex pre-install scan was removed; it gave weak signal.', 'agora audit'),
  verify: at(
    '0.9.0',
    'The regex pre-install scan was removed; it gave weak signal.',
    'agora audit'
  ),
  trust: at(
    '0.9.0',
    'The per-artifact verdict view was removed with the pre-install scan.',
    'agora audit'
  ),
  export: at('0.9.0', 'Evidence bundles are replaced by per-commit receipts in a later release.'),
  outdated: at('0.9.0', PIVOT),
  refresh: at('0.9.0', 'There is no catalog left to refresh.'),
  today: at('0.9.0', 'The daily digest was removed with the 0.9 narrowing.'),
  watch: at('0.9.0', 'Removed with the daily digest.'),
  notify: at('0.9.0', 'Removed with the daily digest.'),
  welcome: at('0.9.0', 'Bare `agora` prints the command list.', 'agora'),
  init: at('0.9.0', 'Project scaffolding was removed with the plugin tools.', 'agora policy init'),
  integrate: at(
    '0.9.0',
    'Harness integration installed the removed plugin tools.',
    'agora hook install'
  ),
  config: at(
    '0.9.0',
    'OpenCode config editing was removed with the 0.9 narrowing.',
    'agora doctor'
  ),
  show: at('0.9.0', 'OpenCode config editing was removed with the 0.9 narrowing.', 'agora doctor'),
  edit: at('0.9.0', 'OpenCode config editing was removed with the 0.9 narrowing.'),
  diff: at('0.9.0', 'OpenCode config editing was removed with the 0.9 narrowing.'),
  preferences: at('0.9.0', 'Agora keeps no preferences any more.'),
  history: at('0.9.0', 'Agora keeps no search history any more.'),

  // ── 0.9.0: the agora.toml stack manager ─────────────────────────────────
  plan: at('0.9.0', RETURNS('plan')),
  apply: at('0.9.0', RETURNS('apply')),
  freeze: at('0.9.0', STACK),
  sync: at('0.9.0', STACK),
  update: at('0.9.0', STACK),
  remove: at('0.9.0', STACK),
  installed: at('0.9.0', STACK, 'agora doctor'),
  lock: at('0.9.0', `${STACK} Receipts replace the lockfile in a later release.`),
  capabilities: at('0.9.0', STACK),
  quarantine: at('0.9.0', STACK),
  unquarantine: at('0.9.0', STACK),

  // ── earlier removals ────────────────────────────────────────────────────
  auth: at('0.7.0', 'Agora has no accounts and stores no credentials.'),
  login: at('0.7.0', 'Agora has no accounts and stores no credentials.'),
  logout: at('0.7.0', 'Agora has no accounts and stores no credentials.'),
  whoami: at('0.7.0', 'Agora has no accounts and stores no credentials.'),
  author: at('0.7.0', 'Profiles and the community backend were removed.'),
  share: at('0.7.0', 'The community backend was removed.'),
  compare: at('0.7.0', 'Removed with the v1 catalog surface.'),
  similar: at('0.7.0', 'Removed with the v1 catalog surface.'),
  bookmarks: at('0.7.0', 'Saved items were removed; nothing is stored server-side.'),
  save: at('0.7.0', 'Saved items were removed; nothing is stored server-side.'),
  saved: at('0.7.0', 'Saved items were removed; nothing is stored server-side.'),
  tutorial: at('0.7.0', 'Tutorials were removed with the community backend.'),
  tutorials: at('0.7.0', 'Tutorials were removed with the community backend.'),
  curate: at('0.7.0', 'Curation was removed; there is no catalog left to curate.'),
  trending: at('0.7.0', 'Removed with the catalog and the daily digest.'),
  news: at('0.7.0', 'Removed with the daily digest.'),
  chat: at('0.7.0', 'Agora ships no chat.'),
  use: at('0.7.0', PIVOT),
  workflows: at('0.7.0', 'The workflow artifact kind was retired.'),
  shell: at('0.7.0', 'The interactive shell was a second place to run the same commands.'),
  tui: at('0.7.0', 'The full-screen browser was a second UI over the same commands.')
};

/**
 * The message shown when someone runs a retired command. Exits 2 (usage): a
 * script that called a removed command did not succeed.
 */
export function retiredMessage(name: string, entry: RetiredCommand): string {
  const lines = [`\`agora ${name}\` was removed in v${entry.since}.`, `  ${entry.why}`];
  if (entry.replacement) lines.push('', `  Use \`${entry.replacement}\` instead.`);
  lines.push('', '  Run `agora help` to see the current commands.');
  return lines.join('\n');
}
