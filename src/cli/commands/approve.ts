// `agora approve` — the human half of the agent install flow.
//
// An agent using `agora serve` can request an install; it cannot perform one.
// This is the human-oriented review path where a request may become an action.
// A terminal invocation is useful friction, not proof of human presence: an
// agent with ordinary shell access may be able to invoke it too. A host-native
// or out-of-band consent boundary remains required for a strong guarantee.
//
// The intent carries a snapshot of the evidence the agent saw. That snapshot is
// shown for context and **never** used as the decision. Approval re-runs the
// real acquire path — scan, policy, revocation — because the request may be
// hours old, the feed has probably moved since, and an allow computed against
// stale evidence is not an allow.

import { acquire, renderAcquireResult } from '../../acquire.js';
import { findMarketplaceItem } from '../../catalog/bundled.js';
import { createProvenanceResolver } from '../../evidence/resolve-provenance.js';
import { deleteIntent, displayIntentText, listIntents, readIntent } from '../../serve/intent.js';
import { manifestPath, readManifest } from '../../stack/manifest.js';
import { ExitCode } from '../exit-codes.js';
import { detectDataDir, stringFlag, usageError, writeJson, writeLine } from '../helpers.js';
import { cliTheme } from '../theme.js';
import type { CommandHandler } from './types.js';

export const commandApprove: CommandHandler = async (parsed, io, style) => {
  const dataDir = detectDataDir(parsed, io);
  const theme = cliTheme(style, io);
  const id = parsed.args[0];

  // No id: show what is waiting. An agent's request is worthless if the person
  // it is addressed to never learns it exists.
  if (!id) {
    const pending = listIntents(dataDir);
    if (parsed.flags.json) {
      writeJson(io.stdout, { pending: pending.length, intents: pending });
      return ExitCode.OK;
    }
    if (!pending.length) {
      writeLine(io.stdout, 'No pending install requests.');
      return ExitCode.OK;
    }
    writeLine(
      io.stdout,
      `${pending.length} pending install request${pending.length === 1 ? '' : 's'}:`
    );
    writeLine(io.stdout, '');
    for (const intent of pending) {
      writeLine(io.stdout, `  ${theme.bold(intent.id)}  ${intent.item}`);
      if (intent.rationale) {
        // Agent-supplied text. Displayed as a quotation, never interpreted —
        // it is an argument for installing something, written by the party
        // that wants it installed.
        writeLine(io.stdout, theme.muted(`      “${displayIntentText(intent.rationale, 120)}”`));
      }
      writeLine(io.stdout, theme.dim(`      requested ${intent.requestedAt}`));
    }
    writeLine(io.stdout, '');
    writeLine(io.stdout, theme.muted('  Run `agora approve <id>` to review and install one.'));
    return ExitCode.OK;
  }

  const intent = readIntent(dataDir, id);
  if (!intent) {
    return usageError(
      io,
      `No pending request with id "${id}". Run \`agora approve\` to list them.`
    );
  }

  const item = findMarketplaceItem(intent.item);
  if (!item) {
    return usageError(
      io,
      `Request ${id} names "${intent.item}", which is not in the catalog. Nothing was installed.`
    );
  }

  if (parsed.flags.deny) {
    deleteIntent(dataDir, id);
    writeLine(io.stdout, `Denied ${id} (${intent.item}). Nothing was installed.`);
    return ExitCode.OK;
  }

  writeLine(
    io.stdout,
    `${theme.bold(intent.item)} ${theme.dim(`(requested ${intent.requestedAt})`)}`
  );
  if (intent.rationale) {
    writeLine(io.stdout, theme.muted(`  agent's reason: “${displayIntentText(intent.rationale)}”`));
  }
  writeLine(io.stdout, '');

  // Re-evaluated, not replayed. The snapshot below is what the agent saw; the
  // gate that decides is the one running right now.
  if (intent.evidence.planes.length) {
    writeLine(io.stdout, theme.dim('  Evidence when requested (re-checked below):'));
    for (const p of intent.evidence.planes) {
      writeLine(io.stdout, theme.dim(`    ${p.plane.padEnd(11)}${p.detail}`));
    }
    writeLine(io.stdout, '');
  }

  const result = await acquire({
    // `id`, never `query`: a capability search could resolve to a different
    // item than the one the person just read about, and an approval names one
    // artifact. `expectedPurl` closes the same hole one level down — the id
    // may still resolve to a newer version than the request was reviewed
    // against, and that version has not been reviewed by anyone.
    id: intent.item,
    ...(intent.purl ? { expectedPurl: intent.purl } : {}),
    tool: (stringFlag(parsed, 'tool') ?? intent.tool ?? 'opencode') as never,
    dryRun: parsed.flags.dryRun === true,
    acceptWarnings: parsed.flags.acceptWarnings === true,
    save: parsed.flags.save === true,
    cwd: io.cwd,
    env: io.env,
    dataDir,
    fetcher: io.fetcher,
    githubToken: io.env?.AGORA_GITHUB_TOKEN,
    // The approval path must enforce at least what a direct `agora acquire`
    // enforces. Without this the project's own Cedar rules are absent from the
    // one install path that started with an agent asking for it.
    policyFiles: readManifest(manifestPath({ cwd: io.cwd, env: io.env }))?.policy?.files ?? [],
    scanOptions: {
      provenance: createProvenanceResolver({
        fetcher: io.fetcher,
        offline: io.env?.AGORA_OFFLINE === '1'
      })
    }
  });

  writeLine(io.stdout, renderAcquireResult(result));

  // The request is consumed only when it actually resulted in an install. A
  // blocked request stays pending so the person can look at it again after
  // fixing whatever blocked it, rather than having to reconstruct it.
  if (result.status === 'installed') {
    deleteIntent(dataDir, id);
    writeLine(io.stdout, theme.muted(`  Request ${id} approved and cleared.`));
    return ExitCode.OK;
  }

  writeLine(io.stdout, theme.muted(`  Request ${id} left pending — nothing was installed.`));
  return result.status === 'blocked' ? ExitCode.POLICY_FORBID : ExitCode.OK;
};
