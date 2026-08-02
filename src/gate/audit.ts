// The record of what was allowed, and on whose word.
//
// A bypass flag leaves nothing behind: `--skip-scan` succeeded and the machine
// forgot. An acknowledgement has to be different, or it is just a bypass with
// better manners. Every mutation that proceeded because a human accepted a
// non-conclusive result appends one line here, naming the action, the artifact,
// the verdict, and exactly which unknowns were accepted.
//
// This is a local accountability log, not evidence: it is plain JSONL, it is
// not signed, and anything with write access to the data directory can edit it.
// It answers "what did I agree to, and when" — not "prove nobody tampered".

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AuthorizationDecision } from './authorization.js';

export interface GateAuditRecord {
  at: string;
  action: string;
  actor: string;
  verdict: string;
  /** Catalog id or other stable handle for what was acted on. */
  subject?: string;
  purl?: string;
  /** Non-conclusive results the human accepted to reach this verdict. */
  acknowledged: string[];
  /** Signal verdicts as they stood, so the line explains itself later. */
  signals: { source: string; verdict: string; detail: string }[];
}

export function gateAuditPath(dataDir: string): string {
  return join(dataDir, 'gate-audit.jsonl');
}

/**
 * Appends one line, reporting whether it landed. An unwritable data directory
 * must not turn an authorized install into a crash, but the caller is told so
 * it can say the record is missing rather than implying one exists.
 */
export function appendGateAudit(dataDir: string, record: GateAuditRecord): boolean {
  try {
    mkdirSync(dataDir, { recursive: true });
    appendFileSync(gateAuditPath(dataDir), `${JSON.stringify(record)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** Builds the record for a decision that permitted a mutation. */
export function auditRecordFor(
  decision: AuthorizationDecision,
  context: { actor: string; subject?: string; purl?: string; now?: () => Date }
): GateAuditRecord {
  return {
    at: (context.now?.() ?? new Date()).toISOString(),
    action: decision.action,
    actor: context.actor,
    verdict: decision.verdict,
    ...(context.subject ? { subject: context.subject } : {}),
    ...(context.purl ? { purl: context.purl } : {}),
    acknowledged: decision.acknowledged,
    signals: decision.signals.map((signal) => ({
      source: signal.source,
      verdict: signal.verdict,
      detail: signal.detail
    }))
  };
}

export function readGateAudit(dataDir: string, limit = 100): GateAuditRecord[] {
  const path = gateAuditPath(dataDir);
  if (!existsSync(path)) return [];
  try {
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    const out: GateAuditRecord[] = [];
    for (const line of lines.reverse()) {
      try {
        out.push(JSON.parse(line) as GateAuditRecord);
      } catch {
        // A corrupt line must not hide every other decision that was recorded.
        continue;
      }
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}
