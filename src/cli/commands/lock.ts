import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashDeclaredManifest } from '../../model/hash.js';
import { type ArtifactLockEntry, Lockfile } from '../../model/lockfile.js';
import { DeclaredManifest } from '../../model/manifest.js';
import { parsePurl } from '../../model/purl.js';
import { AgoraStore } from '../../store/index.js';
import { ExitCode } from '../exit-codes.js';
import type { CliIo, ParsedArgs } from '../flags.js';
import { stringFlag, usageError, writeJson, writeLine } from '../helpers.js';
import type { CommandHandler } from './types.js';

/**
 * Verify a single artifact entry in the lockfile.
 * Returns null if valid, or a drift description if mismatch found.
 */
function verifyArtifact(
  entry: ArtifactLockEntry,
  store: AgoraStore
): { purl: string; drifts: string[] } | null {
  const drifts: string[] = [];

  let version: string | undefined;
  try {
    version = parsePurl(entry.purl).version;
  } catch (e) {
    drifts.push(`invalid purl: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!version) {
    drifts.push('purl has no version; cannot match a stored manifest');
    return { purl: entry.purl, drifts };
  }

  const row = store.getManifest(entry.purl, version);
  if (!row) {
    drifts.push(`manifest missing from local store for version ${version}`);
    return { purl: entry.purl, drifts };
  }

  let manifest: DeclaredManifest;
  try {
    manifest = DeclaredManifest.parse(JSON.parse(row.data));
  } catch (e) {
    drifts.push(`stored manifest is invalid: ${e instanceof Error ? e.message : String(e)}`);
    return { purl: entry.purl, drifts };
  }

  const currentManifestHash = hashDeclaredManifest(manifest);
  if (row.manifest_sha256 !== currentManifestHash) {
    drifts.push(
      `store manifest_sha256 mismatch: expected ${row.manifest_sha256}, got ${currentManifestHash}`
    );
  }
  if (manifest.manifest_sha256 !== currentManifestHash) {
    drifts.push(
      `manifest self-hash mismatch: expected ${manifest.manifest_sha256}, got ${currentManifestHash}`
    );
  }
  if (currentManifestHash !== entry.integrity.manifest_sha256) {
    drifts.push(
      `manifest_sha256 mismatch: expected ${entry.integrity.manifest_sha256}, got ${currentManifestHash}`
    );
  }

  const currentTools = new Map(manifest.tools.map((tool) => [tool.name, tool]));
  const lockedTools = new Map(entry.tools.map((tool) => [tool.name, tool]));

  for (const name of [...lockedTools.keys()].sort()) {
    const locked = lockedTools.get(name);
    const current = currentTools.get(name);
    if (!locked || !current) {
      drifts.push(`tool removed: ${name}`);
      continue;
    }
    if (current.description_sha256 !== locked.description_sha256) {
      drifts.push(`tool ${name} description_sha256 mismatch`);
    }
    if (current.input_schema_sha256 !== locked.input_schema_sha256) {
      drifts.push(`tool ${name} input_schema_sha256 mismatch`);
    }
  }

  for (const name of [...currentTools.keys()].sort()) {
    if (!lockedTools.has(name)) drifts.push(`tool added: ${name}`);
  }

  return drifts.length > 0 ? { purl: entry.purl, drifts } : null;
}

/**
 * `agora lock verify` — recompute all hashes, exit 1 on drift.
 * Source: AGORA_BRIEF_v2.md §5.5 (drift rule)
 */
async function verifyLockfile(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const lockPath = join(io.cwd ?? process.cwd(), 'agora.lock');

  let lockfile: Lockfile;
  try {
    const raw = readFileSync(lockPath, 'utf-8');
    lockfile = Lockfile.parse(JSON.parse(raw));
  } catch (e) {
    if (parsed.flags.json) {
      writeJson(io.stdout, {
        ok: false,
        error: e instanceof Error ? e.message : String(e)
      });
    } else {
      writeLine(
        io.stderr,
        `Failed to load lockfile: ${e instanceof Error ? e.message : String(e)}`
      );
    }
    return ExitCode.USAGE;
  }

  const results: Array<{ purl: string; ok: boolean; drifts?: string[] }> = [];
  let hasDrift = false;
  const storePath = stringFlag(parsed, 'store') || io.env?.AGORA_DB_PATH;
  const store = new AgoraStore(storePath);

  try {
    for (const entry of lockfile.artifacts) {
      const drift = verifyArtifact(entry, store);
      if (drift) {
        hasDrift = true;
        results.push({ purl: drift.purl, ok: false, drifts: drift.drifts });
      } else {
        results.push({ purl: entry.purl, ok: true });
      }
    }
  } finally {
    store.close();
  }

  if (parsed.flags.json) {
    writeJson(io.stdout, {
      ok: !hasDrift,
      lockfile_version: lockfile.lockfile_version,
      generated_by: lockfile.generated_by,
      artifacts: results
    });
  } else {
    if (hasDrift) {
      writeLine(io.stderr, 'Lockfile drift detected:');
      for (const result of results) {
        if (!result.ok) {
          writeLine(io.stderr, `  ${result.purl}:`);
          for (const drift of result.drifts || []) {
            writeLine(io.stderr, `    - ${drift}`);
          }
        }
      }
    } else {
      writeLine(io.stdout, `Lockfile verified: ${results.length} artifact(s) OK`);
    }
  }

  return hasDrift ? ExitCode.POLICY_FORBID : ExitCode.OK;
}

/**
 * `agora lock` — manage the lockfile.
 * Subcommands: verify
 */
export const commandLock: CommandHandler = async (parsed, io) => {
  const subcommand = parsed.args[0];

  if (subcommand === 'verify') {
    return verifyLockfile(parsed, io);
  }

  return usageError(io, `Unknown lock subcommand: ${subcommand}. Usage: agora lock verify`);
};
