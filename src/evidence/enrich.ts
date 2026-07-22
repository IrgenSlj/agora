import type { ToolSchemaLike } from './schemahash.js';

export type DescriptionPoisoningSignalKind =
  | 'imperative_to_model'
  | 'zero_width_unicode'
  | 'html_comment'
  | 'large_base64_blob'
  | 'cross_tool_shadowing';

export interface DescriptionPoisoningSignal {
  kind: DescriptionPoisoningSignalKind;
  severity: 'warn';
  toolName: string;
  message: string;
  excerpt: string;
  referencedToolName?: string;
}

const IMPERATIVE_TO_MODEL_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern:
      /\bignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|messages|prompts)\b/i,
    label: 'instruction override'
  },
  {
    pattern: /\bdo\s+not\s+(?:mention|tell|reveal|disclose)\b/i,
    label: 'concealment instruction'
  },
  { pattern: /\byou\s+must\s+always\b/i, label: 'model-directed imperative' },
  {
    pattern: /\bbefore\s+(?:answering|responding|returning)\b/i,
    label: 'response-control instruction'
  },
  { pattern: /\bsystem\s+prompt\b/i, label: 'system-prompt reference' },
  { pattern: /\bdeveloper\s+message\b/i, label: 'developer-message reference' }
];

const ZERO_WIDTH_PATTERN = /[\u200B-\u200D\uFEFF\u2060]/;
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/;
const BASE64_BLOB_PATTERN = /(?:^|[^A-Za-z0-9+/=])([A-Za-z0-9+/]{128,}={0,2})(?=$|[^A-Za-z0-9+/=])/;
const CROSS_TOOL_ACTION_PATTERN =
  /\b(?:call|invoke|use|run|execute|trigger|delegate\s+to|instead\s+of|prefer|before|after)\b/i;

function normalizeDescription(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenizeToolName(name: string): string {
  return name.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

function printableExcerpt(value: string): string {
  return value
    .replace(/\u200B/g, '\\u200B')
    .replace(/\u200C/g, '\\u200C')
    .replace(/\u200D/g, '\\u200D')
    .replace(/\u2060/g, '\\u2060')
    .replace(/\uFEFF/g, '\\uFEFF')
    .replace(/\s+/g, ' ')
    .trim();
}

function excerptAt(value: string, index: number, length: number): string {
  const start = Math.max(0, index - 32);
  const end = Math.min(value.length, index + length + 32);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < value.length ? '...' : '';
  return `${prefix}${printableExcerpt(value.slice(start, end))}${suffix}`;
}

function addSignal(
  signals: DescriptionPoisoningSignal[],
  signal: Omit<DescriptionPoisoningSignal, 'severity'>
): void {
  signals.push({ ...signal, severity: 'warn' });
}

function firstMatch(pattern: RegExp, value: string): RegExpExecArray | null {
  pattern.lastIndex = 0;
  return pattern.exec(value);
}

function toolNameMentionPattern(name: string): RegExp {
  const variants = new Set([name, tokenizeToolName(name)].filter(Boolean));
  const escaped = [...variants].map((variant) => escapeRegExp(variant));
  return new RegExp(`(?:^|[^A-Za-z0-9_])(?:${escaped.join('|')})(?=$|[^A-Za-z0-9_])`, 'i');
}

function detectCrossToolShadowing(
  tool: ToolSchemaLike,
  description: string,
  allTools: ReadonlyArray<ToolSchemaLike>
): Omit<DescriptionPoisoningSignal, 'severity'> | null {
  if (!CROSS_TOOL_ACTION_PATTERN.test(description)) return null;

  for (const other of allTools) {
    if (other.name === tool.name) continue;
    const pattern = toolNameMentionPattern(other.name);
    const match = firstMatch(pattern, description);
    if (!match) continue;
    const offset = match.index + match[0].search(/[A-Za-z0-9_]/);
    return {
      kind: 'cross_tool_shadowing',
      toolName: tool.name,
      referencedToolName: other.name,
      message: `description instructs the model to reference another tool (${other.name})`,
      excerpt: excerptAt(description, Math.max(match.index, offset), match[0].length)
    };
  }

  return null;
}

export function detectDescriptionPoisoning(
  tools: ReadonlyArray<ToolSchemaLike>
): DescriptionPoisoningSignal[] {
  const signals: DescriptionPoisoningSignal[] = [];

  for (const tool of tools) {
    const description = normalizeDescription(tool.description);
    if (!description) continue;

    for (const { pattern, label } of IMPERATIVE_TO_MODEL_PATTERNS) {
      const match = firstMatch(pattern, description);
      if (!match) continue;
      addSignal(signals, {
        kind: 'imperative_to_model',
        toolName: tool.name,
        message: `tool description contains a model-directed phrase (${label})`,
        excerpt: excerptAt(description, match.index, match[0].length)
      });
      break;
    }

    const zeroWidth = firstMatch(ZERO_WIDTH_PATTERN, description);
    if (zeroWidth) {
      addSignal(signals, {
        kind: 'zero_width_unicode',
        toolName: tool.name,
        message: 'tool description contains zero-width unicode',
        excerpt: excerptAt(description, zeroWidth.index, zeroWidth[0].length)
      });
    }

    const htmlComment = firstMatch(HTML_COMMENT_PATTERN, description);
    if (htmlComment) {
      addSignal(signals, {
        kind: 'html_comment',
        toolName: tool.name,
        message: 'tool description contains an HTML comment',
        excerpt: excerptAt(description, htmlComment.index, htmlComment[0].length)
      });
    }

    const base64Blob = firstMatch(BASE64_BLOB_PATTERN, description);
    if (base64Blob?.[1]) {
      const blobIndex = description.indexOf(base64Blob[1], base64Blob.index);
      addSignal(signals, {
        kind: 'large_base64_blob',
        toolName: tool.name,
        message: 'tool description contains a base64-looking blob longer than 128 characters',
        excerpt: excerptAt(description, blobIndex, base64Blob[1].length)
      });
    }

    const crossTool = detectCrossToolShadowing(tool, description, tools);
    if (crossTool) addSignal(signals, crossTool);
  }

  return signals.sort((a, b) => {
    const toolOrder = a.toolName.localeCompare(b.toolName);
    return toolOrder === 0 ? a.kind.localeCompare(b.kind) : toolOrder;
  });
}

export function hasDescriptionPoisoning(tools: ReadonlyArray<ToolSchemaLike>): boolean {
  return detectDescriptionPoisoning(tools).length > 0;
}

export function formatDescriptionPoisoningSignals(
  signals: ReadonlyArray<DescriptionPoisoningSignal>,
  limit = 5
): string {
  if (signals.length === 0) return 'no suspicious tool-description patterns';
  const shown = signals
    .slice(0, limit)
    .map((signal) => `${signal.toolName}: ${signal.kind}`)
    .join('; ');
  const remaining = signals.length > limit ? `; +${signals.length - limit} more` : '';
  return `suspicious tool-description pattern(s): ${shown}${remaining}`;
}
