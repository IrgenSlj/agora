import type { DesiredInstruction, SyncChange } from '../types.js';

/**
 * Shared merge strategy for adapters whose harness reads ONE shared markdown
 * file for instructions (Claude Code's CLAUDE.md, Windsurf's rules file):
 * agora carves out named, delimited sections inside that file and leaves
 * everything else — a human's hand-authored prose, headings, whatever came
 * before agora ever touched the file — completely untouched. This is the
 * "surgical write" contract (writeServers discipline) applied to a single
 * text file instead of a JSON/TOML document.
 */

const MARKER_RE = /<!-- agora:instructions:begin:(.+?) -->\n([\s\S]*?)<!-- agora:instructions:end:\1 -->\n?/g;

function beginMarker(name: string): string {
  return `<!-- agora:instructions:begin:${name} -->`;
}

function endMarker(name: string): string {
  return `<!-- agora:instructions:end:${name} -->`;
}

function stripTrailingNewline(s: string): string {
  return s.endsWith('\n') ? s.slice(0, -1) : s;
}

function renderSection(name: string, content: string): string {
  const body = content.endsWith('\n') ? content : `${content}\n`;
  return `${beginMarker(name)}\n${body}${endMarker(name)}\n`;
}

export interface MarkerSection {
  name: string;
  content: string;
}

/** Extract agora-managed marker sections from a shared instructions file. */
export function extractMarkerSections(text: string): MarkerSection[] {
  const sections: MarkerSection[] = [];
  const re = new RegExp(MARKER_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    sections.push({ name: match[1]!, content: stripTrailingNewline(match[2] ?? '') });
  }
  return sections;
}

/**
 * Merge `desired` named sections into `existingText`. Only agora-managed
 * marker blocks are added/updated/removed; anything outside them survives
 * byte-for-byte. `prune` removes managed sections whose name is not present
 * in `desired`; without it, unmanaged/unlisted existing sections are left
 * alone (matching writeServers' `prune` semantics for MCP servers).
 */
export function mergeMarkerSections(
  existingText: string,
  desired: DesiredInstruction[],
  opts: { prune: boolean }
): { text: string; change: SyncChange } {
  const added: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  const existingNames = new Set(extractMarkerSections(existingText).map((s) => s.name));
  const desiredByName = new Map(desired.map((d) => [d.name, d]));

  const re = new RegExp(MARKER_RE.source, 'g');
  let text = existingText.replace(re, (full: string, name: string, rawContent: string) => {
    const wanted = desiredByName.get(name);
    if (!wanted) {
      if (opts.prune) {
        removed.push(name);
        return '';
      }
      return full;
    }
    const existingContent = stripTrailingNewline(rawContent ?? '');
    const newContent = wanted.content ?? '';
    if (newContent !== existingContent) {
      updated.push(name);
      return renderSection(name, newContent);
    }
    return full;
  });

  const appendParts: string[] = [];
  for (const d of desired) {
    if (existingNames.has(d.name)) continue;
    added.push(d.name);
    appendParts.push(renderSection(d.name, d.content ?? ''));
  }

  if (appendParts.length > 0) {
    const needsSep = text.length > 0 && !text.endsWith('\n');
    text = text + (needsSep ? '\n\n' : text.length > 0 ? '\n' : '') + appendParts.join('\n');
  }

  return { text, change: { added, updated, removed } };
}
