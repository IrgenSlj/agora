// Making `agora.lock` a file that exists.
//
// The lockfile is the brief's rug-pull tripwire and, until now, nothing wrote
// one. `lock verify` was correct and unreachable: it compares a lockfile against
// declared manifests in the SQLite store, and nothing called `upsertManifest`
// either. So the drift plane was inert end to end — which meant `agora ci`
// answered "not established" for the one question that is the whole product.
//
// This writes both halves from the capability baseline that `doctor --probe`
// already collects: the tool names, descriptions and input schemas a server
// advertised when it was last approved. That is exactly the material a rug-pull
// changes, so hashing it is the check that matters.
//
// What it does NOT do is as important. It resolves no tarball, verifies no
// provenance, and evaluates no policy, so it writes none of those. Those belong
// to the acquisition transaction (EVD-002), which sees the bytes. A lockfile
// that claimed a policy verdict nobody evaluated would be a fabricated record
// in the one file whose entire job is being the trustworthy one.

import { hashToolSchema } from '../evidence/schemahash.js';
import { hashDeclaredManifest, hashText } from '../model/hash.js';
import type { ArtifactLockEntry, Lockfile } from '../model/lockfile.js';
import type { DeclaredManifest, DeclaredTool } from '../model/manifest.js';
import { parsePurl } from '../model/purl.js';
import { installedPurls } from '../revocation/installed.js';
import type { AgoraStore } from '../store/index.js';
import { capabilityKey, readCapabilityCache, type ServerCapabilities } from './capability-cache.js';
import type { ConfiguredServer } from './types.js';

export interface LockWriteResult {
  lockfile: Lockfile;
  /** Servers that produced an entry. */
  locked: string[];
  /** Why each remaining server produced none. Never silently dropped. */
  skipped: { name: string; reason: string }[];
}

export interface LockWriteOptions {
  dataDir: string;
  generatedBy: string;
  store: AgoraStore;
  /**
   * Whether to persist declared manifests to the store.
   *
   * False for `--dry-run`. The lockfile and the manifests it verifies against
   * are two halves of one write, so a dry run that skipped only the file would
   * still have changed what `lock verify` compares against — a preview with a
   * side effect, which is the one thing a preview must not be.
   */
  persist: boolean;
}

/**
 * Only the *approved* baseline is ever locked, never the live reading.
 *
 * A server whose descriptions have drifted has a `liveDescriptionDigest` that
 * differs from its approved one. Locking the live value would silently bless
 * the change — the lockfile would agree with the drifted server and the
 * tripwire would report clean forever after. Quarantine and `unquarantine` are
 * the path for accepting a change; this is not.
 */
function toolsFrom(entry: ServerCapabilities): DeclaredTool[] {
  return entry.tools.map((tool) => ({
    name: tool.name,
    description_sha256: hashText(tool.description ?? ''),
    input_schema_sha256: hashToolSchema(tool),
    source: 'handshake' as const
  }));
}

function manifestFor(purl: string, version: string, entry: ServerCapabilities): DeclaredManifest {
  const base = {
    purl,
    version,
    // A stdio launch command is what the capability cache probes; a remote
    // server is filtered out before this is reached.
    transports: ['stdio' as const],
    // Not inspected here. `unknown` is the model's word for exactly this, and
    // it is why the enum has one.
    auth_model: 'unknown' as const,
    tools: toolsFrom(entry),
    declared_capabilities: {
      // Deliberately empty rather than inferred. Coarse capability buckets come
      // from static analysis of the artifact, which this has not done; guessing
      // them from tool names would put invented claims under a policy engine
      // that is meant to decide on evidence.
      fs_read: false,
      fs_write: false,
      net_egress: [] as string[],
      exec: false,
      credentials: [] as string[]
    }
  };
  return { ...base, manifest_sha256: hashDeclaredManifest(base as DeclaredManifest) };
}

export function buildLockfile(
  servers: readonly ConfiguredServer[],
  opts: LockWriteOptions
): LockWriteResult {
  const cache = readCapabilityCache(opts.dataDir);
  const byKey = new Map(cache.map((c) => [c.key, c]));

  const { addressable, unaddressable } = installedPurls(servers);
  const artifacts: ArtifactLockEntry[] = [];
  const locked: string[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const server of unaddressable) {
    skipped.push({
      name: server.name,
      reason: 'not resolvable to an npm package (remote, or a custom launcher)'
    });
  }

  // One entry per purl. The same server configured in three hosts is one
  // artifact with three hosts, not three artifacts.
  const byPurl = new Map<string, { entry: ServerCapabilities; hosts: Set<string>; name: string }>();

  for (const { server, purl } of addressable) {
    let version: string | undefined;
    try {
      version = parsePurl(purl).version;
    } catch {
      version = undefined;
    }
    if (!version) {
      skipped.push({
        name: server.name,
        reason: 'no version pinned in the launch command — nothing stable to lock to'
      });
      continue;
    }

    const caps = server.command ? byKey.get(capabilityKey(server.name, server.command)) : undefined;
    if (!caps?.ok || !caps.tools.length) {
      skipped.push({
        name: server.name,
        reason: 'no approved capability baseline — run `agora doctor --probe` first'
      });
      continue;
    }
    if (caps.state === 'quarantined') {
      skipped.push({ name: server.name, reason: 'quarantined — release it before locking' });
      continue;
    }
    if (caps.liveDescriptionDigest && caps.liveDescriptionDigest !== caps.descriptionDigest) {
      skipped.push({
        name: server.name,
        reason: 'tool descriptions have drifted — accept or reject the change before locking'
      });
      continue;
    }

    const existing = byPurl.get(purl);
    if (existing) {
      existing.hosts.add(server.tool);
      continue;
    }
    byPurl.set(purl, { entry: caps, hosts: new Set([server.tool]), name: server.name });
  }

  for (const [purl, { entry, hosts, name }] of byPurl) {
    const version = parsePurl(purl).version as string;
    const manifest = manifestFor(purl, version, entry);

    // The store is what `lock verify` recomputes against, so the lockfile is
    // useless without this write. They are produced together on purpose — and
    // withheld together under --dry-run, for the same reason.
    if (opts.persist) {
      opts.store.upsertManifest(purl, version, manifest.manifest_sha256, JSON.stringify(manifest));
    }

    artifacts.push({
      purl,
      kind: 'mcp-server',
      integrity: { manifest_sha256: manifest.manifest_sha256 },
      provenance: { verified: false },
      tools: manifest.tools.map((t) => ({
        name: t.name,
        description_sha256: t.description_sha256,
        input_schema_sha256: t.input_schema_sha256
      })),
      hosts: [...hosts].sort(),
      state: 'installed'
    });
    locked.push(name);
  }

  return {
    lockfile: { lockfile_version: 1, generated_by: opts.generatedBy, artifacts },
    locked: locked.sort(),
    skipped: skipped.sort((a, b) => a.name.localeCompare(b.name))
  };
}
