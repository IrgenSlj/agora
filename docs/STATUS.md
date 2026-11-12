# Status

Last reviewed: 2026-11-12, phase 3 built with its gate open; phase 4 under way. The plan is [`PLAN.md`](./PLAN.md); this page says what
the code can actually prove. Labels:

- **Works** — on a user-facing path and covered by tests.
- **Partial** — useful, but the full guarantee is not enforced.
- **Planned** — in the plan; do not tell users it works.

| Capability | State | What is true now | What remains |
|---|---|---|---|
| Revocation deny in Claude Code (`agora hook`) | Works | The hook denies a call to an MCP server whose configured version is on the bundled revocation list, and the baseline policy forbids it too. Never emits allow, fails open on every error, reads no network. | — |
| Revocation list | Partial | Bundled list of 58 OSV-derived entries with exact semver ranges, including explicit malicious-version lists. A fetched copy can only add entries. `bun run refresh:feed` re-derives entries from OSV. | No automatic discovery of new advisories; `agora audit` is the live check |
| Advisory lookup (`agora audit`) | Works | Queries OSV.dev for every npm-launched server across hosts; unidentifiable servers are reported as unchecked | — |
| Receipts (`agora receipt`, `agora signer`) | Works | One in-toto receipt per commit in `refs/notes/agora`, naming the sessions that produced it, their log heads and what they touched; signed with an ed25519 key held only in the macOS Keychain or Linux Secret Service; `write` refuses a log that does not verify | Runner-signed receipts (phase 5); the commit range is bound by time and working tree, not by diff |
| CI (`agora ci`, `action.yml`) | Works | Verifies the receipt of every commit in a pull request against keys trusted at its base, and fails on a blocking advisory; job summary lists each commit's receipt; a commit without a receipt is not established | Evaluating `agora.cedar` over the receipt (phase 3) |
| Session log (`agora log`, `agora hook record`) | Works | Claude Code hooks record session start and end, every tool call that ran, and denials, as hash-chained `AgentEvent`s; a closed session records its root; `agora log verify` detects any changed byte and truncation of a closed log; 72 ms per hook call | Signing the root (phase 2); an open session cannot detect truncation |
| MCP shim (`agora run`, `agora observe`) | Works | Byte-transparent stdio supervision records tool names and counts and sampled direct-process network peers, and writes them as events to a session of its own; never arguments or results | Joining the host's session |
| Policy (`agora policy`, `agora learn`, `agora replay`) | Works | `agora.cedar` holds Cedar rules over agent actions (read, write, exec, connect, call); with it present, anything unpermitted is denied; strict schema lint; `learn` proposes a minimal policy from verified sessions as a diff; `replay` reports what a policy would have denied | Real sessions on this repository to prove learned policies do not over-deny (phase 3 gate) |
| Compile and enforce (`agora plan`, `agora apply`) | Works for Claude Code and OpenCode | The PreToolUse hook enforces `agora.cedar` on every tool; exact-equivalent permits compile to `permissions.allow`; every rule is reported as compiled, hook-only or not enforceable. In a repository that uses OpenCode, a plugin runs the same check before every OpenCode tool call and records the session | About 130 ms per checked tool call |
| Host adapters | Works | Read MCP servers from Claude Code, Cursor, Windsurf, VS Code and OpenCode configs; atomic, key-preserving writes (used by `observe enable`) | Emit native permissions (phase 3) |

| Canaries (`agora canary`) | Works | A decoy credential file hidden from git, and with `--tool` a decoy MCP tool; any tool call on them, or a shell command naming the file, is denied and recorded as a canary event in Claude Code and OpenCode; receipts count hits and CI fails on them | A program that opens the file without naming it is not seen |
| Runner signing, report | Planned | — | Phase 5 |

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
- A receipt claiming a signature it does not carry, moved to another commit, written under another
  policy, or changed after signing does not verify.
- A key added inside a pull request cannot vouch for that pull request's receipts.
- A policy learned from a set of sessions denies nothing in those sessions when replayed.
- The hook denies what `agora.cedar` does not permit, and a policy that does not parse blocks
  nothing.
- `agora apply` keeps allow rules a person wrote and removes only the ones it wrote earlier.
- Every removed command explains itself and exits 2; no user-facing string names a command that does
  not exist.

## Known gaps

1. The revocation list is a floor, not a feed: new advisories reach the hook only through a release
   or the fetched copy.
2. `agora ci` checks host configs committed to the repository; most MCP configs live in home
   directories, so CI often has nothing to check until receipts exist.
3. A shell command is checked by program name only: `cat .env` is `exec cat`, and the file it reads
   is not seen. Policies cannot govern what they cannot see, and `agora plan` says so.
4. An unsigned receipt (`signer none`) is a self-report: anyone who can write git notes can replace
   it with a consistent forgery. A `local-keychain` receipt resists an agent confined by the host's
   sandbox, not an unsandboxed one running as the same user. `runner-oidc` (phase 5) removes the
   developer's machine from the trust base.
6. "Within policy" in CI means the receipt verifies against the commit's `agora.cedar` hash and
   records no canary hit. Enforcement happens in the hook during the session; CI does not re-evaluate
   the policy over the receipt's summary.
7. Old sessions recorded before session metadata existed cannot be bound to a repository, so
   `learn`, `replay` and receipts skip them.
5. Network peers reached by shell commands are not recorded; only `WebFetch` hosts and sampled MCP
   server connections are.
