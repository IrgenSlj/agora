// Agora's shipped baseline policy (AGORA_BRIEF_v2.md §7.1).
//
// Permissive but safe, deliberately: a default that forbade everything
// unsigned would block essentially the entire MCP ecosystem on day one, and a
// policy people must disable to get work done is a policy nobody runs. What it
// refuses is the small set of things that are known-bad rather than merely
// unproven.
//
// EVERY RULE GUARDS WITH `has`. This is not style. Cedar treats a policy that
// reads a missing attribute as an *error*, skips that policy, and returns the
// remaining decision — so an unguarded `forbid when { resource.revoked }`
// silently evaluates to ALLOW on any artifact whose revocation status was
// never established. A forbid that fails open is worse than no forbid at all,
// because it looks like protection. Guarding makes "we never checked" fall
// through to the permit explicitly rather than by accident, and
// `agora policy check` surfaces any rule that errored.

// A revocation is not a judgement call: somebody published an advisory naming
// this exact artifact.
forbid (principal, action, resource)
when { resource has revoked && resource.revoked };

// A canary token that left the sandbox is proof of exfiltration, not a hint.
// Nothing sets this today — canaries were dropped when S6 became runtime
// observation — so the guard means the rule simply does not apply, rather
// than silently passing everything.
forbid (principal, action, resource)
when { resource has canary_triggered && resource.canary_triggered };

// Critical divergence: what the server was OBSERVED doing contradicts what it
// declared — for example contacting a host while declaring no network access.
// This is real evidence from `agora run`, not a heuristic, and it is absent
// until the server has actually been observed. Scoped to Install: something
// already present must stay inspectable and removable, so Sync and Serve are
// unaffected.
forbid (principal, action == Action::"Install", resource)
when { resource has divergence_max && resource.divergence_max == "critical" };

permit (principal, action, resource);
