// The receipt predicate: what an agent session did to produce a commit.
//
// It carries identifiers and counts only, the same rule as the session log:
// repository-relative paths, program names, host:port peers, MCP server and
// tool names. A receipt is published in git notes, so nothing from outside the
// repository appears in it except as a path class.

import { z } from 'zod';

export const RECEIPT_PREDICATE_TYPE = 'https://github.com/IrgenSlj/agora/receipt/v1';

const Digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Capped = z.object({ items: z.array(z.string().max(256)), truncated: z.boolean() });

export const ReceiptSession = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
    host: z.enum(['claude-code', 'opencode', 'mcp-shim']),
    /** Last event of this session at or before the commit, and its hash. */
    seq: z.number().int().min(0),
    head: Digest,
    /** Events of this session inside the commit's window. */
    events: z.number().int().min(0),
    closed: z.boolean()
  })
  .strict();
export type ReceiptSession = z.infer<typeof ReceiptSession>;

export const SignerLevel = z.enum(['none', 'local-keychain', 'runner-oidc']);
export type SignerLevel = z.infer<typeof SignerLevel>;

export const ReceiptPredicate = z
  .object({
    /** Window of agent activity attributed to this commit. */
    window: z.object({ from: z.string(), to: z.string() }).strict(),
    sessions: z.array(ReceiptSession).min(1),
    /** sha256 of agora.cedar at this commit; null when the repository has none. */
    policy_sha256: Digest.nullable(),
    servers: z.array(z.object({ name: z.string().max(128), calls: z.number().int() }).strict()),
    touched: z
      .object({
        written: Capped,
        read: Capped,
        commands: Capped,
        peers: Capped,
        tools: Capped
      })
      .strict(),
    denied: z.number().int().min(0),
    canary_hits: z.number().int().min(0),
    /** What the host could not enforce or record during these sessions. */
    not_enforced: z.array(z.string().max(200)),
    signer: SignerLevel
  })
  .strict();
export type ReceiptPredicate = z.infer<typeof ReceiptPredicate>;
