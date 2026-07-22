import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFile } from '../atomic-write.js';
import { hashToolSchema, hashToolsList } from '../evidence/schemahash.js';
import type { McpTool } from './mcp-probe.js';

export interface ServerCapabilities {
  key: string;
  name: string;
  command: string[];
  serverInfo?: { name?: string; version?: string };
  tools: McpTool[];
  ok: boolean;
  probedAt: string;
  /** Approved baseline digest of tool names, descriptions, and input schemas. */
  descriptionDigest?: string;
  descriptionDigestAt?: string;
  /** Latest observed digest when it differs from the approved baseline. */
  liveDescriptionDigest?: string;
  liveTools?: McpTool[];
  driftDetectedAt?: string;
}

export interface ToolDrift {
  added: string[];
  removed: string[];
  changed: Array<{
    name: string;
    beforeDescription?: string;
    afterDescription?: string;
  }>;
}

export function capabilityCachePath(dataDir: string): string {
  return join(dataDir, 'capabilities.json');
}

export function capabilityKey(name: string, command: string[]): string {
  const hash = createHash('sha1').update(command.join(' ')).digest('hex').slice(0, 8);
  return `${name}@${hash}`;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function descriptionDigest(tools: ReadonlyArray<McpTool>): string {
  return hashToolsList(tools);
}

export function diffToolDescriptions(
  before: ReadonlyArray<McpTool>,
  after: ReadonlyArray<McpTool>
): ToolDrift {
  const beforeMap = new Map(before.map((tool) => [tool.name, tool]));
  const afterMap = new Map(after.map((tool) => [tool.name, tool]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: ToolDrift['changed'] = [];

  for (const [name, tool] of afterMap) {
    const previous = beforeMap.get(name);
    if (!previous) {
      added.push(name);
    } else if (hashToolSchema(previous) !== hashToolSchema(tool)) {
      changed.push({
        name,
        beforeDescription: previous.description,
        afterDescription: tool.description
      });
    }
  }

  for (const name of beforeMap.keys()) {
    if (!afterMap.has(name)) removed.push(name);
  }

  return {
    added: added.sort(),
    removed: removed.sort(),
    changed: changed.sort((a, b) => a.name.localeCompare(b.name))
  };
}

function snippet(value: string | undefined): string {
  const text = normalizeWhitespace(value ?? '');
  if (!text) return '(no description)';
  return text.length > 80 ? text.slice(0, 77) + '...' : text;
}

export function formatToolDrift(diff: ToolDrift): string {
  const parts: string[] = [];
  if (diff.added.length) parts.push(`added: ${diff.added.join(', ')}`);
  if (diff.removed.length) parts.push(`removed: ${diff.removed.join(', ')}`);
  if (diff.changed.length) {
    parts.push(
      `changed: ${diff.changed
        .map(
          (item) =>
            `${item.name} "${snippet(item.beforeDescription)}" -> "${snippet(item.afterDescription)}"`
        )
        .join('; ')}`
    );
  }
  return parts.length ? parts.join(' · ') : 'tool definitions changed';
}

export function readCapabilityCache(dataDir: string): ServerCapabilities[] {
  const path = capabilityCachePath(dataDir);
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as ServerCapabilities[];
    return [];
  } catch {
    return [];
  }
}

export function writeCapabilityCache(dataDir: string, entries: ServerCapabilities[]): void {
  atomicWriteFile(capabilityCachePath(dataDir), JSON.stringify(entries, null, 2));
}

export function upsertCapabilities(dataDir: string, entry: ServerCapabilities): void {
  const existing = readCapabilityCache(dataDir);
  const idx = existing.findIndex((e) => e.key === entry.key);
  if (idx >= 0) {
    existing[idx] = entry;
  } else {
    existing.push(entry);
  }
  writeCapabilityCache(dataDir, existing);
}
