export type AgentToolId = 'opencode' | 'claude-code' | 'cursor' | 'windsurf';

export interface StackEnv {
  cwd?: string;
  home?: string;
  env?: Record<string, string | undefined>;
}

export interface ToolConfigLocation {
  path: string;
  scope: 'project' | 'user';
}

export interface ConfiguredServer {
  name: string;
  tool: AgentToolId;
  scope: 'project' | 'user';
  configPath: string;
  transport: 'local' | 'remote';
  command?: string[]; // local: normalized argv ([cmd, ...args])
  url?: string; // remote
  env?: Record<string, string>;
  enabled: boolean; // default true when unspecified
  raw: unknown; // original entry, untouched
}

export interface DesiredServer {
  name: string;
  command?: string[];
  url?: string;
  env?: Record<string, string>;
  enabled?: boolean;
}

export interface SyncChange {
  added: string[];
  updated: string[];
  removed: string[];
}

// ── Instruction artifacts (P3) ─────────────────────────────────────────────────
// Managed instruction/memory files: CLAUDE.md, AGENTS.md, .cursor/rules/*,
// OpenCode instruction files. "Memory management" = versioned, diffable,
// syncable instruction artifacts (brief D8). Semantic/embedding memory is out
// of scope. These are additive to the adapter contract and OPTIONAL — an adapter
// that does not manage instructions simply omits the two methods below.

/** An instruction artifact discovered on disk for a given harness. */
export interface ConfiguredInstruction {
  /** Stable logical id across harnesses, e.g. a basename like "contributing". */
  name: string;
  tool: AgentToolId;
  scope: 'project' | 'user';
  /** Absolute path of the instruction file. */
  path: string;
  /** sha256 of the file's normalized content — the drift/diff baseline. */
  contentHash: string;
}

/** A desired instruction artifact in a profile — content by value or by reference. */
export interface DesiredInstruction {
  name: string;
  /** Where the content comes from: inline literal, a local file, or a URL. */
  source: 'inline' | 'file' | 'url';
  /** For `source: 'inline'` — the literal content. */
  content?: string;
  /** For `source: 'file' | 'url'` — the location to read from. */
  ref?: string;
  /** Target path relative to the harness's instruction root, when it matters. */
  targetPath?: string;
}

export interface ToolAdapter {
  id: AgentToolId;
  displayName: string;
  locations(opts: StackEnv): ToolConfigLocation[]; // priority order
  readServers(opts: StackEnv): ConfiguredServer[]; // skip missing/invalid files gracefully
  /** Config location this adapter can WRITE to for the given scope. Subset of locations(). */
  writeLocation(opts: StackEnv, scope: 'project' | 'user'): ToolConfigLocation | null;
  /**
   * Reconcile the given desired servers into the config file at `location`.
   * MUST preserve every other key in the existing file untouched; only the
   * MCP section is modified. Atomic write. `prune` removes configured servers
   * whose name is not in `desired`; without prune, only add/update.
   * Returns the applied change set.
   */
  writeServers(
    location: ToolConfigLocation,
    desired: DesiredServer[],
    opts: { prune: boolean }
  ): SyncChange;

  /** Optional (P3): read managed instruction artifacts this harness supports. */
  readInstructions?(opts: StackEnv): ConfiguredInstruction[];
  /**
   * Optional (P3): reconcile desired instruction artifacts into this harness.
   * Same contract discipline as writeServers — preserve every unrelated file,
   * atomic writes only, return the applied change set.
   */
  writeInstructions?(
    location: ToolConfigLocation,
    desired: DesiredInstruction[],
    opts: { prune: boolean }
  ): SyncChange;
}

/**
 * Not part of the locked ToolAdapter contract — a small additive extension
 * (P3) so orchestration code (stack/sync.ts) can ask an adapter WHERE its
 * instruction artifacts live for a given scope, the same way `writeLocation`
 * answers that question for MCP servers. `writeInstructions`'s `location`
 * param is deliberately generic (`ToolConfigLocation`) in the authored
 * contract, so each adapter that implements instructions also exposes this
 * resolver; callers narrow to it with an `as` when they know it's present.
 */
export interface AdapterInstructionsLocation {
  instructionsLocation(opts: StackEnv, scope: 'project' | 'user'): ToolConfigLocation | null;
}
