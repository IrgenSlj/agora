// Agora's shipped baseline policy (AGORA_BRIEF_v2.md §7.1).
//
// Permissive but safe, and deliberately so: a default that forbade everything
// unsigned would block essentially the entire MCP ecosystem on day one, and a
// policy people have to disable to get any work done is a policy nobody runs.
//
// What it refuses is the small set of things that are known-bad rather than
// merely unproven:
//
//   - revoked artifacts (someone published an advisory about this exact thing)
//   - artifacts whose sandboxed run tripped a canary token (S6)
//   - installing something whose evidence diverges critically from its claims
//
// Everything else is permitted, and projects tighten from here via
// `agora.toml → policy.files`. A team that wants "signed provenance or
// nothing" writes one `forbid` and gets it — see policy init's scaffold.

// A revocation is not a judgement call. Somebody published an advisory naming
// this artifact; no action on it is allowed.
forbid (principal, action, resource)
when { resource.revoked };

// A canary token that left the sandbox is proof of exfiltration, not a hint.
forbid (principal, action, resource)
when { resource.canary_triggered };

// Critical divergence means what the artifact does contradicts what it claims.
// Scoped to Install: an artifact already present should still be inspectable
// and syncable so a user can see and remove it.
forbid (principal, action == Action::"Install", resource)
when { resource.divergence_max == "critical" };

permit (principal, action, resource);
