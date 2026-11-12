// Profile: @modelcontextprotocol/server-memory, read-only.
// package: npm:@modelcontextprotocol/server-memory
// tools read from version 2.1.1 of the published package on 2026-11-12.
//
// Permits reading the knowledge graph. Not permitted, so denied under an
// agora.cedar: create_entities, create_relations, add_observations and the
// three delete tools. Add them in your own rule if a task needs them.

@id("profile-{{server}}-read")
permit (principal, action == Action::"call", resource)
when {
  resource.mcp &&
  resource.server == "{{server}}" &&
  ["read_graph", "search_nodes", "open_nodes"].contains(resource.name)
};
