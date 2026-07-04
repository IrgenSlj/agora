import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { atomicWriteFile } from '../atomic-write.js';
import type { FetchLike } from '../live.js';
import type { ConfiguredServer, StackEnv } from './types.js';

// ── Public types ──────────────────────────────────────────────────────────────

export interface ManifestEntry {
  command?: string[];
  url?: string;
  env?: Record<string, string>;
  enabled?: boolean; // omit when true (default)
  descriptionDigest?: string;
}

/**
 * A managed instruction artifact in the profile (P3): CLAUDE.md, AGENTS.md,
 * .cursor/rules/*, OpenCode instruction files — tracked by path + content hash,
 * with `source` for shareable profiles. Content lives inline, in a file, or at
 * a URL; a URL/file profile is resolved (and scan-gated) at sync time.
 *
 * NOTE: TOML parser/serializer support for this section lands in P3. Until then
 * nothing populates `StackManifest.instructions`, so no round-trip drop occurs.
 */
export interface InstructionManifestEntry {
  source?: 'inline' | 'file' | 'url';
  /** For source==='inline'. */
  content?: string;
  /** For source==='file'|'url'. */
  ref?: string;
  /** sha256 of the resolved content — drift baseline. */
  contentHash?: string;
  enabled?: boolean;
}

export interface StackManifest {
  mcp: Record<string, ManifestEntry>;
  skills?: Record<string, ManifestEntry>;
  workflows?: Record<string, ManifestEntry>;
  /** Managed instruction/memory artifacts (P3). */
  instructions?: Record<string, InstructionManifestEntry>;
}

// ── Path helper ───────────────────────────────────────────────────────────────

export function manifestPath(env: StackEnv): string {
  const override = env.env?.AGORA_STACK_FILE;
  if (override) return override;
  const cwd = env.cwd ?? process.cwd();
  return join(cwd, 'agora.toml');
}

// ── opencodeEntryToManifest ───────────────────────────────────────────────────

export type OpencodeMcpEntry =
  | { type: 'local'; command: string[]; environment?: Record<string, string>; enabled?: boolean }
  | { type: 'remote'; url: string; enabled?: boolean };

export function opencodeEntryToManifest(entry: OpencodeMcpEntry): ManifestEntry {
  const result: ManifestEntry = {};
  if (entry.type === 'local') {
    result.command = entry.command;
    if (entry.environment && Object.keys(entry.environment).length > 0) {
      result.env = entry.environment;
    }
  } else {
    result.url = entry.url;
  }
  if (entry.enabled === false) {
    result.enabled = false;
  }
  if ('descriptionDigest' in entry) {
    result.descriptionDigest = (entry as { descriptionDigest?: string }).descriptionDigest;
  }
  return result;
}

// ── serverToEntry ─────────────────────────────────────────────────────────────

export function serverToEntry(server: ConfiguredServer): ManifestEntry {
  const entry: ManifestEntry = {};
  if (server.transport === 'local' && server.command) {
    entry.command = server.command;
  } else if (server.transport === 'remote' && server.url) {
    entry.url = server.url;
  }
  if (server.env && Object.keys(server.env).length > 0) {
    entry.env = server.env;
  }
  if (server.enabled === false) {
    entry.enabled = false;
  }
  return entry;
}

// ── Content hashing (P3 instructions) ──────────────────────────────────────────

