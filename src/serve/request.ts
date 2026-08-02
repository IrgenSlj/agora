import { type AcquireInput, type AcquireResult, acquire } from '../acquire.js';
import { authorizeInstallRequestEvidence } from '../gate/adapters.js';
import type { AuthorizationDecision } from '../gate/authorization.js';
import { npmPurl } from '../revocation/installed.js';
import { type InstallIntent, newIntentId, readIntent, writeIntent } from './intent.js';

export interface RequestInstallInput
  extends Omit<AcquireInput, 'acceptWarnings' | 'actor' | 'dryRun' | 'save'> {
  dataDir: string;
  /** Agent-supplied explanation. Stored and displayed as untrusted text. */
  rationale?: string;
  now?: () => Date;
}

export interface RequestInstallResult {
  status: 'requested' | 'blocked' | 'not_found';
  preview: AcquireResult;
  authorization?: AuthorizationDecision;
  intent?: InstallIntent;
  approvalCommand?: string;
  reason?: string;
}

function intentPurl(result: AcquireResult): string | undefined {
  const item = result.item;
  if (item?.kind !== 'package' || !item.npmPackage) return undefined;
  return npmPurl(item.npmPackage, item.version);
}

function availableIntentId(dataDir: string): string {
  let id = newIntentId();
  while (readIntent(dataDir, id)) id = newIntentId();
  return id;
}

/**
 * Agent-safe half of acquisition: evaluate the exact acquire preview, then
 * write only a pending request. The human approval path re-evaluates all
 * evidence and policy before it touches host configuration.
 */
export async function requestInstall(input: RequestInstallInput): Promise<RequestInstallResult> {
  const preview = await acquire({
    ...input,
    actor: 'agent',
    dryRun: true,
    acceptWarnings: false,
    save: false
  });

  if (preview.status === 'not_found') {
    return { status: 'not_found', preview, reason: preview.reason };
  }

  const authorization = authorizeInstallRequestEvidence({
    actor: 'agent',
    scan: preview.scan,
    policy: preview.policy,
    revocation: preview.revocation
  });

  if (authorization.verdict === 'deny' || authorization.verdict === 'inconclusive') {
    return {
      status: 'blocked',
      preview,
      authorization,
      reason: authorization.reasons.join('; ') || preview.reason || 'Install request was refused.'
    };
  }

  const item = preview.item;
  if (!item) {
    return {
      status: 'blocked',
      preview,
      authorization,
      reason: 'The resolved catalog item was unavailable when the request was recorded.'
    };
  }

  const purl = intentPurl(preview);
  const intent: InstallIntent = {
    id: availableIntentId(input.dataDir),
    item: item.id,
    ...(purl ? { purl } : {}),
    ...(input.tool ? { tool: input.tool } : {}),
    ...(input.rationale ? { rationale: input.rationale.slice(0, 1000) } : {}),
    requestedAt: (input.now?.() ?? new Date()).toISOString(),
    evidence: {
      planes: authorization.signals.map((signal) => ({
        plane: signal.source,
        tone: signal.verdict,
        detail: signal.detail
      })),
      ...(preview.policy
        ? {
            policy: {
              decision: preview.policy.decision,
              ...(authorization.reasons.length ? { reason: authorization.reasons.join('; ') } : {})
            }
          }
        : {})
    },
    status: 'pending'
  };

  writeIntent(input.dataDir, intent);
  return {
    status: 'requested',
    preview,
    authorization,
    intent,
    approvalCommand: `agora approve ${intent.id}`,
    reason:
      authorization.verdict === 'review'
        ? 'Request recorded with warnings for human review. No host configuration was changed.'
        : 'Request recorded for human review. No host configuration was changed.'
  };
}
