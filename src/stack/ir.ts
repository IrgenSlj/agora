/**
 * Ring 1.5 — a small typed IR for skills/rules so translation between harness
 * dialects becomes a compile step (brief D9 / P3). TYPES + PARSER SIGNATURES
 * ONLY until Ring 1 (server + instruction-file sync) is stable; implementations
 * are deliberately deferred.
 *
 * Dialects: Claude Code skill (SKILL.md + frontmatter), OpenCode skill, Cursor
 * rule (.cursor/rules/*.mdc), and plain AGENTS.md / CLAUDE.md instruction files.
 */

export type SkillDialect = 'claude-code' | 'opencode' | 'cursor' | 'agents-md';

/** Frontmatter fields common enough across dialects to model as first-class. */
export interface SkillFrontmatter {
  name: string;
  description?: string;
  /** When the agent should reach for this skill. */
  whenToUse?: string;
  /** Tool grants (harness-specific vocab preserved on `extra`). */
  allowedTools?: string[];
  disallowedTools?: string[];
  /** Glob activation patterns (Cursor `globs`, Claude `paths`). */
  paths?: string[];
  model?: string;
  /** Dialect-specific frontmatter not modeled above, preserved verbatim. */
  extra?: Record<string, unknown>;
}

/** The dialect-neutral intermediate representation of a skill/rule. */
export interface SkillIR {
  frontmatter: SkillFrontmatter;
  /** The markdown body (the instructions). */
  body: string;
  /** Dialect this IR was parsed from, for round-trip fidelity. */
  origin?: SkillDialect;
}

/** Parse a dialect's on-disk artifact into the IR. (Impl deferred — Ring 1.5.) */
export type SkillParser = (raw: string, path?: string) => SkillIR;

/** Serialize the IR into a target dialect's on-disk form. (Impl deferred.) */
export type SkillSerializer = (ir: SkillIR) => string;

/** A registered dialect: how to read it and how to write it. */
export interface SkillDialectAdapter {
  dialect: SkillDialect;
  parse: SkillParser;
  serialize: SkillSerializer;
}
