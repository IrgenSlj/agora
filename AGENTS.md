# Agora agent instructions

Agora gives every coding agent a written limit and every agent-made change a receipt. Read
[`docs/PLAN.md`](./docs/PLAN.md) (vision, architecture, build plan) and
[`docs/STATUS.md`](./docs/STATUS.md) (what is actually built) before making structural changes.
There is one plan; do not add another planning document.

## Standing rules

1. **One task, one commit, pushed to `main`.** A task is one checkbox in the build plan. Keep
   `main` green at every push (rule 10) and push often. Do not start the next phase before the
   current gate passes.
2. **Test first for security behaviour.** Write the failing test (tamper, deny, unknown) before the
   implementation.
3. **Deny or no opinion, never allow.** No hook or compiled config may grant a permission the host
   would not have granted.
4. **Fail open in hooks, fail closed in CI.** A hook error must not block a tool call; a CI
   verification error must not pass.
5. **Unknown stays unknown.** Anything not checked or not enforceable is reported as such in output
   and in the receipt. An unobserved server is not a well-behaved one; an unsampled network is not
   "contacted nothing"; "no known advisories" is not "safe".
6. **No content capture.** Events never store arguments, results, prompts or file contents. Add a
   test that fails if a new field could carry them.
7. **Read the host's current documentation before writing an adapter or emitter.** Hook payloads
   and permission formats change; do not rely on memory. Record the documentation URL and date in
   a comment.
8. **No new runtime dependency without stating why** in the pull request. No native modules.
9. **Every command supports `--json`** and has an exit-code test: `0` clean, `1` policy failure,
   `2` usage, `3` could not check.
10. **Run before pushing:**
    `bun run typecheck && bun run lint && bun run test && bun run verify:package`.

## Other non-negotiables

- **Local-first.** Every feature works offline. Agora has no hosted backend and no account.
- **A removal names itself.** When retiring a command, add it to `src/cli/retired.ts` with the
  version that removed it, why, and the replacement, or say plainly that there is none.
  `test/cli/no-dangling-commands.test.ts` and `test/cli/retired-commands.test.ts` enforce this.
- **Surgical writes.** Code that writes host configs preserves every unrelated key and writes
  atomically (`src/atomic-write.ts`). Never write a secret into a committed file.
- **Graceful terminal degradation.** Colour and the banner degrade under `NO_COLOR`, `TERM=dumb`,
  non-TTY pipes and narrow terminals.
- **No trust scores, no "secure" or "safe" claims.** The product's credibility is that it states
  its limits.

## Prompt template per task

```text
Read AGENTS.md and docs/PLAN.md. Implement this one task from Phase <N>:
"<checkbox text>"

Before coding: list the files you will touch and the tests you will add.
Write the failing tests first. Keep the change under 400 changed lines;
if it needs more, stop and propose a split.
When done: run the full check command, then summarise what is proven by
tests and what is not yet proven.
```

## Review prompt (a second agent, fresh context)

```text
Review this pull request against AGENTS.md rules 3 to 6. Try to break it:
- find an input that makes a hook block a call on error
- find a way to get tool arguments or file contents into an event
- find a state reported as clean that was never checked
Report concrete reproductions only.
```

## Definition of done for a phase

The gate command passes on a clean clone, the README status table matches the code, and Agora's
own repository uses the feature in its own CI. Tick the phase's boxes in `docs/PLAN.md` and update
`docs/STATUS.md` in the same pull request.

## Build and test

```bash
bun install
bun run test            # vitest, hermetic (no network)
bun run lint            # biome
bun run typecheck       # tsc
bun run build           # tsc + copy the bundled revocation list and policy defaults
bun run verify:package  # pack, install into an empty directory, smoke-test the binary
bun src/cli.ts <cmd>    # run from source
```

## Module splitting

Files over 500 lines split into a subdirectory with a barrel at the original path, so existing
import paths keep working.

## Publishing to npm

Releases are driven by GitHub Releases; `.github/workflows/publish.yml` publishes when a release is
created and moves the `v0` tag.

1. Bump the version in `package.json` (see `CHANGELOG.md`'s `## Unreleased` for scope).
2. Rename `## Unreleased` to `## [<version>] - <YYYY-MM-DD>`.
3. Run the full check command (rule 10).
4. Commit `Release v<version>`, push, tag `v<version>`, push the tag.
5. Create the GitHub Release with the changelog section as the body.
6. Verify: the Actions run, `npm view agora-hub version`, `npx -y agora-hub --version`.

Unpublish only within 72 hours (`npm unpublish agora-hub@<version>`); after that, publish a patch.

| Change | Bump |
|---|---|
| Breaking CLI change or new feature | minor (`0.8.0` → `0.9.0`) |
| Bug fix or documentation | patch |
| Changelog only | none; fold into the next release |