/** sha256 of resolved instruction content — the drift/diff baseline (D8, P3). */
export function hashContent(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

// ── TOML serializer ───────────────────────────────────────────────────────────

function needsQuoting(seg: string): boolean {
  return !/^[A-Za-z0-9_-]+$/.test(seg);
}

function tomlSegment(seg: string): string {
  if (needsQuoting(seg)) {
    return `"${escapeString(seg)}"`;
  }
  return seg;
}

// Escapes backslash, double-quote, and newline/carriage-return so multi-line
// instruction content (P3 `content` field) round-trips through a single
// TOML line without breaking the line-based parser below.
function escapeString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

function serializeStringArray(arr: string[]): string {
  return '[' + arr.map((s) => `"${escapeString(s)}"`).join(', ') + ']';
}

function serializeSection(
  section: string,
  entries: Record<string, ManifestEntry>,
  lines: string[]
): void {
  const names = Object.keys(entries).sort();
  for (const name of names) {
    const entry = entries[name];
    const seg = tomlSegment(name);
    lines.push(`[${section}.${seg}]`);
    if (entry.command !== undefined) {
      lines.push(`command = ${serializeStringArray(entry.command)}`);
    }
    if (entry.url !== undefined) {
      lines.push(`url = "${escapeString(entry.url)}"`);
    }
    if (entry.enabled === false) {
      lines.push(`enabled = false`);
    }
    if (entry.descriptionDigest !== undefined) {
      lines.push(`description_digest = "${escapeString(entry.descriptionDigest)}"`);
    }
    if (entry.env && Object.keys(entry.env).length > 0) {
      lines.push(`[${section}.${seg}.env]`);
      for (const key of Object.keys(entry.env).sort()) {
        lines.push(`${key} = "${escapeString(entry.env[key]!)}"`);
      }
    }
    lines.push('');
  }
}

// P3: instructions entries have a different field set than ManifestEntry
// (source/content/ref/content_hash instead of command/url/env), so they get
// their own serializer following the exact same style as serializeSection.
function serializeInstructionsSection(
  entries: Record<string, InstructionManifestEntry>,
  lines: string[]
): void {
  const names = Object.keys(entries).sort();
  for (const name of names) {
    const entry = entries[name];
    const seg = tomlSegment(name);
    lines.push(`[instructions.${seg}]`);
    if (entry.source !== undefined) {
      lines.push(`source = "${escapeString(entry.source)}"`);
    }
    if (entry.content !== undefined) {
      lines.push(`content = "${escapeString(entry.content)}"`);
    }
    if (entry.ref !== undefined) {
      lines.push(`ref = "${escapeString(entry.ref)}"`);
    }
    if (entry.contentHash !== undefined) {
      lines.push(`content_hash = "${escapeString(entry.contentHash)}"`);
    }
    if (entry.enabled === false) {
      lines.push(`enabled = false`);
    }
    lines.push('');
  }
}

export function serializeManifest(m: StackManifest): string {
  const lines: string[] = ['# agora stack manifest', ''];

  if (m.mcp && Object.keys(m.mcp).length > 0) {
    serializeSection('mcp', m.mcp, lines);
  }
  if (m.skills && Object.keys(m.skills).length > 0) {
    serializeSection('skills', m.skills, lines);
  }
  if (m.workflows && Object.keys(m.workflows).length > 0) {
    serializeSection('workflows', m.workflows, lines);
  }
  if (m.instructions && Object.keys(m.instructions).length > 0) {
    serializeInstructionsSection(m.instructions, lines);
  }

  // Remove trailing blank line to get a clean file
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.join('\n') + '\n';
}

// ── TOML parser ───────────────────────────────────────────────────────────────

const KNOWN_SECTIONS = new Set(['mcp', 'skills', 'workflows', 'instructions']);
const KNOWN_ENTRY_KEYS = new Set(['command', 'url', 'enabled', 'description_digest']);
const KNOWN_INSTRUCTION_KEYS = new Set(['source', 'content', 'ref', 'content_hash', 'enabled']);

function parseTomlString(raw: string, lineNum: number): string {
  if (!raw.startsWith('"') || !raw.endsWith('"') || raw.length < 2) {
    throw new Error(`Line ${lineNum}: expected a double-quoted string, got: ${raw}`);
  }
  const inner = raw.slice(1, -1);
  // Unescape \" \\ \n \r (minimal)
  let result = '';
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '\\') {
      i++;
      if (inner[i] === '"') result += '"';
      else if (inner[i] === '\\') result += '\\';
      else if (inner[i] === 'n') result += '\n';
      else if (inner[i] === 'r') result += '\r';
      else throw new Error(`Line ${lineNum}: unknown escape \\${inner[i]}`);
    } else {
      result += inner[i];
    }
  }
  return result;
}

