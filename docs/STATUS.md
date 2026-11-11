# Status

Last reviewed: 2026-11-11, after phase 1. The plan is [`PLAN.md`](./PLAN.md); this page says what
the code can actually prove. Labels:

- **Works** — on a user-facing path and covered by tests.
- **Partial** — useful, but the full guarantee is not enforced.
- **Planned** — in the plan; do not tell users it works.

| Capability | State | What is true now | What remains |
|---|---|---|---|
| Revocation deny in Claude Code (`agora hook`) | Works | `PreToolUse` hook denies a call to an MCP server whose configured version is on the bundled revocation list. Never emits allow, fails open on every error, reads no network. | Becomes one deny source among policy rules in phase 3 |
| Revocation list | Partial | Bundled list of 58 OSV-derived entries with exact semver ranges, including explicit malicious-version lists. A fetched copy can only add entries. `bun run refresh:feed` re-derives entries from OSV. | No automatic discovery of new advisories; `agora audit` is the live check |
| Advisory lookup (`agora audit`) | Works | Queries OSV.dev for every npm-launched server across hosts; unidentifiable servers are reported as unchecked | — |
| CI (`agora ci`, `action.yml`) | Partial | Fails on a blocking advisory, annotates, writes a job summary; no servers or an unreachable OSV is not established (exit 3 with `--fail-on-unknown`) | Receipt verification (phase 2) |
| Session log (`agora log`, `agora hook record`) | Works | Claude Code hooks record session start and end, every tool call that ran, and denials, as hash-chained `AgentEvent`s; a closed session records its root; `agora log verify` detects any changed byte and truncation of a closed log; 72 ms per hook call | Signing the root (phase 2); an open session cannot detect truncation |
| MCP shim (`agora run`, `agora observe`) | Works | Byte-transparent stdio supervision records tool names and counts and sampled direct-process network peers, and writes them as events to a session of its own; never arguments or results | Joining the host's session |
| Policy (`agora policy`) | Partial | Real Cedar engine with lint; `agora.cedar` at the repo root on top of a shipped baseline; the entity model describes MCP artifacts | Cedar schema for agent actions: tool, path, command, peer (phase 3) |
| Host adapters | Works | Read MCP servers from Claude Code, Cursor, Windsurf, VS Code and OpenCode configs; atomic, key-preserving writes (used by `observe enable`) | Emit native permissions (phase 3) |
| Attestation container | Partial | `evidence/dsse.ts` builds canonical in-toto statements in DSSE envelopes, with the DSSE pre-authentication encoding | Signing and the receipt predicate (phase 2) |
| Receipts, learn, compile, replay, canaries, report | Planned | — | Phases 2 to 5 |

## Invariants enforced by tests

- The hook never emits `allow`, and every failure path exits 0 with a note on stderr.
- A launch command pinned to a tag or range (`pkg@latest`, `pkg@^1`) is an unknown version, never a
  version, and the tag never leaks into the package name.
- A malware advisory blocks only the versions it names. Popular servers at current versions are not
  blocked by the bundled list.
- A version range that cannot be parsed matches (reports) rather than silently clearing.
- An unreachable OSV or an absent server set is never reported as a pass.
- Observation and the session log never persist tool arguments, results, prompt text or file
  contents; a test plants a secret in twelve payload shapes and checks no event carries it.
- `AgentEvent` is a strict object whose keys are pinned by a test.
- Changing any single byte of a session log fails verification.
- The recorder never prints to stdout and always exits 0.
- Every removed command explains itself and exits 2; no user-facing string names a command that does
  not exist.

## Known gaps

1. The revocation list is a floor, not a feed: new advisories reach the hook only through a release
   or the fetched copy.
2. `agora ci` checks host configs committed to the repository; most MCP configs live in home
   directories, so CI often has nothing to check until receipts exist.
3. The policy entity model still describes artifacts, not agent actions.
4. Session logs are unsigned: anyone who can write the data directory can rewrite a whole chain
   consistently. Signing arrives in phase 2.
5. Network peers reached by shell commands are not recorded; only `WebFetch` hosts and sampled MCP
   server connections are.
