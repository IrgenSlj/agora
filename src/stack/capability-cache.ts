import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFile } from '../atomic-write.js';
import type { McpTool } from './mcp-probe.js';

export interface ServerCapabilities {
  key: string;
  name: string;
  command: string[];
  serverInfo?: { name?: string; version?: string };
  tools: McpTool[];
  ok: boolean;
  probedAt: string;
}

export function capabilityCachePath(dataDir: string): string {
  return join(dataDir, 'capabilities.json');
}

export function capabilityKey(name: string, command: string[]): string {
  const hash = createHash('sha1').update(command.join(' ')).digest('hex').slice(0, 8);
  return `${name}@${hash}`;
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
