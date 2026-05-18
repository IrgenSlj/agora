# Tests

```bash
bun test                       # full suite
bun test test/shell.test.ts    # one file
bun test --watch               # watch mode
```

**34 test files, 768 cases passing, 1 intentional skip.** Written with `bun:test` (Bun's built-in `describe` / `test` / `expect`).

## Layout

```
test/
├── cli.test.ts               # argument parsing + end-to-end CLI flows (largest)
├── app.test.ts               # top-level command handlers via fake IO
├── marketplace.test.ts       # search / sort / install plan / permissions / memo
├── data.test.ts              # bundled catalog invariants (every npmPackage resolves)
├── init.test.ts              # project scanner + init plan generation
├── state.test.ts             # saved-item + auth state, atomic writes
├── shell.test.ts             # interactive shell input classification + dispatch
├── prompter.test.ts          # raw-mode line editor + completion + history
├── completions.test.ts       # slash / path / marketplace id completion providers
├── chat-renderer.test.ts     # markdown rendering + live thinking line
├── mcp-server.test.ts        # MCP server tool registration
├── transcript.test.ts        # per-cwd transcript + session metadata
├── format.test.ts            # number / table formatting helpers
├── types.test.ts             # type compatibility + JSON serialization
├── index.test.ts             # OpenCode plugin tool registration
├── ui.test.ts                # banner, color detection, styler
├── news.test.ts              # scoring formula, cache, dedup, TTL, visible() filters
├── settings.test.ts          # TOML parser/serializer + news-source toggle generator
├── preferences.test.ts       # persistence + corrupt-file recovery
├── history.test.ts           # JSONL append log + limit + clear
├── today.test.ts             # daily digest command
├── welcome.test.ts           # first-run tour
├── home.test.ts              # home page hotkey routing + truncate
├── atomic-write.test.ts      # shared atomic write helper
├── community/                # community-scoped suites
│   ├── admin.test.ts         # kill-switch operator CLI + 403 surfacing
│   ├── composer.test.ts      # multi-line composer state machine
│   ├── flag-collapse.test.ts # auto-collapse + expand behavior
│   ├── reputation.test.ts    # computeReputation + weightedThreadScore boundaries
│   ├── search.test.ts        # FTS5 query sanitization + LIKE fallback
│   └── sort-and-vote.test.ts # sort cycle + vote glyph helper
└── hubs/
    ├── enrichment.test.ts    # GitHub + HF README enrichment (mocked opencode)
    ├── github.test.ts        # GitHub Search REST connector
    ├── huggingface.test.ts   # HF models / datasets / spaces connector
    └── quality.test.ts       # stars / recency / license quality gate
```

## Conventions

- **Hermetic by default.** No network. No real `~/.config/agora`. CLI tests use `mkdtempSync` for the data dir and pass `--data-dir`.
- **Fake IO streams** (collected `stdout` / `stderr` buffers). See `createIo` in `cli.test.ts` for the harness.
- **Inject `fetcher: FetchLike`** for anything HTTP-touching — `ping`, `today`, community client. Tests should never hit a real endpoint.
- **Network-gated tests** (`AGORA_NETWORK_TESTS=1`) verify the curated catalog against the live npm registry — kept out of the default suite to stay fast (~3.5s).

## Adding tests

```ts
import { describe, test, expect } from 'bun:test';
import { runCli } from '../src/cli/app';

describe('agora foo', () => {
  test('does the thing', async () => {
    const stdout: string[] = [];
    const io = {
      stdout: { write: (c: string) => stdout.push(c) },
      stderr: { write: () => {} }
    };
    const code = await runCli(['foo', '--json'], io);
    expect(code).toBe(0);
    const payload = JSON.parse(stdout.join(''));
    expect(payload).toEqual({ ok: true });
  });
});
```

Real assertions only — `expect(code).toBe(0)` alone isn't a test.
