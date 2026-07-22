import { getAdapter } from './registry.js';
import type {
  AgentToolId,
  ConfiguredServer,
  DesiredServer,
  StackEnv,
  SyncChange,
  ToolConfigLocation
} from './types.js';

export interface QuarantineRewrite {
  tool: AgentToolId;
  location: ToolConfigLocation;
  serverNames: string[];
  action: 'disabled' | 'removed';
  ok: boolean;
  change?: SyncChange;
  reason?: string;
}

interface RewriteGroup {
  tool: AgentToolId;
  location: ToolConfigLocation;
  servers: ConfiguredServer[];
  targetNames: Set<string>;
}

function groupKey(server: ConfiguredServer): string {
  return `${server.tool}\0${server.scope}\0${server.configPath}`;
}

function supportsDisabledState(tool: AgentToolId): boolean {
  return tool === 'opencode';
}

function canRewriteServer(server: ConfiguredServer, env: StackEnv): boolean {
  if (server.tool !== 'claude-code' || server.scope !== 'project') return true;
  const projectLocation = getAdapter('claude-code')?.writeLocation(env, 'project');
  return projectLocation?.path === server.configPath;
}

function configuredToDesired(server: ConfiguredServer, targetNames: Set<string>): DesiredServer {
  const desired: DesiredServer = { name: server.name };
  if (server.transport === 'remote') {
    if (server.url) desired.url = server.url;
  } else {
    desired.command = server.command ?? [];
  }
  if (server.env && Object.keys(server.env).length > 0) desired.env = server.env;
  if (server.enabled === false || targetNames.has(server.name)) desired.enabled = false;
  return desired;
}

export function quarantineConfiguredServers(
  servers: ReadonlyArray<ConfiguredServer>,
  targetNames: Iterable<string>,
  env: StackEnv = {}
): QuarantineRewrite[] {
  const targets = new Set(targetNames);
  if (targets.size === 0) return [];

  const groups = new Map<string, RewriteGroup>();
  const skipped: QuarantineRewrite[] = [];

  for (const server of servers) {
    if (!targets.has(server.name)) continue;
    const location: ToolConfigLocation = { path: server.configPath, scope: server.scope };
    if (!canRewriteServer(server, env)) {
      skipped.push({
        tool: server.tool,
        location,
        serverNames: [server.name],
        action: supportsDisabledState(server.tool) ? 'disabled' : 'removed',
        ok: false,
        reason: 'server is read from a host-specific nested config shape Agora cannot rewrite yet'
      });
      continue;
    }

    const key = groupKey(server);
    const group =
      groups.get(key) ??
      ({
        tool: server.tool,
        location,
        servers: [],
        targetNames: new Set<string>()
      } satisfies RewriteGroup);
    group.targetNames.add(server.name);
    groups.set(key, group);
  }

  for (const server of servers) {
    const group = groups.get(groupKey(server));
    if (group) group.servers.push(server);
  }

  const rewrites: QuarantineRewrite[] = [...skipped];

  for (const group of groups.values()) {
    const adapter = getAdapter(group.tool);
    const action = supportsDisabledState(group.tool) ? 'disabled' : 'removed';
    const serverNames = [...group.targetNames].sort();
    if (!adapter) {
      rewrites.push({
        tool: group.tool,
        location: group.location,
        serverNames,
        action,
        ok: false,
        reason: `no adapter registered for ${group.tool}`
      });
      continue;
    }

    try {
      const desired = group.servers.map((server) => configuredToDesired(server, group.targetNames));
      const change = adapter.writeServers(group.location, desired, { prune: true });
      rewrites.push({
        tool: group.tool,
        location: group.location,
        serverNames,
        action,
        ok: true,
        change
      });
    } catch (e) {
      rewrites.push({
        tool: group.tool,
        location: group.location,
        serverNames,
        action,
        ok: false,
        reason: e instanceof Error ? e.message : String(e)
      });
    }
  }

  return rewrites.sort((a, b) => {
    const pathOrder = a.location.path.localeCompare(b.location.path);
    return pathOrder === 0 ? a.tool.localeCompare(b.tool) : pathOrder;
  });
}

export function formatQuarantineRewrites(rewrites: ReadonlyArray<QuarantineRewrite>): string {
  if (rewrites.length === 0) return 'no host configs required a rewrite';
  return rewrites
    .map((rewrite) => {
      const names = rewrite.serverNames.join(', ');
      if (!rewrite.ok) {
        return `${rewrite.tool} ${rewrite.location.path}: skipped ${names} (${rewrite.reason ?? 'unknown reason'})`;
      }
      return `${rewrite.tool} ${rewrite.location.path}: ${rewrite.action} ${names}`;
    })
    .join(' · ');
}
