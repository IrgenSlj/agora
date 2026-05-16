# Agora Developer Prompt

You are developing the Agora marketplace plugin for OpenCode. These rules ensure the code you write is optimized for AI-assisted interaction.

## Tool Design

- **Every tool needs a crisp `description`** — this is what the model reads to decide which tool to call. Start with a verb: "Search...", "Browse...", "Install...".
- **Parameter names should be obvious from the tool name.** `agora_search(query)` not `agora_search(q)`. The model guesses arguments from names.
- **Use `describe()` on every schema field** — even optional ones. Without it the model has to infer from context, which wastes tokens and causes errors.
- **Return flat strings, not objects.** Tool output becomes part of the model's message history. Return a ready-to-render string, not JSON the model has to re-parse.
- **Format output for the model, not for a human terminal.** Use markdown, backticks, clear structure. The model will re-read its own outputs when composing responses.
- **No ANSI codes or terminal-specific formatting** in tool output — the model consumes plain text / markdown.
- **Error messages should say what happened AND what to do next.** Example: `Item "x" not found. Run \`/agora search <query>\` to find packages.` — the model can act on this.

## Slash Command Prompt (`src/commands.ts`)

The `AGORA_COMMAND_TEMPLATE` is the only thing that tells the model how to route `/agora` calls. Keep it minimal:

- **One routing rule, one sentence.** The model already has full tool descriptions from the plugin registration. Don't re-list them.
- **No preamble.** "You are operating..." is wasted tokens. The model knows its context.
- **No background.** Community features, CLI-only notes, etc. are irrelevant to routing.
- **Use `$ARGUMENTS` exactly once** — inline in the rule sentence.

Target: ~1 line of instruction, ~4 lines total including frontmatter.

Example optimal form:

```markdown
---
description: Search, browse, and install from the Agora marketplace
---

Route `$ARGUMENTS`: first word → call `agora_<word>` with rest as args. Empty → `agora_info`.
```

## Output from Plugin Tools

When a tool returns a result, the model typically summarizes it. Design your return strings so they're easy to re-read:

- **First line is a summary.** `🔍 **Search Results** for "mcp" (10 found)` — the model can use this as-is.
- **Use consistent formatting.** Same emoji conventions, same `**bold**` for IDs, same link style. The model learns patterns.
- **Include the next-action hint at the bottom.** `Run \`/agora browse <id>\` for details.` — this lets the model chain tools without guessing.

## Config-First Design

Agora tool registration in `src/index.ts` is the model's API contract. Every change to a tool name, args, or output format changes what the model sees and does. Before making structural changes:

1. Update the tool registration in `src/index.ts`
2. Read back the full file and check: if I were a model seeing only these descriptions, would I call the right tool with the right args?
3. If the tool needs a new parameter, add it with a `describe()` call first — the model needs the hint.

## Testing from the Model's Perspective

When you run `bun run typecheck` or `bun test`, you're testing the JavaScript execution path. To test the AI interaction path:

1. Read `src/index.ts` — are the tool descriptions unambiguous?
2. Read `src/commands.ts` — does the routing rule cover all cases?
3. Trace through a typical query: user types `/agora search postgres` → model reads routing rule → model calls `agora_search({query:"postgres"})` → tool returns string → model summarizes for user. Each step should be obvious.

## Pre-commit Checks

Before any commit:

- `bun run typecheck` — must pass
- `bun run lint` — must pass  
- `bun run build` — must produce working dist/
- Read `src/index.ts` and `src/commands.ts` — verify AI-facing strings are crisp

## Publishing to npm

The release process is driven by GitHub Releases — the CI workflow (`.github/workflows/publish.yml`) auto-publishes when a release is created. Manual publish is also possible but not recommended.

### Release Checklist

1. **Bump the version** in `package.json` (remove `-dev` suffix, set to release version).  
   The changelog drives the decision: check CHANGELOG.md for the `## Unreleased` section content.

2. **Finalize the changelog** — in CHANGELOG.md, rename `## Unreleased` to `## [<version>] - <YYYY-MM-DD>`.  
   Read through the entries: are they accurate? Is anything missing? Is the language public-facing?

3. **Quality gates** — run all four:
   ```
   bun run typecheck
   bun run lint
   bun run build
   bun test
   ```

4. **Commit and push:**
   ```
   git add -A
   git commit -m "Release v<version>"
   git push origin main
   ```

5. **Tag the release:**
   ```
   git tag v<version>
   git push origin v<version>
   ```

6. **Create the GitHub Release** — point at the tag, use the changelog section as body:
   ```bash
   gh release create v<version> --title "v<version>" --notes "$(cat CHANGELOG.md | awk '/^## \['"$version"'\]/,/^## \[/' | head -n -2)"
   ```
   Or create it manually in the GitHub UI. This triggers the `publish.yml` workflow.

7. **Verify the publish:**
   - Check `https://github.com/<owner>/agora/actions` — the Publish workflow should succeed.
   - Verify on npm: `npm view opencode-agora version` shows the new version.
   - Quick smoke test: `npx opencode-agora --version` and `npx opencode-agora search filesystem`.

### Rollback (if needed)

```
npm unpublish opencode-agora@<version>
git tag -d v<version> && git push origin :refs/tags/v<version>
```

Only unpublish within the first 72 hours. After that, publish a patch bump instead.

### Version Bump Rules

| Change scope | Bump | Example |
|---|---|---|
| Breaking API/CLI change | minor | `0.3.0` → `0.4.0` |
| New feature (backward-compatible) | minor | `0.3.0` → `0.4.0` |
| Bug fix / documentation | patch | `0.3.0` → `0.3.1` |
| Changelog policy | — | Never bump for changelog-only changes; do it in the next feature/fix release.
