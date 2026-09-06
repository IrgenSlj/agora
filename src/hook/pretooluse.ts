// The PreToolUse decision: the moment Agora stops being advice.
//
// Everything else in this repository answers the question at a moment somebody
// chose — an install, a CI run, an `agora trust`. This answers it at the moment
// the tool is actually about to run, in the host the user already has, with no
// service to operate. That is a gateway's placement without a gateway's cost,
// and it is the difference between a tripwire that reports and one that stops
// something.
//
// Three rules govern this file, and each of them is the kind that looks
// over-cautious until the day it isn't.
//
// ── 1. It never says "allow" ────────────────────────────────────────────────
//
// Claude Code's contract treats `permissionDecision: "allow"` as a bypass of
// its own permission flow. Agora is not entitled to that. The product's whole
// discipline is that passing the gate means *no known red flags* and never
// "safe", and an `allow` would convert exactly that sentence into a granted
// permission the user never gave. So the only decisions here are "deny" and "no
// opinion", and no opinion means Claude Code asks the user exactly as it would
// have without Agora installed.
//
// ── 2. It fails open, and says so ───────────────────────────────────────────
//
// This runs before every MCP tool call. A bug here that fails closed does not
// make anyone safer; it makes the agent unusable, and an uninstalled tripwire
// protects nobody. Every unexpected condition therefore yields no opinion with
// a note on stderr, never a block. The one thing that would be worse than
// failing open is failing open *silently*, so the note is not optional.
//
// ── 3. It never touches the network ─────────────────────────────────────────
//
// A hook that waits on a fetch adds that latency to every tool call and hangs
// the agent when the network does. The revocation check reads the bundled feed
// and whatever the last refresh cached; drift is read from the lockfile. Both
// are local and synchronous. A feed that is stale is reported as stale, not
// refreshed here.

import type { RevocationStatus } from '../revocation/client.js';
import type { CapabilityDriftBlock } from '../stack/drift-blocks.js';
import type { ConfiguredServer } from '../stack/types.js';

/** The subset of Claude Code's PreToolUse payload this needs. */
export interface PreToolUsePayload {
  tool_name?: string;
  cwd?: string;
  hook_event_name?: string;
}

export type HookDecision =
  | {
      kind: 'no-opinion';
      /** Why, for stderr. Absent when there is simply nothing to say. */
      note?: string;
    }
  | { kind: 'deny'; reason: string };

/**
 * `mcp__<server>__<tool>` → `<server>`.
 *
 * The separator is a double underscore, so single underscores inside either
 * half are fine — `mcp__plugin_my-plugin_db__query` yields
 * `plugin_my-plugin_db`. A tool name containing `__` produces extra segments,
 * which belong to the tool and not the server, so only the second segment is
 * ever read.
 */
export function serverFromToolName(toolName: string | undefined): string | undefined {
  if (!toolName?.startsWith('mcp__')) return undefined;
  const parts = toolName.split('__');
  if (parts.length < 3) return undefined;
  const server = parts[1];
  return server && server.length > 0 ? server : undefined;
}

export interface DecisionContext {
  /** Servers configured across every host adapter, for the payload's cwd. */
  servers: readonly ConfiguredServer[];
  /** Offline revocation lookup for the purls a server resolves to. */
  revocations: (purls: readonly string[]) => RevocationStatus;
  /** Offline drift check against the approved lockfile baseline. */
  driftBlocks: () => readonly CapabilityDriftBlock[];
  /** npm purls for one configured server. */
  purlsFor: (server: ConfiguredServer) => readonly string[];
}

/**
 * Decide whether this tool call should be blocked.
 *
 * Ordering is deliberate: revocation before drift. A revoked artifact is a
 * published claim that this exact thing is bad, and it is the more actionable
 * message of the two — being told a tool's schema changed is less useful than
 * being told the package it came from is malware.
 */
export function decidePreToolUse(payload: PreToolUsePayload, ctx: DecisionContext): HookDecision {
  const serverName = serverFromToolName(payload.tool_name);

  // Not an MCP call at all — a file read, a bash command, an edit. Agora has
  // nothing to say about those and should not slow them down.
  if (!serverName) return { kind: 'no-opinion' };

  const server = ctx.servers.find((s) => s.name === serverName);
  if (!server) {
    // The host is about to run something Agora cannot see. That is worth a note
    // — it usually means a config Agora does not read — but it is emphatically
    // not grounds to block: refusing what we failed to enumerate would make
    // every unsupported host a broken one.
    return {
      kind: 'no-opinion',
      note: `${serverName} is not in any configuration Agora can read — nothing checked.`
    };
  }

  const purls = ctx.purlsFor(server);
  if (purls.length > 0) {
    const status = ctx.revocations(purls);
    if (status.blocked) {
      const match = status.matches[0]!;
      const entry = match.entry;
      const detail = entry.summary ? ` — ${entry.summary}` : '';
      const age =
        status.ageMs !== undefined ? ` (feed ${Math.round(status.ageMs / 3_600_000)}h old)` : '';
      return {
        kind: 'deny',
        reason:
          `\`${serverName}\` is revoked: ${entry.reason} [${entry.severity}]${detail}\n` +
          `  ${entry.id} · ${entry.refs[0] ?? 'no reference'}${age}\n` +
          `  Run \`agora audit\` for the full picture, or \`agora quarantine ${serverName}\` to ` +
          `take it out of your stack.`
      };
    }
  }

  const blocked = ctx.driftBlocks().find((b) => b.name === serverName);
  if (blocked) {
    // Quarantine and drift both stop the call and are not the same event. One
    // is a decision the user already made and is entitled to be reminded of in
    // their own terms; the other is a detection they have not seen yet.
    if (blocked.reason === 'quarantined') {
      return {
        kind: 'deny',
        reason:
          `\`${serverName}\` is quarantined: ${blocked.detail}\n` +
          `  You put it here. Run \`agora unquarantine ${serverName}\` to let it run again.`
      };
    }
    return {
      kind: 'deny',
      reason:
        `\`${serverName}\` no longer matches what was approved: ${blocked.detail}\n` +
        `  The tools this server offers changed after it was pinned, which is the ` +
        `shape of a rug pull.\n` +
        `  Review with \`agora trust ${serverName}\`, then \`agora approve ${serverName}\` if ` +
        `the change is expected.`
    };
  }

  // Nothing known against it. Deliberately silent rather than an `allow` — see
  // the header. Claude Code's own permission flow proceeds untouched.
  return { kind: 'no-opinion' };
}

/**
 * Render a decision as the stdout Claude Code reads.
 *
 * Returns null when there is nothing to print, which is the documented way to
 * say "no decision, apply the normal permission flow".
 */
export function renderDecision(decision: HookDecision): string | null {
  if (decision.kind !== 'deny') return null;
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: decision.reason
    }
  });
}
