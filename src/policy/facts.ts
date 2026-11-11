// Revocation status for the MCP servers configured on this machine, as a
// lookup the request builder can use. Offline: the bundled list plus any
// cached copy. A server Agora cannot identify gets no `revoked` attribute,
// which is "unknown", never "not revoked".

import { checkRevocations } from '../revocation/client.js';
import { installedPurls } from '../revocation/installed.js';
import { isBlockingMatch } from '../revocation/match.js';
import { readAllServers } from '../stack/registry.js';
import type { ToolFacts } from './requests.js';

export function revocationFacts(opts: {
  cwd: string;
  home?: string;
  env?: Record<string, string | undefined>;
  dataDir: string;
}): ToolFacts {
  const servers = readAllServers({ cwd: opts.cwd, home: opts.home, env: opts.env });
  const { addressable } = installedPurls(servers);
  const status = checkRevocations(opts.dataDir, [...new Set(addressable.map((a) => a.purl))]);
  const blocked = new Set(status.matches.filter(isBlockingMatch).map((m) => m.purl));
  const byServer = new Map<string, boolean>();
  for (const a of addressable) {
    byServer.set(a.server.name, (byServer.get(a.server.name) ?? false) || blocked.has(a.purl));
  }
  return { revoked: (server) => byServer.get(server) };
}
