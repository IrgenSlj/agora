import { existsSync } from 'node:fs';
import { opencodeAdapter } from './adapters/opencode.js';
import { claudeCodeAdapter } from './adapters/claude-code.js';
import { cursorAdapter } from './adapters/cursor.js';
import { windsurfAdapter } from './adapters/windsurf.js';
import type {
  AgentToolId,
  ConfiguredServer,
  StackEnv,
  ToolAdapter,
  ToolConfigLocation
} from './types.js';

export const ALL_ADAPTERS: ToolAdapter[] = [
  opencodeAdapter,
  claudeCodeAdapter,
  cursorAdapter,
  windsurfAdapter
];

export function getAdapter(id: AgentToolId): ToolAdapter | undefined {
  return ALL_ADAPTERS.find((a) => a.id === id);
}

export function detectTools(
  opts: StackEnv
): { adapter: ToolAdapter; locations: ToolConfigLocation[]; present: boolean }[] {
  return ALL_ADAPTERS.map((adapter) => {
    const locations = adapter.locations(opts);
    const present = locations.some((loc) => existsSync(loc.path));
    return { adapter, locations, present };
  });
}

export function readAllServers(opts: StackEnv): ConfiguredServer[] {
  const results: ConfiguredServer[] = [];
  for (const adapter of ALL_ADAPTERS) {
    results.push(...adapter.readServers(opts));
  }
  return results;
}

export function groupServersByName(servers: ConfiguredServer[]): Map<string, ConfiguredServer[]> {
  const map = new Map<string, ConfiguredServer[]>();
  for (const server of servers) {
    const existing = map.get(server.name);
    if (existing) {
      existing.push(server);
    } else {
      map.set(server.name, [server]);
    }
  }
  return map;
}