function parseStringArray(raw: string, lineNum: number): string[] {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    throw new Error(`Line ${lineNum}: expected a string array [...], got: ${raw}`);
  }
  const inner = trimmed.slice(1, -1).trim();
  if (inner === '') return [];

  const items: string[] = [];
  let i = 0;
  while (i < inner.length) {
    // skip whitespace and commas
    while (i < inner.length && (inner[i] === ',' || inner[i] === ' ' || inner[i] === '\t')) i++;
    if (i >= inner.length) break;
    if (inner[i] !== '"') {
      throw new Error(`Line ${lineNum}: expected quoted string in array, got: ${inner[i]}`);
    }
    // find closing quote, respecting escapes
    let j = i + 1;
    while (j < inner.length && !(inner[j] === '"' && inner[j - 1] !== '\\')) j++;
    if (j >= inner.length) {
      throw new Error(`Line ${lineNum}: unterminated string in array`);
    }
    items.push(parseTomlString(inner.slice(i, j + 1), lineNum));
    i = j + 1;
  }
  return items;
}

function parseTableHeader(
  line: string,
  lineNum: number
): { section: string; name: string; isEnv: boolean } {
  // Strip [ and ]
  const inner = line.slice(1, -1).trim();

  // Parse segments: bare or double-quoted
  const segments: string[] = [];
  let i = 0;
  while (i < inner.length) {
    if (inner[i] === '.') {
      i++;
      continue;
    }
    if (inner[i] === '"') {
      // quoted segment
      let j = i + 1;
      while (j < inner.length && !(inner[j] === '"' && inner[j - 1] !== '\\')) j++;
      if (j >= inner.length) {
        throw new Error(`Line ${lineNum}: unterminated quoted segment in table header`);
      }
      segments.push(parseTomlString(inner.slice(i, j + 1), lineNum));
      i = j + 1;
    } else {
      // bare segment
      let j = i;
      while (j < inner.length && inner[j] !== '.') j++;
      const seg = inner.slice(i, j);
      if (!/^[A-Za-z0-9_-]+$/.test(seg)) {
        throw new Error(`Line ${lineNum}: invalid bare key segment: ${seg}`);
      }
      segments.push(seg);
      i = j;
    }
  }

  if (segments.length < 2) {
    throw new Error(`Line ${lineNum}: table header must have at least 2 segments: ${line}`);
  }

  const section = segments[0];
  if (!KNOWN_SECTIONS.has(section)) {
    throw new Error(`Line ${lineNum}: unknown section "${section}" in: ${line}`);
  }

  if (segments.length === 3 && segments[2] === 'env') {
    return { section, name: segments[1], isEnv: true };
  }
  if (segments.length === 2) {
    return { section, name: segments[1], isEnv: false };
  }

  throw new Error(`Line ${lineNum}: unexpected table header depth: ${line}`);
}

