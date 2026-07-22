import { SKIP_EXECUTABLES } from './config.js';
import type { ConfiguredServer } from './stack/types.js';

export interface ParsedPin {
  name: string; // npm package name, e.g. "@scope/pkg" or "pkg"
  version: string | null; // pinned semver "1.2.3", or null if unpinned / dist-tag
  tag: string | null; // dist-tag ("latest","next") if pinned to a tag, else null
}

export type UpdateStatus = 'updatable' | 'up-to-date' | 'tracks-latest' | 'unknown';

export interface UpdateEntry {
  server: string;
  tool: string;
  scope: string;
  configPath: string;
  pkg: string | null;
  current: string | null; // pinned version
  latest: string | null;
  status: UpdateStatus;
  message: string;
}

export function parsePinnedPackage(command: string[] | undefined): ParsedPin | null {
  if (!command || command.length === 0) return null;

  let spec: string | null = null;
  for (const token of command) {
    if (SKIP_EXECUTABLES.has(token)) continue;
    if (token.startsWith('-')) continue;
    spec = token;
    break;
  }

  if (spec === null) return null;

  let name: string;
  let versionPart: string;

  if (spec.startsWith('@')) {
    // scoped package: find first '@' at index > 0
    const idx = spec.indexOf('@', 1);
    if (idx > 0) {
      name = spec.slice(0, idx);
      versionPart = spec.slice(idx + 1);
    } else {
      name = spec;
      versionPart = '';
    }
  } else {
    // plain package: split on first '@'
    const idx = spec.indexOf('@');
    if (idx > 0) {
      name = spec.slice(0, idx);
      versionPart = spec.slice(idx + 1);
    } else {
      name = spec;
      versionPart = '';
    }
  }

  let version: string | null;
  let tag: string | null;

  if (versionPart === '') {
    version = null;
    tag = null;
  } else if (/^\d/.test(versionPart)) {
    version = versionPart;
    tag = null;
  } else {
    version = null;
    tag = versionPart;
  }

  return { name, version, tag };
}

export function classifyUpdate(
  server: ConfiguredServer,
  pin: ParsedPin | null,
  latest: string | null
): UpdateStatus {
  if (server.transport !== 'local' || pin === null) return 'unknown';
  if (pin.version === null) return 'tracks-latest';
  if (latest === null) return 'unknown';
  if (pin.version === latest) return 'up-to-date';
  return 'updatable';
}

export function bumpCommand(command: string[], latest: string): string[] {
  if (command.length === 0) return command;

  let tokenIndex = -1;
  for (const [i, token] of command.entries()) {
    if (SKIP_EXECUTABLES.has(token)) continue;
    if (token.startsWith('-')) continue;
    tokenIndex = i;
    break;
  }

  if (tokenIndex === -1) return command;

  const spec = command[tokenIndex];
  if (spec === undefined) return command;
  let name: string;

  if (spec.startsWith('@')) {
    const idx = spec.indexOf('@', 1);
    if (idx > 0) {
      name = spec.slice(0, idx);
    } else {
      name = spec;
    }
  } else {
    const idx = spec.indexOf('@');
    if (idx > 0) {
      name = spec.slice(0, idx);
    } else {
      name = spec;
    }
  }

  const newToken = `${name}@${latest}`;
  const result = [...command];
  result[tokenIndex] = newToken;
  return result;
}

export function collectPackages(servers: ConfiguredServer[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const s of servers) {
    if (s.transport !== 'local') continue;
    const pin = parsePinnedPackage(s.command);
    if (pin && !seen.has(pin.name)) {
      seen.add(pin.name);
      names.push(pin.name);
    }
  }
  return names;
}

export function buildUpdatePlan(
  servers: ConfiguredServer[],
  latestByPkg: Map<string, string | null>
): UpdateEntry[] {
  return servers.map((server) => {
    const pin = parsePinnedPackage(server.command);
    const latest = pin ? (latestByPkg.get(pin.name) ?? null) : null;
    const status = classifyUpdate(server, pin, latest);

    let message: string;
    switch (status) {
      case 'updatable':
        message = `${pin?.name ?? server.name} ${pin?.version ?? 'unknown'} → ${latest}`;
        break;
      case 'up-to-date':
        message = `${pin?.name ?? server.name} ${pin?.version ?? 'unknown'} (latest)`;
        break;
      case 'tracks-latest':
        message = `${pin?.name ?? server.name} tracks latest (unpinned)`;
        break;
      default:
        message =
          server.transport !== 'local' ? 'not an npm package' : 'could not determine version';
        break;
    }

    return {
      server: server.name,
      tool: server.tool,
      scope: server.scope,
      configPath: server.configPath,
      pkg: pin?.name ?? null,
      current: pin?.version ?? null,
      latest,
      status,
      message
    };
  });
}
