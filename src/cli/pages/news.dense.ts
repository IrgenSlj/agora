import type { Page, PageAction, PageContext } from './types.js';

// ── helpers ───────────────────────────────────────────────────────────────────
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const vlen = (s: string): number => s.replace(ANSI_RE, '').length;
function padRight(s: string, w: number): string {
  const need = w - vlen(s);
  return need > 0 ? s + ' '.repeat(need) : s;
}
function truncate(s: string, w: number): string {
  if (vlen(s) <= w) return s;
  const plain = s.replace(ANSI_RE, '');
  return plain.slice(0, Math.max(0, w - 1)) + '\u2026';
}
function rail(style: { accent(s: string): string }): string {
  return style.accent('x') === 'x' ? '> ' : style.accent('\u258c') + ' ';
}
function noRail(): string { return '  '; }
function frame(lines: ReadonlyArray<string>, width: number, height: number): string {
  const out: string[] = [];
  for (let i = 0; i < height; i++) {
    out.push(padRight(truncate(lines[i] ?? '', width), width));
  }
  return out.join('\n');
}
// ──────────────────────────────────────────────────────────────────────────────

// FIXTURE: replace with src/news/* in PR 3.
type Source = 'hn' | 'reddit' | 'gh' | 'arxiv';
interface Story {
  source: Source; title: string; host: string; url: string;
  ageH: number; up: number; score: number; topic: string;
  read: boolean; saved: boolean;
}
const STORIES: ReadonlyArray<Story> = [
  { source: 'hn', title: 'MCP servers in production: a year later',
    host: 'news.ycombinator.com', url: 'https://news.ycombinator.com/item?id=1',
    ageH: 12, up: 482, score: 1.72, topic: 'mcp', read: false, saved: false },
  { source: 'reddit', title: 'Claude Code workflow ideas',
    host: '/r/AnthropicClaude', url: 'https://reddit.com/r/AnthropicClaude/comments/x',
    ageH: 6, up: 211, score: 1.34, topic: 'agents', read: false, saved: false },
  { source: 'gh', title: 'modelcontextprotocol/servers \u00b7 +312 \u2605 today',
    host: 'github.com', url: 'https://github.com/modelcontextprotocol/servers',
    ageH: 3, up: 312, score: 1.21, topic: 'mcp', read: false, saved: false },
  { source: 'arxiv', title: 'Tool-use scaling in long-horizon agents',
    host: 'arxiv.org', url: 'https://arxiv.org/abs/2510.0',
    ageH: 48, up: 0, score: 0.91, topic: 'research', read: true, saved: false },
];

interface NewsState {
  cursor: number; source: Source | 'all'; topic: string;
  filter: string; filtering: boolean;
}
const state: NewsState = {
  cursor: 0, source: 'all', topic: 'all', filter: '', filtering: false,
};

function visible(): Story[] {
  return STORIES.filter((s) =>
    (state.source === 'all' || s.source === state.source)
    && (state.topic === 'all' || s.topic === state.topic)
    && (!state.filter || s.title.toLowerCase().includes(state.filter.toLowerCase())),
  );
}

export const newsPage: Page = {
  id: 'news',
  title: 'NEWS',
  navLabel: 'News',
  navIcon: 'N',
  hotkeys: [
    { key: 'j/k', label: 'nav' },
    { key: 'Enter', label: 'open' },
    { key: 's', label: 'save' },
    { key: 'p', label: 'mark read' },
    { key: '/', label: 'filter' },
    { key: 't', label: 'topic' },
    { key: 'r', label: 'refresh' },
    { key: 'A/H/R/G/X', label: 'source' },
  ],
  render(ctx: PageContext): string {
    const { style, width, height } = ctx;
    const list = visible();
    state.cursor = Math.min(state.cursor, Math.max(0, list.length - 1));
    const lines: string[] = [];
    const head = ' ' + style.bold(style.accent('NEWS'));
    const right = style.dim('src:') + style.accent(state.source)
      + style.dim('  topic:') + style.accent(state.topic)
      + style.dim('  ' + list.length + ' stories');
    const gap = Math.max(2, width - vlen(head) - vlen(right) - 2);
    lines.push(head + ' '.repeat(gap) + right);
    lines.push(' ' + style.dim('\u2500'.repeat(Math.max(0, width - 2))));
    if (state.filtering) {
      lines.push(' ' + style.accent('/') + ' ' + state.filter + style.dim('\u258f'));
    }
    if (list.length === 0) {
      lines.push(' ' + style.dim('Empty feed. Adjust filters: ')
        + style.accent('t') + style.dim(' topic, ')
        + style.accent('A/H/R/G/X') + style.dim(' source (all/HN/Reddit/GH/arXiv).'));
      return frame(lines, width, height);
    }
    list.forEach((s, i) => {
      const sel = i === state.cursor;
      const lead = sel ? rail(style) : noRail();
      const rank = (i + 1).toString().padStart(2);
      const src = style.accent(s.source.toUpperCase().padEnd(6));
      const age = style.dim((s.ageH + 'h').padEnd(4));
      const up = style.accent(('\u2191 ' + s.up).padStart(7));
      const score = style.dim('s' + s.score.toFixed(2));
      const titleColor = s.read ? style.dim(s.title)
        : (sel ? style.bold(s.title) : s.title);
      lines.push(' ' + lead + style.dim(rank + '. ') + src + ' ' + age + '  '
        + up + '  ' + score + '   ' + titleColor);
      lines.push('         ' + style.dim(s.host)
        + (s.saved ? style.accent('  saved') : ''));
      lines.push(' ' + style.dim('\u2500'.repeat(Math.max(0, width - 2))));
    });
    return frame(lines, width, height);
  },
  handleKey(event, _ctx): PageAction {
    if (state.filtering) {
      if (event.key === 'esc') { state.filtering = false; state.filter = ''; return { kind: 'none' }; }
      if (event.key === 'enter') { state.filtering = false; return { kind: 'none' }; }
      if (event.key === 'backspace') { state.filter = state.filter.slice(0, -1); return { kind: 'none' }; }
      if (event.key.length === 1 && !event.ctrl) { state.filter += event.key; return { kind: 'none' }; }
      return { kind: 'none' };
    }
    const list = visible();
    switch (event.key) {
      case 'j': case 'down':
        state.cursor = Math.min(list.length - 1, state.cursor + 1); return { kind: 'none' };
      case 'k': case 'up':
        state.cursor = Math.max(0, state.cursor - 1); return { kind: 'none' };
      case 'enter': {
        const it = list[state.cursor];
        return it ? { kind: 'open-url', url: it.url } : { kind: 'none' };
      }
      case 's': return { kind: 'status', message: 'saved' };
      case 'p': return { kind: 'status', message: 'marked read' };
      case '/': state.filtering = true; return { kind: 'none' };
      case 't': {
        const order = ['all', 'mcp', 'agents', 'research'];
        state.topic = order[(order.indexOf(state.topic) + 1) % order.length] ?? 'all';
        state.cursor = 0;
        return { kind: 'none' };
      }
      case 'r': return { kind: 'status', message: 'refreshed' };
      case 'A': state.source = 'all'; state.cursor = 0; return { kind: 'none' };
      case 'H': state.source = 'hn'; state.cursor = 0; return { kind: 'none' };
      case 'R': state.source = 'reddit'; state.cursor = 0; return { kind: 'none' };
      case 'G': state.source = 'gh'; state.cursor = 0; return { kind: 'none' };
      case 'X': state.source = 'arxiv'; state.cursor = 0; return { kind: 'none' };
      default: return { kind: 'none' };
    }
  },
};
