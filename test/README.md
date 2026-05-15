# Agora Tests

## Running

```bash
bun test                       # full suite
bun test test/shell.test.ts    # one file
bun test --watch               # watch mode
```

At the time of writing: **16 test files, ~440 tests, 1 intentional skip.**
Tests are written with `bun:test` (Bun's built-in `describe` / `test` /
`expect` API).

## Suites

| File | Surface under test |
|---|---|
| `app.test.ts` | Top-level CLI command handlers (`commandSearch`, `commandBrowse`, `commandInstall`, etc.) wired against fake IO streams |
| `cli.test.ts` | Argument parsing, JSON output, error handling, end-to-end command flows |
| `marketplace.test.ts` | Core search / sort / filter / similarity logic on the bundled catalog |
| `data.test.ts` | Bundled-catalog invariants — every package has the required shape; npm-validated entries marked installable |
| `init.test.ts` | Project scanner, init plan generation, config writes |
| `state.test.ts` | Saved-item persistence, auth token state, atomic writes |
| `shell.test.ts` | Interactive shell — input classification (`classifyInput`, `looksLikeQuestion`), bash/chat dispatch |
| `prompter.test.ts` | Raw-mode line editor — completion, history, ghost text, CSI parsing |
| `completions.test.ts` | Completion providers (slash commands, paths, marketplace ids) |
| `chat-renderer.test.ts` | Markdown rendering for chat output, live thinking line |
| `mcp-server.test.ts` | MCP server tool registration and outputs |
| `transcript.test.ts` | Per-cwd transcript and session-meta files |
| `format.test.ts` | Number / count / table formatting helpers |
| `types.test.ts` | TypeScript type compatibility, JSON serialisation |
| `index.test.ts` | OpenCode plugin tool registration and output |
| `ui.test.ts` | Banner rendering, colour detection, styler |

## Fixtures

`test/fixtures/` holds small JSON / config fixtures used by the init and
marketplace suites.

## Network-gated tests

Some `data.test.ts` cases hit the live npm registry to verify that every
declared `npmPackage` resolves. They are gated behind `AGORA_NETWORK_TESTS=1`
to keep the default suite hermetic.

## Adding tests

```typescript
import { describe, test, expect } from 'bun:test';

describe('My feature', () => {
  test('does the thing', () => {
    expect(true).toBe(true);
  });
});
```

Prefer fake IO streams over real stdin/stdout for any CLI handler test —
`app.test.ts` has examples (`CliIo` with collected output buffers).