export function parseManifest(text: string): StackManifest {
  const manifest: StackManifest = { mcp: {} };

  let currentSection: string | null = null;
  let currentName: string | null = null;
  let inEnv = false;

  const lines = text.split('\n');
  for (let idx = 0; idx < lines.length; idx++) {
    const lineNum = idx + 1;
    const line = lines[idx].trim();

    // Skip blank and comment lines
    if (line === '' || line.startsWith('#')) continue;

    // Table header
    if (line.startsWith('[')) {
      if (!line.endsWith(']')) {
        throw new Error(`Line ${lineNum}: malformed table header: ${line}`);
      }
      const { section, name, isEnv } = parseTableHeader(line, lineNum);
      if (isEnv && section === 'instructions') {
        throw new Error(`Line ${lineNum}: instructions entries do not support .env sub-tables`);
      }
      currentSection = section;
      currentName = name;
      inEnv = isEnv;

      // Ensure the section map exists
      if (section === 'mcp') {
        manifest.mcp = manifest.mcp ?? {};
        if (!manifest.mcp[name]) manifest.mcp[name] = {};
      } else if (section === 'skills') {
        manifest.skills = manifest.skills ?? {};
        if (!manifest.skills[name]) manifest.skills[name] = {};
      } else if (section === 'workflows') {
        manifest.workflows = manifest.workflows ?? {};
        if (!manifest.workflows[name]) manifest.workflows[name] = {};
      } else if (section === 'instructions') {
        manifest.instructions = manifest.instructions ?? {};
        if (!manifest.instructions[name]) manifest.instructions[name] = {};
      }
      continue;
    }

    // Key = value
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) {
      throw new Error(`Line ${lineNum}: expected key = value, got: ${line}`);
    }
    const key = line.slice(0, eqIdx).trim();
    const rawVal = line.slice(eqIdx + 1).trim();

    if (currentSection === null || currentName === null) {
      throw new Error(`Line ${lineNum}: key/value before any table header: ${line}`);
    }

    // Instructions entries have their own field set (source/content/ref/content_hash)
    // — handled separately from the mcp/skills/workflows ManifestEntry shape.
    if (currentSection === 'instructions') {
      const instructions = (manifest.instructions ??= {});
      const entry = (instructions[currentName] ??= {});

      if (!KNOWN_INSTRUCTION_KEYS.has(key)) {
        throw new Error(`Line ${lineNum}: unknown key "${key}" in entry table`);
      }
      if (key === 'source') {
        const val = parseTomlString(rawVal, lineNum);
        if (val !== 'inline' && val !== 'file' && val !== 'url') {
          throw new Error(`Line ${lineNum}: source must be inline, file, or url, got: ${val}`);
        }
        entry.source = val;
      } else if (key === 'content') {
        entry.content = parseTomlString(rawVal, lineNum);
      } else if (key === 'ref') {
        entry.ref = parseTomlString(rawVal, lineNum);
      } else if (key === 'content_hash') {
        entry.contentHash = parseTomlString(rawVal, lineNum);
      } else if (key === 'enabled') {
        if (rawVal === 'true') entry.enabled = true;
        else if (rawVal === 'false') entry.enabled = false;
        else throw new Error(`Line ${lineNum}: enabled must be true or false, got: ${rawVal}`);
      }
      continue;
    }

    // Get current entry
    const sectionMap: Record<string, ManifestEntry> =
      currentSection === 'mcp'
        ? manifest.mcp
        : currentSection === 'skills'
          ? (manifest.skills ??= {})
          : (manifest.workflows ??= {});
    const entry = (sectionMap[currentName] ??= {});

    if (inEnv) {
      // Any key, string value
      const strVal = parseTomlString(rawVal, lineNum);
      entry.env = entry.env ?? {};
      entry.env[key] = strVal;
    } else {
      // Known entry keys only
      if (!KNOWN_ENTRY_KEYS.has(key)) {
        throw new Error(`Line ${lineNum}: unknown key "${key}" in entry table`);
      }
      if (key === 'command') {
        entry.command = parseStringArray(rawVal, lineNum);
      } else if (key === 'url') {
        entry.url = parseTomlString(rawVal, lineNum);
      } else if (key === 'enabled') {
        if (rawVal === 'true') entry.enabled = true;
        else if (rawVal === 'false') entry.enabled = false;
        else throw new Error(`Line ${lineNum}: enabled must be true or false, got: ${rawVal}`);
      } else if (key === 'description_digest') {
        entry.descriptionDigest = parseTomlString(rawVal, lineNum);
      }
    }
  }

  return manifest;
}

// ── File I/O ──────────────────────────────────────────────────────────────────

