// Merging a compilation into .claude/settings.json without touching anything
// that is not Agora's: other hooks, other keys, and allow rules a person wrote.
// Agora's own allow rules are tracked in .agora/compiled.json, so a rule that
// leaves agora.cedar also leaves settings.json, and nothing else does.

import type { ClaudeCodeCompilation } from './claude-code.js';

export const MANAGED_FILE = '.agora/compiled.json';

export interface Managed {
  host: 'claude-code';
  allow: string[];
}

export interface SettingsChange {
  hooks: string[];
  added: string[];
  removed: string[];
}

const isAgoraHook = (h: unknown): boolean =>
  typeof h === 'object' &&
  h !== null &&
  Array.isArray((h as { hooks?: unknown }).hooks) &&
  (h as { hooks: { command?: unknown }[] }).hooks.some(
    (c) => typeof c.command === 'string' && c.command.startsWith('agora hook')
  );

export function mergeSettings(
  doc: Record<string, unknown>,
  compilation: ClaudeCodeCompilation,
  previous: Managed | undefined
): { doc: Record<string, unknown>; managed: Managed; change: SettingsChange } {
  const next: Record<string, unknown> = { ...doc };

  const hooks =
    typeof doc.hooks === 'object' && doc.hooks !== null
      ? { ...(doc.hooks as Record<string, unknown>) }
      : {};
  const changedHooks: string[] = [];
  for (const [event, entry] of Object.entries(compilation.hooks)) {
    const list = Array.isArray(hooks[event]) ? [...(hooks[event] as unknown[])] : [];
    const at = list.findIndex(isAgoraHook);
    if (at >= 0 && JSON.stringify(list[at]) === JSON.stringify(entry)) continue;
    if (at >= 0) list[at] = entry;
    else list.push(entry);
    hooks[event] = list;
    changedHooks.push(event);
  }
  next.hooks = hooks;

  const permissions =
    typeof doc.permissions === 'object' && doc.permissions !== null
      ? { ...(doc.permissions as Record<string, unknown>) }
      : {};
  const existing = Array.isArray(permissions.allow)
    ? (permissions.allow as unknown[]).filter((r): r is string => typeof r === 'string')
    : [];
  const prevManaged = new Set(previous?.allow ?? []);
  const want = new Set(compilation.allow);
  // Keep every rule a person wrote; drop only Agora's own stale ones.
  const kept = existing.filter((r) => !prevManaged.has(r) || want.has(r));
  const removed = existing.filter((r) => prevManaged.has(r) && !want.has(r));
  const added = compilation.allow.filter((r) => !existing.includes(r));
  const allow = [...kept, ...added];
  if (allow.length || 'allow' in permissions) permissions.allow = allow;
  if (Object.keys(permissions).length) next.permissions = permissions;

  // Rules a person already had are not Agora's to remove later.
  const managed: Managed = {
    host: 'claude-code',
    allow: compilation.allow.filter((r) => prevManaged.has(r) || !existing.includes(r))
  };
  return { doc: next, managed, change: { hooks: changedHooks, added, removed } };
}
