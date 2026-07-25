# Brand assets

Generated, not hand-drawn. Regenerate with:

```bash
bun scripts/generate-brand-assets.ts
```

The wordmark is built from `AGORA_WORDMARK_RELIEF` and `BANNER_GRADIENT` in
[`src/ui.ts`](../../src/ui.ts) — the same constants the CLI renders at runtime — so the README and
the terminal can never drift apart. Editing the letterforms means editing `src/ui.ts` and re-running
the generator.

| File | Size | Use |
|---|---|---|
| `banner.svg` | 1200×~370 | README hero |
| `social-preview.svg` | 1280×640 | source for the social card |
| `social-preview.png` | 1280×640 | **upload this** to Settings → Social preview (GitHub needs a raster) |
| `logomark.svg` | 512×512 | square icon / avatar |
| `wordmark-dark.svg` | — | wordmark on the dark panel |
| `wordmark-light.svg` | — | wordmark on the light panel |
| `demo.gif` | 1200×700 | README terminal demo — see below |

## Palette — "marble & terracotta"

| Token | Hex |
|---|---|
| Cream | `#DCC49E` |
| Terracotta | `#C66A4A` |
| Brick | `#944038` |
| Amber | `#D4A85A` |
| Stone dim | `#6B6253` |

Every asset sits on its own opaque panel, so it renders identically against GitHub's light and dark
page backgrounds without needing `prefers-color-scheme` (which GitHub strips from README SVGs).

## Regenerating the PNG

`generate-brand-assets.ts` emits SVG only. The social card PNG is rendered from it:

```bash
cd docs/assets
qlmanage -t -s 1280 -o . social-preview.svg
ffmpeg -y -i social-preview.svg.png -vf "crop=1280:640:0:320" social-preview.png
rm social-preview.svg.png
```

(`qlmanage` pads to a square, hence the crop.)

## Re-recording the demo GIF

```bash
bun run build
bash scripts/demo-sandbox.sh          # seeds /tmp/agora-demo
vhs scripts/demo.tape                 # writes docs/assets/demo.gif
```

Requires [vhs](https://github.com/charmbracelet/vhs). The tape records four beats — `doctor`,
`search`, `scan`, `freeze` — against a throwaway sandbox HOME, so it never touches your real agent
configs. Beats 2 and 3 hit the network on purpose (live registry search, and the scan's GitHub/npm
checks), so the exact rows differ between takes.

Still to come: the five architecture diagrams specified in
[`../DIAGRAM_BRIEF.md`](../DIAGRAM_BRIEF.md), which land here as `diagram-*.svg`.
