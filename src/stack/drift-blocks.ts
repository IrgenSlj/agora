import {
  capabilityKey,
  diffToolDescriptions,
  formatToolDrift,
  readCapabilityCache
} from './capability-cache.js';
import type { ConfiguredServer } from './types.js';

export interface CapabilityDriftSubject {
  name: string;
  command?: string[];
  enabled?: boolean;
  descriptionDigest?: string;
  tool?: string;
  configPath?: string;
}

export interface CapabilityDriftBlock {
  name: string;
  key: string;
  reason: 'quarantined' | 'description-drift';
  detail: string;
  tool?: string;
  configPath?: string;
}

export interface DriftBlockOptions {
  includeDisabled?: boolean;
}

export function findCapabilityDriftBlocks(
  subjects: CapabilityDriftSubject[],
  dataDir: string,
  options: DriftBlockOptions = {}
): CapabilityDriftBlock[] {
  const capabilityCache = readCapabilityCache(dataDir);
  const cacheByKey = new Map(capabilityCache.map((entry) => [entry.key, entry]));
  const blocks: CapabilityDriftBlock[] = [];

  for (const subject of subjects) {
    if (subject.enabled === false && !options.includeDisabled) continue;
    if (!subject.command || subject.command.length === 0) continue;
    const key = capabilityKey(subject.name, subject.command);
    const cached = cacheByKey.get(key);
    if (!cached) continue;

    const approvedDigest = subject.descriptionDigest ?? cached.descriptionDigest;
    const hasLiveDrift =
      approvedDigest !== undefined &&
      cached.liveDescriptionDigest !== undefined &&
      cached.liveDescriptionDigest !== approvedDigest;
    const isQuarantined = cached.state === 'quarantined';
    if (!hasLiveDrift && !isQuarantined) continue;

    const detail =
      cached.liveTools !== undefined
        ? `DRIFT: ${formatToolDrift(diffToolDescriptions(cached.tools, cached.liveTools))}`
        : (cached.quarantineReason ?? 'description digest changed from approved baseline');
    blocks.push({
      name: subject.name,
      key,
      reason: isQuarantined ? 'quarantined' : 'description-drift',
      detail,
      tool: subject.tool,
      configPath: subject.configPath
    });
  }

  return blocks.sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      (a.tool ?? '').localeCompare(b.tool ?? '') ||
      (a.configPath ?? '').localeCompare(b.configPath ?? '')
  );
}

export function findConfiguredServerDriftBlocks(
  servers: ConfiguredServer[],
  dataDir: string,
  options: DriftBlockOptions = {}
): CapabilityDriftBlock[] {
  return findCapabilityDriftBlocks(
    servers.map((server) => ({
      name: server.name,
      command: server.command,
      enabled: server.enabled,
      tool: server.tool,
      configPath: server.configPath
    })),
    dataDir,
    options
  );
}
