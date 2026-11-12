# Profiles

Minimal policies for MCP servers, one file per server, added to a repository's `agora.cedar` with:

```bash
agora profile list
agora profile add modelcontextprotocol-server-filesystem --server filesystem
```

`--server` is the name the server has in your host's config, because that is the name a tool call
carries. A profile is added between markers, so `agora profile add` again replaces it. It needs an
existing `agora.cedar` (run `agora learn` first): adding a profile to a repository without one would
deny everything else.

## Contributing a profile

One pull request per server. A profile:

- is named after the package, with `/` and `@` turned into `-`
  (`@modelcontextprotocol/server-filesystem` → `modelcontextprotocol-server-filesystem.cedar`);
- starts with comments naming the package (`// package: npm:<name>`), the version whose tools were
  read and the date, and the tools it leaves out and why;
- permits only what a read-only task needs, as `call` rules on `"{{server}}"`, which `add` replaces
  with the configured server name;
- names tools read from the published package or its source, never from memory.

`test/profiles.test.ts` checks every profile parses, validates against the schema and compiles to
Claude Code allow rules.