export function readManifest(path: string): StackManifest | null {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8');
  return parseManifest(text);
}

export function writeManifest(path: string, m: StackManifest): void {
  atomicWriteFile(path, serializeManifest(m), 0o644);
}

// ── Remote/file loader ────────────────────────────────────────────────────────

/**
 * Load a StackManifest from a URL or file path.
 * Throws a descriptive Error on fetch failure, missing file, or parse error.
 * The caller is responsible for mapping thrown errors to usageError output.
 */
export async function loadManifestFromSource(
  source: string,
  opts: { cwd?: string; fetcher?: FetchLike }
): Promise<StackManifest> {
  let text: string;

  if (/^https?:\/\//i.test(source)) {
    // URL source
    const fetcher = opts.fetcher ?? globalThis.fetch;
    let res: Response;
    try {
      res = await fetcher(source);
    } catch (e) {
      throw new Error(
        `Could not fetch manifest from ${source}: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e }
      );
    }
    if (!res.ok) {
      throw new Error(`Could not fetch manifest from ${source}: HTTP ${res.status}`);
    }
    text = await res.text();
  } else {
    // File path source
    const absPath = resolve(opts.cwd ?? process.cwd(), source);
    if (!existsSync(absPath)) {
      throw new Error(`Could not read manifest from ${source}: file not found`);
    }
    text = readFileSync(absPath, 'utf8');
  }

  try {
    return parseManifest(text);
  } catch (e) {
    throw new Error(
      `Invalid manifest from ${source}: ${e instanceof Error ? e.message : String(e)}`,
      { cause: e }
    );
  }
}

// ── Instruction content resolution (P3) ────────────────────────────────────────

export interface ResolveInstructionOptions {
  cwd?: string;
  fetcher?: FetchLike;
  /**
   * The manifest's own source (a git/http URL or a file path), when this
   * instruction entry was loaded as part of a `--from` profile. Used to
   * resolve a `file`-sourced `ref` relative to a REMOTE manifest (fetch
   * alongside it) instead of the local filesystem.
   */
  baseSource?: string;
}

/**
 * Resolve an InstructionManifestEntry down to its literal text content,
 * regardless of `source` (inline | file | url). Throws a descriptive Error
 * on read/fetch failure — mirrors loadManifestFromSource's error contract so
 * callers can map it straight to usageError output.
 */
export async function resolveInstructionContent(
  entry: InstructionManifestEntry,
  opts: ResolveInstructionOptions
): Promise<string> {
  const source = entry.source ?? 'inline';

  if (source === 'inline') {
    return entry.content ?? '';
  }

  if (!entry.ref) {
    throw new Error(`instruction entry has source "${source}" but no ref`);
  }

  const fetchUrl = async (url: string, label: string): Promise<string> => {
    const fetcher = opts.fetcher ?? globalThis.fetch;
    let res: Response;
    try {
      res = await fetcher(url);
    } catch (e) {
      throw new Error(
        `Could not fetch ${label}: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e }
      );
    }
    if (!res.ok) {
      throw new Error(`Could not fetch ${label}: HTTP ${res.status}`);
    }
    return res.text();
  };

  if (source === 'url') {
    return fetchUrl(entry.ref, `instruction content from ${entry.ref}`);
  }

  // source === 'file'
  if (opts.baseSource && /^https?:\/\//i.test(opts.baseSource)) {
    // The manifest itself came from a URL — resolve the file ref relative to
    // it and fetch, rather than looking on the local disk.
    const resolvedUrl = new URL(entry.ref, opts.baseSource).toString();
    return fetchUrl(resolvedUrl, `instruction file ${entry.ref} (resolved ${resolvedUrl})`);
  }

  const absPath = resolve(opts.cwd ?? process.cwd(), entry.ref);
  if (!existsSync(absPath)) {
    throw new Error(`Could not read instruction file: ${entry.ref} (resolved ${absPath}) not found`);
  }
  return readFileSync(absPath, 'utf8');
}
