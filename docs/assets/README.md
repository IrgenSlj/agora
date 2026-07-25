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

Still to come: the five architecture diagrams specified in
[`../DIAGRAM_BRIEF.md`](../DIAGRAM_BRIEF.md), which land here as `diagram-*.svg`.
