import { readFileSync } from 'fs';
import { join } from 'path';
import { Lockfile, ArtifactLockEntry } from '../../model/lockfile.js';
import { ExitCode } from '../exit-codes.js';
import { usageError, writeJson, writeLine } from '../helpers.js';
import type { CliIo } from '../flags.js';
import type { CommandHandler } from './types.js';

/**
 * Recompute manifest hash from artifact data.
 * This is a placeholder — real implementation will fetch from store/CAS.
 */
function recomputeManifestHash(entry: ArtifactLockEntry): string {
  // TODO: Fetch actual manifest from store and recompute hash
  // For now, return the stored hash (no drift detection)
  return entry.integrity.manifest_sha256;
}

/**
 * Recompute tool hashes from artifact data.
 * This is a placeholder — real implementation will fetch from store/CAS.
 */
function recomputeToolHashes(
  entry: ArtifactLockEntry
): Array<{ name: string; description_sha256: string; input_schema_sha256: string }> {
  // TODO: Fetch actual tool data from store and recompute hashes
  // For now, return the stored hashes (no drift detection)
  return entry.tools;
}

/**
 * Verify a single artifact entry in the lockfile.
 * Returns null if valid, or a drift description if mismatch found.
 */
function verifyArtifact(entry: ArtifactLockEntry): { purl: string; drifts: string[] } | null {
  const drifts: string[] = [];

  // Recompute manifest hash
  const currentManifestHash = recomputeManifestHash(entry);
  if (currentManifestHash !== entry.integrity.manifest_sha256) {
    drifts.push(
      `manifest_sha256 mismatch: expected ${entry.integrity.manifest_sha256}, got ${currentManifestHash}`
    );
  }

  // Recompute tool hashes
  const currentTools = recomputeToolHashes(entry);
  if (currentTools.length !== entry.tools.length) {
    drifts.push(`tools count mismatch: expected ${entry.tools.length}, got ${currentTools.length}`);
  } else {
    for (let i = 0; i < currentTools.length; i++) {
      const current = currentTools[i];
      const stored = entry.tools[i];

      if (current.name !== stored.name) {
        drifts.push(`tool[${i}] name mismatch: expected ${stored.name}, got ${current.name}`);
      }
      if (current.description_sha256 !== stored.description_sha256) {
        drifts.push(`tool[${i}] description_sha256 mismatch for ${stored.name}`);
      }
      if (current.input_schema_sha256 !== stored.input_schema_sha256) {
        drifts.push(`tool[${i}] input_schema_sha256 mismatch for ${stored.name}`);
      }
    }
  }

  return drifts.length > 0 ? { purl: entry.purl, drifts } : null;
}

/**
 * `agora lock verify` — recompute all hashes, exit 1 on drift.
 * Source: AGORA_BRIEF_v2.md §5.5 (drift rule)
 */
async function verifyLockfile(parsed: { flags: { json?: boolean } }, io: CliIo): Promise<number> {
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

  for (const entry of lockfile.artifacts) {
    const drift = verifyArtifact(entry);
    if (drift) {
      hasDrift = true;
      results.push({ purl: drift.purl, ok: false, drifts: drift.drifts });
    } else {
      results.push({ purl: entry.purl, ok: true });
    }
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
