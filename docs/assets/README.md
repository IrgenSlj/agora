# Brand assets

From the Claude Design handoff of 2026-11-12; the terminal side of the same identity is
[`docs/TERMINAL.md`](../TERMINAL.md). Text is outlined to paths, so the SVGs need no fonts.

| File | Size | Use |
|---|---|---|
| `banner.svg` | 1200×370 | README hero |
| `social-preview.svg` | 1280×640 | source for the social card |
| `social-preview.png` | 1280×640 | **upload this** to Settings → Social preview (GitHub needs a raster) |

Both sit on their own opaque panel (`#15181C`), so they read the same on GitHub's light and dark
pages. Palette: ink `#3A86AD`, moss `#4C9457`, amber `#B5802A`, brick `#CC5A48`, violet `#8B7BC4`,
stone `#807D75`, paper `#D9D6CE`.

Render the PNG from the SVG with headless Chrome:

```bash
cd docs/assets
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars \
  --window-size=1280,640 --screenshot="$PWD/social-preview.png" "file://$PWD/social-preview.svg"
```
