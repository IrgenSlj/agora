import {
  capabilityKey,
  descriptionDigest,
  diffToolDescriptions,
  formatToolDrift,
  readCapabilityCache,
  type ServerCapabilities,
  upsertCapabilities
} from './capability-cache.js';
import { type McpProbeResult, probeMcpServer } from './mcp-probe.js';
import { KNOWN_RUNNERS, resolveOnPath } from './path-resolve.js';
import { formatQuarantineRewrites, quarantineConfiguredServers } from './quarantine.js';
import type { ConfiguredServer, StackEnv } from './types.js';

export type HealthStatus = 'ok' | 'warn' | 'error';

export interface HealthCheck {
  name: string;
  ok: boolean;
  level: 'warn' | 'error';
  detail?: string;
}

export interface ServerHealth {
  name: string;
  instances: ConfiguredServer[];
  status: HealthStatus;
  checks: HealthCheck[];
}

export interface StackHealth {
  servers: ServerHealth[];
  summary: { ok: number; warn: number; error: number };
}

export interface DoctorOptions extends StackEnv {
  probe?: boolean;
  probeTimeoutMs?: number;
  dataDir?: string;
  quarantineOnDrift?: boolean;
}

function deriveStatus(checks: HealthCheck[]): HealthStatus {
  if (checks.some((c) => !c.ok && c.level === 'error')) return 'error';
  if (checks.some((c) => !c.ok && c.level === 'warn')) return 'warn';
  return 'ok';
}

function checkCommandResolvable(
  instances: ConfiguredServer[],
  opts?: DoctorOptions
): HealthCheck | null {
  // Only applies to local transports
  const localInstances = instances.filter((s) => s.transport === 'local');
  if (localInstances.length === 0) return null;

  const pathEnv = opts?.env;

  for (const inst of localInstances) {
    const argv = inst.command ?? [];
    if (argv.length === 0) {
      return {
        name: 'command-resolvable',
        ok: false,
        level: 'error',
        detail: `${inst.tool}: command is empty`
      };
    }

    const token = argv[0]!;
    const resolved = resolveOnPath(token, pathEnv);

    if (!resolved) {
      return {
        name: 'command-resolvable',
        ok: false,
        level: 'error',
        detail: `${inst.tool}: '${token}' not found on PATH`
      };
    }

    // If the token is a known runner, require a non-flag package/script arg
    if (KNOWN_RUNNERS.has(token)) {
      const hasNonFlagArg = argv.slice(1).some((a) => !a.startsWith('-'));
      if (!hasNonFlagArg) {
        return {
          name: 'command-resolvable',
          ok: false,
          level: 'error',
          detail: `${inst.tool}: runner '${token}' has no package/script argument`
        };
      }
    }
  }

  return { name: 'command-resolvable', ok: true, level: 'error' };
}

function checkRemoteUrl(instances: ConfiguredServer[]): HealthCheck | null {
  const remoteInstances = instances.filter((s) => s.transport === 'remote');
  if (remoteInstances.length === 0) return null;

  for (const inst of remoteInstances) {
    if (!inst.url) {
      return {
        name: 'remote-url',
        ok: false,
        level: 'warn',
        detail: `${inst.tool}: remote entry has no url`
      };
    }
    try {
      const parsed = new URL(inst.url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return {
          name: 'remote-url',
          ok: false,
          level: 'warn',
          detail: `${inst.tool}: url '${inst.url}' is not http(s)`
        };
      }
    } catch {
      return {
        name: 'remote-url',
        ok: false,
        level: 'warn',
        detail: `${inst.tool}: url '${inst.url}' is not a valid URL`
      };
    }
  }

  return { name: 'remote-url', ok: true, level: 'warn' };
}

function checkDisabled(instances: ConfiguredServer[]): HealthCheck | null {
  if (instances.every((s) => s.enabled === false)) {
    return {
      name: 'disabled',
      ok: false,
      level: 'warn',
      detail: 'all instances are disabled'
    };
  }
  return null;
}

function checkConflictingDefinition(instances: ConfiguredServer[]): HealthCheck | null {
  if (instances.length < 2) return null;

  // Collect unique signatures (command joined or url)
  const signatures = new Set<string>();
  for (const inst of instances) {
    if (inst.transport === 'local') {
      signatures.add(`local:${(inst.command ?? []).join(' ')}`);
    } else {
      signatures.add(`remote:${inst.url ?? ''}`);
    }
  }

  if (signatures.size > 1) {
    return {
      name: 'conflicting-definition',
      ok: false,
      level: 'warn',
      detail: `${instances.length} instances differ in command/url across tools/scopes`
    };
  }
  return null;
}

