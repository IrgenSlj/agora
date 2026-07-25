// Generates the repo's brand assets as SVG, from the SAME constants the CLI
// renders at runtime (src/ui.ts). Nothing here is hand-drawn: the wordmark is
// the literal carved-relief cell grid the terminal prints, so the README and
// the CLI can never drift apart.
//
//   bun scripts/generate-brand-assets.ts
//
// Outputs into docs/assets/.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGORA_WORDMARK_RELIEF, BANNER_GRADIENT, sampleGradient } from '../src/ui.js';

const OUT_DIR = join(import.meta.dirname, '..', 'docs', 'assets');

// Shade per relief character. The terminal encodes carved depth in the glyph
// itself (top highlight / solid stroke / bottom shadow) so it survives
// NO_COLOR; here that becomes opacity over the same gradient.
const SHADE: Record<string, number> = {
  '█': 1,
  '▓': 0.72,
  '▒': 0.46
};

const CREAM = '#DCC49E';
const TERRACOTTA = '#C66A4A';
const BRICK = '#944038';
const AMBER = '#D4A85A';
const STONE_DIM = '#6B6253';

/** Panel fills: opaque so the artwork never touches GitHub's page background. */
const PANEL_DARK = '#1A1614';
const PANEL_INK = '#F2E8DA';

