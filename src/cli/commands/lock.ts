import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFile } from '../../atomic-write.js';
import { hashDeclaredManifest } from '../../model/hash.js';
import {
  type ArtifactLockEntry,
  type Lockfile,
  normalizeLockfile,
  parseLockfile
} from '../../model/lockfile.js';
import { DeclaredManifest } from '../../model/manifest.js';
import { parsePurl } from '../../model/purl.js';
import { buildLockfile, type LockWriteResult } from '../../stack/lockwrite.js';
import { readAllServers } from '../../stack/registry.js';
import { AgoraStore } from '../../store/index.js';
import type { Styler } from '../../ui.js';
import { AGORA_VERSION } from '../app.js';
import { ExitCode } from '../exit-codes.js';
import type { CliIo, ParsedArgs } from '../flags.js';
import { detectDataDir, stringFlag, usageError, writeJson, writeLine } from '../helpers.js';
import { cliTheme } from '../theme.js';
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
 * The drift question, answered without a CLI around it.
 *
 * Returns `null` when there is no lockfile at all — which `agora ci` renders as
 * *not established* rather than as a pass. Nothing is pinned, so nothing can be
 * proved unchanged, and that is a different sentence from "nothing changed".
 */
export async function verifyLockfileForCi(
  io: CliIo,
  storePath?: string
): Promise<{ ok: boolean; drifts: { title: string; detail: string; where?: string }[] } | null> {
  const lockPath = join(io.cwd ?? process.cwd(), 'agora.lock');

  let lockfile: Lockfile;
  try {
    lockfile = parseLockfile(readFileSync(lockPath, 'utf-8'));
  } catch {
    return null;
  }

  const store = new AgoraStore(storePath ?? io.env?.AGORA_DB_PATH);
  const drifts: { title: string; detail: string; where?: string }[] = [];
  try {
    for (const entry of lockfile.artifacts) {
      const drift = verifyArtifact(entry, store);
      if (drift) {
        drifts.push({
          title: `drift — ${drift.purl}`,
          detail: drift.drifts.join('; '),
          where: 'agora.lock'
        });
      }
    }
  } finally {
    store.close();
  }

  return { ok: drifts.length === 0, drifts };
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
    lockfile = parseLockfile(raw);
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
 * `agora lock write` — pin what is installed now, so drift has a baseline.
 *
 * Writes the lockfile and the declared manifests it verifies against in one
 * pass; either alone is inert. Refuses to lock a server whose descriptions have
 * already drifted, because doing so would bless the change and permanently
 * silence the tripwire for that artifact.
 */
async function writeLockfile(parsed: ParsedArgs, io: CliIo, style: Styler): Promise<number> {
  const env = { cwd: io.cwd, home: io.env?.HOME, env: io.env };
  const servers = readAllServers(env).filter((s) => s.enabled);
  const dataDir = detectDataDir(parsed, io);
  const storePath = stringFlag(parsed, 'store') || io.env?.AGORA_DB_PATH;
  const store = new AgoraStore(storePath);
  const dryRun = parsed.flags.dryRun === true || parsed.flags['dry-run'] === true;

  let result: LockWriteResult;
  try {
    result = buildLockfile(servers, {
      dataDir,
      generatedBy: `agora ${AGORA_VERSION}`,
      store,
      persist: !dryRun
    });
  } finally {
    store.close();
  }

  const lockPath = join(io.cwd ?? process.cwd(), 'agora.lock');
  const body = `${JSON.stringify(normalizeLockfile(result.lockfile), null, 2)}\n`;

  if (dryRun) {
    if (parsed.flags.json) {
      writeJson(io.stdout, { ...result, wrote: false, path: lockPath });
    } else {
      writeLine(io.stdout, body);
    }
    return ExitCode.OK;
  }

  atomicWriteFile(lockPath, body);

  if (parsed.flags.json) {
    writeJson(io.stdout, { ...result, wrote: true, path: lockPath });
    return ExitCode.OK;
  }

  const theme = cliTheme(style, io);
  writeLine(
    io.stdout,
    `Locked ${theme.bold(String(result.locked.length))} artifact${result.locked.length === 1 ? '' : 's'} to ${lockPath}`
  );
  for (const name of result.locked) writeLine(io.stdout, `  ${theme.accent('✓')} ${name}`);

  if (result.skipped.length) {
    writeLine(io.stdout, '');
    // Never a silent omission. A server missing from the lockfile is a server
    // the tripwire will not watch, and the user has to know which ones.
    writeLine(
      io.stdout,
      theme.muted(
        `  ${result.skipped.length} not locked — these are not covered by drift detection:`
      )
    );
    for (const s of result.skipped) {
      writeLine(io.stdout, theme.muted(`    ? ${s.name} — ${s.reason}`));
    }
  }

  writeLine(io.stdout, '');
  writeLine(
    io.stdout,
    theme.muted('  Commit agora.lock. `agora ci` compares against it on every run.')
  );
  return ExitCode.OK;
}

/**
 * `agora lock` — manage the lockfile.
 * Subcommands: verify, write
 */
export const commandLock: CommandHandler = async (parsed, io, style) => {
  const subcommand = parsed.args[0];

  if (subcommand === 'verify') {
    return verifyLockfile(parsed, io);
  }
  if (subcommand === 'write') {
    return writeLockfile(parsed, io, style);
  }

  return usageError(
    io,
    `Unknown lock subcommand: ${subcommand}. Usage: agora lock verify | agora lock write`
  );
};
