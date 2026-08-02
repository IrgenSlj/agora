// Install intents — the constraint that makes an agent-facing server safe.
//
// ── THE RULE THIS FILE EXISTS TO ENFORCE ────────────────────────────────────
//
// **An agent may ask. Only a human may install.**
//
// `agora serve` exposes discovery to the agent using the tools, which is useful
// precisely because that agent is the one that notices it lacks a capability.
// But an agent that could install its own tools is the attack this product
// exists to prevent: prompt injection reaching a tool-installing tool turns
// "summarise this webpage" into "add a server that exfiltrates your keys", with
// no human in the loop at any point.
//
// So `request_install` writes one of these and stops. It touches no host config,
// no agora.toml, no lockfile. `agora approve <id>` is the human-oriented review
// path, but a terminal is not automatically a security boundary when the agent
// also has shell access. A host-native or out-of-band consent mechanism is still
// required before the rule above is cryptographically or operationally strong.
//
// The evidence and policy verdict are snapshotted at request time so the human
// reviewing later sees what the agent saw. They are recorded, never trusted:
// `agora approve` re-evaluates from scratch, because an intent is a request,
// not a decision, and a stale allow is not an allow.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFile } from '../atomic-write.js';

/** A short, unambiguous, hand-typeable id. No l/1/O/0. */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function newIntentId(): string {
  const bytes = randomBytes(6);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export interface IntentEvidence {
  /** Plane verdicts as `agora trust` renders them, including the unknowns. */
  planes: { plane: string; tone: string; detail: string }[];
  /** Policy decision at request time, when one was computed. */
  policy?: { decision: string; reason?: string };
}

export interface InstallIntent {
  id: string;
  /** What the agent asked for, as a catalog id. */
  item: string;
  /** purl, when the artifact resolves to one. */
  purl?: string;
  /** Target host, if the agent named one. */
  tool?: string;
  /** Why the agent says it needs this. Untrusted text — displayed, never parsed. */
  rationale?: string;
  requestedAt: string;
  /** Evidence as it stood when the request was made. Informational only. */
  evidence: IntentEvidence;
  status: 'pending';
}

export function intentsDir(dataDir: string): string {
  return join(dataDir, 'intents');
}

function intentPath(dataDir: string, id: string): string {
  return join(intentsDir(dataDir), `${id}.json`);
}

/**
 * Records a request. Writes exactly one file under the data dir and nothing
 * else — no host config, no manifest, no lockfile.
 */
export function writeIntent(dataDir: string, intent: InstallIntent): string {
  const dir = intentsDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const path = intentPath(dataDir, intent.id);
  atomicWriteFile(path, `${JSON.stringify(intent, null, 2)}\n`);
  return path;
}

export function readIntent(dataDir: string, id: string): InstallIntent | null {
  // `id` arrives from a CLI argument and, upstream, from an agent. Constrain it
  // to the alphabet before it reaches a path join — otherwise `../../` walks out
  // of the data dir and this becomes an arbitrary-file read.
  if (!/^[a-z2-9]{1,32}$/.test(id)) return null;
  const path = intentPath(dataDir, id);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as InstallIntent;
  } catch {
    return null;
  }
}

export function listIntents(dataDir: string): InstallIntent[] {
  const dir = intentsDir(dataDir);
  if (!existsSync(dir)) return [];
  const out: InstallIntent[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(readFileSync(join(dir, file), 'utf8')) as InstallIntent);
    } catch {
      // A corrupt intent is dropped rather than throwing: one bad file must not
      // make every pending request invisible.
    }
  }
  return out.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

/** Removes an intent once it has been acted on. */
export function deleteIntent(dataDir: string, id: string): boolean {
  if (!/^[a-z2-9]{1,32}$/.test(id)) return false;
  const path = intentPath(dataDir, id);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}
