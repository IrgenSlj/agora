// Commands that existed in v0.6.1 and no longer do.
//
// Removing a command is a promise broken. `Unknown command: news` tells a user
// nothing: not that it was deliberate, not which version did it, not what to
// use instead. They are left assuming a broken install.
//
// So every removal names itself, says why, and points at the nearest thing
// that still works. Where there is no replacement, it says that plainly rather
// than inventing one — a wrong redirect is worse than an honest dead end.
//
// These entries are cheap to keep and can be dropped at 2.0.0, by which point
// anyone still typing `agora saved` has had a release cycle to notice.

export interface RetiredCommand {
  /** What replaced it, or undefined when nothing did. */
  replacement?: string;
  why: string;
}

export const RETIRED_COMMANDS: Record<string, RetiredCommand> = {
  // ── the account layer: deleted outright, no replacement ──────────────────
  auth: { why: 'Agora has no accounts and stores no credentials.' },
  login: { why: 'Agora has no accounts and stores no credentials.' },
  logout: { why: 'Agora has no accounts and stores no credentials.' },
  whoami: { why: 'Agora has no accounts and stores no credentials.' },

  // ── the community backend: deleted (brief D6) ────────────────────────────
  author: { why: 'Profiles and the community backend were removed.' },
  share: { why: 'The community backend was removed.' },
  compare: { why: 'Removed with the v1 catalog surface.' },
  similar: { why: 'Removed with the v1 catalog surface.' },
  bookmarks: { why: 'Saved items were removed; nothing is stored server-side.' },
  save: { why: 'Saved items were removed; nothing is stored server-side.' },
  saved: { why: 'Saved items were removed; nothing is stored server-side.' },
  tutorial: { why: 'Tutorials were removed with the community backend.' },
  tutorials: { why: 'Tutorials were removed with the community backend.' },

  // ── superseded by the trust plane ────────────────────────────────────────
  curate: {
    replacement: 'agora search',
    why: 'Curation was replaced by multi-source federation over real registries.'
  },
  trending: {
    replacement: 'agora today',
    why: 'Trending folded into the daily digest.'
  },
  news: {
    replacement: 'agora today',
    why: 'The news reader folded into the daily digest.'
  },
  chat: {
    replacement: 'agora',
    why: 'Chat moved into the shell — run `agora` with no arguments and type.'
  },
  use: {
    replacement: 'agora acquire',
    why: 'Installing now runs through the gate rather than writing config directly.'
  },
  workflows: {
    replacement: 'agora search --kind agent-skill',
    why: 'The workflow artifact kind was retired; v2 has mcp-server and agent-skill.'
  }
};

/**
 * The message shown when someone runs a retired command.
 *
 * Exits 2 (usage), not 0 — a script that called `agora saved` did not succeed,
 * and telling it otherwise would hide the breakage rather than surface it.
 */
export function retiredMessage(name: string, entry: RetiredCommand, version: string): string {
  const lines = [`\`agora ${name}\` was removed in v${version}.`, `  ${entry.why}`];
  if (entry.replacement) lines.push('', `  Use \`${entry.replacement}\` instead.`);
  lines.push('', '  Run `agora help` to see the current commands.');
  return lines.join('\n');
}