async function probeServer(
  inst: ConfiguredServer,
  opts: DoctorOptions,
  timeoutMs: number
): Promise<{
  check: HealthCheck;
  result: McpProbeResult;
  digest?: string;
  previous?: ServerCapabilities;
}> {
  if (inst.transport !== 'local' || !inst.command || inst.command.length === 0) {
    const check: HealthCheck = {
      name: 'probe',
      ok: true,
      level: 'error',
      detail: 'skipped (not local)'
    };
    return { check, result: { ok: true } };
  }

  const result = await probeMcpServer(inst.command, {
    env: opts.env,
    cwd: opts.cwd,
    timeoutMs
  });

  let detail: string;
  if (result.ok) {
    const toolCount = result.tools?.length ?? 0;
    const parts: string[] = [`started · ${toolCount} tool(s)`];
    if (result.serverInfo?.name || result.serverInfo?.version) {
      const info = [result.serverInfo.name, result.serverInfo.version].filter(Boolean).join(' ');
      parts.push(info);
    }
    detail = parts.join(' · ');
  } else {
    detail =
      result.error ??
      (result.exitCode !== undefined && result.exitCode !== null
        ? `exited with code ${result.exitCode}`
        : 'probe failed');
  }

  const check: HealthCheck = { name: 'probe', ok: result.ok, level: 'error', detail };
  const key = capabilityKey(inst.name, inst.command);
  const previous = opts.dataDir
    ? readCapabilityCache(opts.dataDir).find((entry) => entry.key === key)
    : undefined;
  const digest = result.tools ? descriptionDigest(result.tools) : undefined;
  return { check, result, digest, previous };
}

export function checkServer(
  name: string,
  instances: ConfiguredServer[],
  opts?: DoctorOptions
): ServerHealth {
  const checks: HealthCheck[] = [];

  const resolvableCheck = checkCommandResolvable(instances, opts);
  if (resolvableCheck) checks.push(resolvableCheck);

  const remoteCheck = checkRemoteUrl(instances);
  if (remoteCheck) checks.push(remoteCheck);

  const disabledCheck = checkDisabled(instances);
  if (disabledCheck) checks.push(disabledCheck);

  const conflictCheck = checkConflictingDefinition(instances);
  if (conflictCheck) checks.push(conflictCheck);

  return {
    name,
    instances,
    status: deriveStatus(checks),
    checks
  };
}

export async function checkStack(
  servers: ConfiguredServer[],
  opts?: DoctorOptions
): Promise<StackHealth> {
  const probeTimeoutMs = opts?.probeTimeoutMs ?? 8000;
  const quarantinedNames = new Set<string>();

  // Group by name
  const grouped = new Map<string, ConfiguredServer[]>();
  for (const s of servers) {
    const existing = grouped.get(s.name);
    if (existing) {
      existing.push(s);
    } else {
      grouped.set(s.name, [s]);
    }
  }

  const serverHealthList: ServerHealth[] = [];

  for (const [name, instances] of grouped) {
    const health = checkServer(name, instances, opts);

    // Optional probe: only local servers, only when probe=true
    if (opts?.probe) {
      const localEnabled = instances.filter((s) => s.transport === 'local' && s.enabled !== false);
      for (const inst of localEnabled) {
        const { check, result, digest, previous } = await probeServer(
          inst,
          opts ?? {},
          probeTimeoutMs
        );
        health.checks.push(check);
        const baselineDigest = previous?.descriptionDigest;
        const hasDescriptionDrift =
          result.ok && digest && baselineDigest && baselineDigest !== digest;
        if (hasDescriptionDrift) {
          const driftDetail = `DRIFT: ${formatToolDrift(diffToolDescriptions(previous.tools, result.tools ?? []))}`;
          health.checks.push({
            name: 'description-drift',
            ok: false,
            level: 'warn',
            detail: driftDetail
          });

          if (opts?.quarantineOnDrift && !quarantinedNames.has(name)) {
            const rewrites = quarantineConfiguredServers(servers, [name], opts);
            quarantinedNames.add(name);
            health.checks.push({
              name: 'quarantine',
              ok: false,
              level: 'error',
              detail: `QUARANTINED: ${formatQuarantineRewrites(rewrites)}`
            });
          }
        }
        if (opts?.dataDir && inst.command && inst.command.length > 0) {
          try {
            const probedAt = new Date().toISOString();
            const approvedDigest =
              baselineDigest && digest && baselineDigest !== digest
                ? baselineDigest
                : (digest ?? baselineDigest);
            upsertCapabilities(opts.dataDir, {
              key: capabilityKey(name, inst.command),
              name,
              command: inst.command,
              serverInfo: result.serverInfo,
              tools: hasDescriptionDrift
                ? (previous?.tools ?? [])
                : (result.tools ?? previous?.tools ?? []),
              ok: result.ok,
              probedAt,
              ...(approvedDigest
                ? {
                    descriptionDigest: approvedDigest,
                    descriptionDigestAt: previous?.descriptionDigestAt ?? probedAt
                  }
                : {}),
              ...(hasDescriptionDrift
                ? {
                    liveDescriptionDigest: digest,
                    liveTools: result.tools ?? [],
                    driftDetectedAt: probedAt,
                    ...(opts.quarantineOnDrift
                      ? {
                          state: 'quarantined' as const,
                          quarantineReason: 'description-drift',
                          quarantinedAt: probedAt
                        }
                      : {})
                  }
                : {})
            });
          } catch {
            // best-effort
          }
        }
      }
      // Recompute status with probe results
      (health as { status: HealthStatus }).status = deriveStatus(health.checks);
    }

    serverHealthList.push(health);
  }

  const summary = { ok: 0, warn: 0, error: 0 };
  for (const h of serverHealthList) {
    summary[h.status]++;
  }

  return { servers: serverHealthList, summary };
}
