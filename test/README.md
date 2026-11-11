# Tests

```bash
bun run test                          # full suite
bun run test test/doctor.test.ts      # one file
bun run test -- --watch               # watch mode
```

Vitest. The default suite is hermetic: no live network, no writes to real host configs, no real
`~/.config/agora` state. Inject `fetcher` for anything that touches HTTP, and point `HOME` and
`AGORA_HOME` at a temporary directory for anything that reads host configs.

Security behaviour is tested first (AGENTS.md rule 2). Prefer tests that enumerate states, such as
every retired command or every exit code, so a new command cannot slip past them.

`test/release/` checks the release machinery itself: the workflows, the Action reference the README
hands out, and the node engine floor. `bun run verify:package` is the other half: it packs the
tarball, installs it into an empty directory and runs the binary.
