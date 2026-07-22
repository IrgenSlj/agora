# Tests

```bash
bun run test                         # full suite
bun run test test/shell.test.ts      # one file
bun run test -- --watch              # watch mode
```

Tests are written with Vitest and run through Bun. Keep the default suite hermetic: no live network,
no real host config writes, and no real `~/.agora` state.

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
├── federation/               # upstream adapter, cache, sync, and CLI contract coverage
│   ├── adapter-contract.test.ts # shared RegistrySource contract over fixture responses
│   ├── official.test.ts      # official MCP Registry adapter
│   ├── glama.test.ts         # Glama adapter
│   ├── pulsemcp.test.ts      # optional partner-gated PulseMCP adapter
│   ├── skills-github.test.ts # GitHub-hosted Agent Skills adapter
│   ├── cli-search.test.ts    # `agora search` federation behavior
│   └── sync.test.ts          # purl-keyed SQLite/CAS source sync
├── stack/                    # host adapters, sync/plan/apply, doctor, MCP probing
└── hubs/
    ├── enrichment.test.ts    # GitHub + HF README enrichment (mocked opencode)
    ├── github.test.ts        # GitHub Search REST connector
    ├── huggingface.test.ts   # HF models / datasets / spaces connector
    └── quality.test.ts       # stars / recency / license quality gate
```

## Conventions

- **Hermetic by default.** No network. No real `~/.config/agora`. CLI tests use `mkdtempSync` for the data dir and pass `--data-dir` or `AGORA_HOME`.
- **Fake IO streams** (collected `stdout` / `stderr` buffers). See `createIo` in `cli.test.ts` for the harness.
- **Inject `fetcher: FetchLike`** for anything HTTP-touching: federation adapters, `today`, scan/acquire checks, and hosted API shims. Tests should never hit a real endpoint.
- **Network-gated tests** (`AGORA_NETWORK_TESTS=1`) verify the curated catalog against the live npm registry — kept out of the default suite.

## Adding tests

```ts
import { describe, expect, test } from 'vitest';
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
