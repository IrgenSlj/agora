// Trust gate data store (P2 — brief §5/"P2 — Trust gate over federation").
//
// Agora-generated trust data (scan verdicts, drift baselines) travels under a
// namespaced key following the same reverse-DNS `_meta` convention the
// official MCP Registry uses for its own extension data
// (`_meta["io.modelcontextprotocol.registry/official"]`, see
// docs/OPEN_QUESTIONS.md OQ-3 and src/federation/sources/official.ts). Keeping
// the same shape convention keeps the door open to Agora acting as a
// spec-compliant subregistry later without a redesign.
//
// Implementation note: this is a JSON sidecar next to `agora.toml`
// (`agora.trust.json`), not a new field on `ManifestEntry`. `src/stack/manifest.ts`
// is a hard carve-out owned by the parallel P3 session this cut (instruction
// artifacts / plan-apply), so extending its hand-rolled TOML schema was out of
// scope here. The sidecar keeps the same per-server key as `StackManifest.mcp`
// so the two files line up, and nothing about this shape prevents folding it
// into the TOML schema later.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFile } from './atomic-write.js';
import type { StackEnv } from './stack/types.js';
import type { ScanResult } from './scan.js';
import type { OfficialStatus } from './federation/types.js';

/** Namespaced `_meta` key Agora writes trust data under (brief P2). */
export const TRUST_META_KEY = 'io.github.irgenslj.agora/trust' as const;

export interface TrustMeta {
  /** RFC3339 timestamp the gate last ran for this entry. */
  scannedAt: string;
  /** Overall gate verdict at write time (fail > warn > pass). */
  verdict: 'pass' | 'warn' | 'fail';
  summary: { pass: number; warn: number; fail: number };
  /** Official-registry lifecycle status observed at acquire time, if any. */
  officialStatus?: OfficialStatus;
  /** descriptionDigest baseline recorded at acquire/probe time (rug-pull check). */
  descriptionDigestBaseline?: string;
  /** Full scan check detail, for audit/debugging — same shape as ScanResult.checks. */
  checks: ScanResult['checks'];
}

export type TrustRecord = { [TRUST_META_KEY]: TrustMeta };
export type TrustStore = Record<string, TrustRecord>;

export function trustStorePath(env: StackEnv): string {
  const override = env.env?.AGORA_TRUST_FILE;
  if (override) return override;
  const cwd = env.cwd ?? process.cwd();
  return join(cwd, 'agora.trust.json');
}

export function readTrustStore(path: string): TrustStore {
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as TrustStore) : {};
  } catch {
    return {};
  }
}

export function writeTrustStore(path: string, store: TrustStore): void {
  atomicWriteFile(path, JSON.stringify(store, null, 2) + '\n', 0o644);
}

export function buildTrustMeta(
  scan: ScanResult,
  opts: {
    officialStatus?: OfficialStatus;
    descriptionDigestBaseline?: string;
    now?: () => Date;
  } = {}
): TrustMeta {
  const verdict: TrustMeta['verdict'] =
    scan.summary.fail > 0 ? 'fail' : scan.summary.warn > 0 ? 'warn' : 'pass';
  const now = opts.now ? opts.now() : new Date();
  return {
    scannedAt: now.toISOString(),
    verdict,
    summary: scan.summary,
    ...(opts.officialStatus ? { officialStatus: opts.officialStatus } : {}),
    ...(opts.descriptionDigestBaseline
      ? { descriptionDigestBaseline: opts.descriptionDigestBaseline }
      : {}),
    checks: scan.checks
  };
}

export function recordTrust(path: string, serverKey: string, meta: TrustMeta): void {
  const store = readTrustStore(path);
  store[serverKey] = { [TRUST_META_KEY]: meta };
  writeTrustStore(path, store);
}
