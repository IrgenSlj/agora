// Agora's shipped baseline, evaluated with every agora.cedar.
//
// It only forbids: a project file adds the permits. Cedar denies anything no
// rule permits, so a repository with an agora.cedar is least-privilege by
// construction, and in Cedar any forbid beats every permit, so a project file
// cannot undo these.

// A revoked MCP server: somebody published an advisory naming this exact
// package and version. Guarded with `has`, because a rule reading a missing
// attribute is skipped by Cedar and would never fire.
@id("baseline-revoked")
forbid (principal, action == Action::"call", resource)
when { resource has revoked && resource.revoked };