function hex(rgb: readonly number[]): string {
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

interface Cell {
  col: number;
  row: number;
  shade: number;
  fill: string;
}

/** Walk the relief grid into positioned, coloured cells. */
function wordmarkCells(): { cells: Cell[]; cols: number; rows: number } {
  const rows = AGORA_WORDMARK_RELIEF.length;
  const cols = Math.max(...AGORA_WORDMARK_RELIEF.map((r) => r.length));
  const cells: Cell[] = [];

  for (let row = 0; row < rows; row++) {
    const line = AGORA_WORDMARK_RELIEF[row] ?? '';
    for (let col = 0; col < line.length; col++) {
      const shade = SHADE[line[col] as string];
      if (shade === undefined) continue;
      // Sample the gradient across the wordmark's width, exactly as
      // renderBanner does per column in the terminal.
      const fill = hex(sampleGradient(BANNER_GRADIENT, col / (cols - 1)));
      cells.push({ col, row, shade, fill });
    }
  }
  return { cells, cols, rows };
}

/**
 * Emit the wordmark as a <g> of rects. `unit` is the cell size; cells are drawn
 * at unit x (unit*1.9) because terminal cells are ~1:2 — keeping that ratio is
 * what makes the SVG read as the same letterforms as the CLI.
 */
function wordmarkGroup(unit: number, x: number, y: number): { svg: string; w: number; h: number } {
  const { cells, cols, rows } = wordmarkCells();
  const cw = unit;
  const ch = unit * 1.9;
  const parts = cells.map(
    (c) =>
      `<rect x="${(c.col * cw).toFixed(2)}" y="${(c.row * ch).toFixed(2)}" ` +
      `width="${cw.toFixed(2)}" height="${ch.toFixed(2)}" ` +
      `fill="${c.fill}" opacity="${c.shade}"/>`
  );
  return {
    svg: `<g transform="translate(${x} ${y})" shape-rendering="crispEdges">\n    ${parts.join('\n    ')}\n  </g>`,
    w: cols * cw,
    h: rows * ch
  };
}

/** A thin meander (Greek key) rule — the civic/architectural motif, in stone dim. */
function meander(x: number, y: number, width: number, unit: number, color: string): string {
  const u = unit;
  const segments: string[] = [];
  let cursor = 0;
  while (cursor + u * 6 <= width) {
    const sx = x + cursor;
    segments.push(
      `M ${sx} ${y + u * 3} V ${y} H ${sx + u * 4} V ${y + u * 2} H ${sx + u * 2} V ${y + u}`
    );
    cursor += u * 6;
  }
  return `<path d="${segments.join(' ')}" fill="none" stroke="${color}" stroke-width="${(u * 0.55).toFixed(2)}" opacity="0.55" stroke-linecap="square"/>`;
}

function svgDoc(width: number, height: number, body: string, title: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}">
  <title>${title}</title>
${body}
</svg>
`;
}

// ── 1. README hero banner ───────────────────────────────────────────────────

function heroBanner(): string {
  const W = 1200;
  const mark = wordmarkGroup(11, 0, 0);
  const markX = Math.round((W - mark.w) / 2);

  // Layout is derived from the mark's real height rather than guessed, so the
  // meander rules can never collide with the type when the grid changes.
  const topRule = 46;
  const markY = topRule + 62;
  const taglineY = markY + mark.h + 56;
  const subtitleY = taglineY + 32;
  const bottomRule = subtitleY + 34;
  const H = Math.round(bottomRule + 46);

  return svgDoc(
    W,
    H,
    `  <rect width="${W}" height="${H}" fill="${PANEL_DARK}"/>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" fill="none" stroke="${BRICK}" stroke-width="2" opacity="0.5"/>
  ${meander(48, topRule, W - 96, 7, STONE_DIM)}
${mark.svg.replace('translate(0 0)', `translate(${markX} ${markY})`)}
  <text x="${W / 2}" y="${taglineY}" text-anchor="middle" font-family="ui-sans-serif, -apple-system, Segoe UI, Helvetica, Arial, sans-serif" font-size="25" letter-spacing="0.14em" fill="${CREAM}">THE TRUST PLANE FOR AGENTIC TOOLING</text>
  <text x="${W / 2}" y="${subtitleY}" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="16" fill="${AMBER}" opacity="0.85">verify · gate · manage — MCP servers and Agent Skills, across every host</text>
  ${meander(48, bottomRule, W - 96, 7, STONE_DIM)}`,
    'Agora — the trust plane for agentic tooling'
  );
}

// ── 2. GitHub social preview (1280x640, safe area centred) ──────────────────

function socialPreview(): string {
  // GitHub's social card is a fixed 1280x640 and gets cropped by some
  // consumers, so everything meaningful stays well inside the border.
  const W = 1280;
  const H = 640;
  const mark = wordmarkGroup(13, 0, 0);
  const markX = Math.round((W - mark.w) / 2);

  const topRule = 112;
  const markY = topRule + 76;
  const taglineY = markY + mark.h + 66;
  const subtitleY = taglineY + 42;
  const bottomRule = subtitleY + 44;
  const cmdY = bottomRule + 52;

  return svgDoc(
    W,
    H,
    `  <rect width="${W}" height="${H}" fill="${PANEL_DARK}"/>
  <rect x="26" y="26" width="${W - 52}" height="${H - 52}" fill="none" stroke="${BRICK}" stroke-width="2" opacity="0.55"/>
  ${meander(74, topRule, W - 148, 8, STONE_DIM)}
${mark.svg.replace('translate(0 0)', `translate(${markX} ${markY})`)}
  <text x="${W / 2}" y="${taglineY}" text-anchor="middle" font-family="ui-sans-serif, -apple-system, Segoe UI, Helvetica, Arial, sans-serif" font-size="30" letter-spacing="0.15em" fill="${CREAM}">THE TRUST PLANE FOR AGENTIC TOOLING</text>
  <text x="${W / 2}" y="${subtitleY}" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="19" fill="${AMBER}" opacity="0.85">evidence, not scores · local-first · no accounts</text>
  ${meander(74, bottomRule, W - 148, 8, STONE_DIM)}
  <text x="${W / 2}" y="${cmdY}" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="18" fill="${TERRACOTTA}">npx -y agora-hub doctor</text>`,
    'Agora — the trust plane for agentic tooling'
  );
}

// ── 3. Logomark (square, the carved A under an arch) ────────────────────────

function logomark(): string {
  const S = 512;
  // Just the "A" columns of the relief grid (cols 0-11).
  const rows = AGORA_WORDMARK_RELIEF.length;
  const unit = 30;
  const cw = unit;
  const ch = unit * 1.9;
  const parts: string[] = [];
  for (let row = 0; row < rows; row++) {
    const line = AGORA_WORDMARK_RELIEF[row] ?? '';
    for (let col = 0; col < 11; col++) {
      const shade = SHADE[line[col] as string];
      if (shade === undefined) continue;
      const fill = hex(sampleGradient(BANNER_GRADIENT, col / 10));
      parts.push(
        `<rect x="${(col * cw).toFixed(2)}" y="${(row * ch).toFixed(2)}" width="${cw.toFixed(2)}" height="${ch.toFixed(2)}" fill="${fill}" opacity="${shade}"/>`
      );
    }
  }
  const gw = 11 * cw;
  const gh = rows * ch;

  return svgDoc(
    S,
    S,
    `  <rect width="${S}" height="${S}" rx="96" fill="${PANEL_DARK}"/>
  <rect x="14" y="14" width="${S - 28}" height="${S - 28}" rx="84" fill="none" stroke="${BRICK}" stroke-width="3" opacity="0.6"/>
  <g transform="translate(${((S - gw) / 2).toFixed(1)} ${((S - gh) / 2).toFixed(1)})" shape-rendering="crispEdges">
    ${parts.join('\n    ')}
  </g>`,
    'Agora logomark'
  );
}

// ── 4. Wordmark alone, light and dark panels ────────────────────────────────

function wordmarkAsset(panel: string, name: string): string {
  const mark = wordmarkGroup(10, 0, 0);
  const padX = 40;
  const padY = 34;
  const W = Math.round(mark.w + padX * 2);
  const H = Math.round(mark.h + padY * 2);
  return svgDoc(
    W,
    H,
    `  <rect width="${W}" height="${H}" fill="${panel}"/>
${mark.svg.replace('translate(0 0)', `translate(${padX} ${padY})`)}`,
    name
  );
}

// ── write ───────────────────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true });

const assets: Array<[string, string]> = [
  ['banner.svg', heroBanner()],
  ['social-preview.svg', socialPreview()],
  ['logomark.svg', logomark()],
  ['wordmark-dark.svg', wordmarkAsset(PANEL_DARK, 'Agora wordmark')],
  ['wordmark-light.svg', wordmarkAsset(PANEL_INK, 'Agora wordmark')]
];

for (const [name, contents] of assets) {
  const path = join(OUT_DIR, name);
  writeFileSync(path, contents, 'utf8');
  console.log(`wrote ${path} (${(contents.length / 1024).toFixed(1)}KB)`);
}
