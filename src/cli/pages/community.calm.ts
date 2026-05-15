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
function sep(label: string, width: number, style: { dim(s: string): string }): string {
  if (!label) return style.dim('\u2500'.repeat(Math.max(0, width)));
  const head = '\u2500\u2500 ' + label + ' ';
  const fill = Math.max(0, width - head.length);
  return style.dim(head + '\u2500'.repeat(fill));
}
function frame(lines: ReadonlyArray<string>, width: number, height: number): string {
  const out: string[] = [];
  for (let i = 0; i < height; i++) {
    out.push(padRight(truncate(lines[i] ?? '', width), width));
  }
  return out.join('\n');
}
// ──────────────────────────────────────────────────────────────────────────────

// FIXTURE: replace with backend calls in PR 7.
interface Board { id: string; name: string; threads: number; newToday: number; description: string; }
interface Thread {
  id: string; board: string; title: string; author: string;
  votes: number; replies: number; flag: number; ageH: number; body: string;
}
interface Reply { author: string; ageH: number; votes: number; body: string; }

const BOARDS: ReadonlyArray<Board> = [
  { id: 'mcp', name: '/mcp', threads: 236, newToday: 14, description: 'composing servers, schema design, runtime patterns' },
  { id: 'agents', name: '/agents', threads: 112, newToday: 8, description: 'agent loops, tool calling, evals' },
  { id: 'workflows', name: '/workflows', threads: 64, newToday: 3, description: 'multi-step prompts, TDD cycles, harnesses' },
  { id: 'prompts', name: '/prompts', threads: 188, newToday: 5, description: 'curated prompts and templates' },
  { id: 'meta', name: '/meta', threads: 41, newToday: 0, description: 'about agora itself' },
  { id: 'help', name: '/help', threads: 73, newToday: 2, description: 'install issues, configuration, troubleshooting' },
  { id: 'show', name: '/show', threads: 29, newToday: 1, description: 'show off your projects' },
];
const THREADS: Record<string, ReadonlyArray<Thread>> = {
  mcp: [
    { id: 't1', board: 'mcp', title: 'How are you composing servers?', author: 'ada',
      votes: 12, replies: 7, flag: 0, ageH: 6,
      body: 'I am stacking mcp-postgres, mcp-filesystem and a thin orchestrator. Anyone using a different pattern?' },
    { id: 't2', board: 'mcp', title: 'Lifecycle hooks: keep them or drop them?', author: 'lin',
      votes: 8, replies: 4, flag: 0, ageH: 14,
      body: 'The spec is ambiguous about init/shutdown ordering.' },
    { id: 't3', board: 'mcp', title: 'Auth tokens at the transport layer', author: 'gus',
      votes: 3, replies: 2, flag: 0, ageH: 36,
      body: 'Should headers be normalized?' },
  ],
};
const REPLIES: Record<string, ReadonlyArray<Reply>> = {
  t1: [
    { author: 'lin', ageH: 5, votes: 4, body: 'We compose at the orchestrator and keep servers single-purpose.' },
    { author: 'gus', ageH: 4, votes: 2, body: 'Same here. Single-purpose + shared schema package.' },
  ],
};

type View = 'boards' | 'threads' | 'reader';
interface ComState {
  view: View;
  boardCur: number; threadCur: number; replyCur: number;
  board?: string; thread?: string;
  filter: string; filtering: boolean;
}
const state: ComState = {
  view: 'boards', boardCur: 0, threadCur: 0, replyCur: 0,
  filter: '', filtering: false,
};

export const communityPage: Page = {
  id: 'community',
  title: 'COMMUNITY',
  navLabel: 'Comm',
  navIcon: 'C',
  hotkeys: [
    { key: 'j/k', label: 'nav' },
    { key: 'Enter', label: 'open' },
    { key: 'n', label: 'new' },
    { key: '/', label: 'filter' },
    { key: 'r', label: 'reply' },
    { key: 'v', label: 'vote' },
    { key: 'f', label: 'flag' },
    { key: 'Esc', label: 'back' },
  ],
  render(ctx: PageContext): string {
    const { style, width, height } = ctx;
    const lines: string[] = [];

    if (state.view === 'boards') {
      lines.push(' ' + style.bold(style.accent('COMMUNITY'))
        + '   ' + style.dim(BOARDS.length + ' boards'));
      lines.push('');
      const list = BOARDS.filter((b) => !state.filter || b.id.includes(state.filter));
      if (list.length === 0) {
        lines.push(' ' + style.dim('No boards match \u201c' + state.filter + '\u201d'));
      } else {
        list.forEach((b, i) => {
          const sel = i === state.boardCur;
          const lead = sel ? rail(style) : noRail();
          lines.push(' ' + lead + style.bold(b.name.padEnd(14))
            + style.dim(b.threads + ' threads \u00b7 ' + b.newToday + ' new today'));
          lines.push('     ' + style.dim(b.description));
          lines.push('');
        });
      }
    } else if (state.view === 'threads') {
      const board = state.board ?? BOARDS[state.boardCur]?.id ?? 'mcp';
      const list = (THREADS[board] ?? []).filter((t) =>
        !state.filter || t.title.toLowerCase().includes(state.filter.toLowerCase()));
      lines.push(' ' + style.bold(style.accent('/' + board))
        + '   ' + style.dim(list.length + ' threads'));
      lines.push('');
      if (list.length === 0) {
        lines.push(' ' + style.dim('No threads yet. Press ')
          + style.accent('n') + style.dim(' to start one.'));
      } else {
        list.forEach((t, i) => {
          const sel = i === state.threadCur;
          const lead = sel ? rail(style) : noRail();
          lines.push(' ' + lead + style.bold(t.title));
          lines.push('     ' + style.dim(t.author + ' \u00b7 ' + t.ageH + 'h \u00b7 '
            + t.votes + ' \u2191 \u00b7 ' + t.replies + ' replies'));
          lines.push('');
        });
      }
    } else {
      const board = state.board ?? 'mcp';
      const tid = state.thread ?? THREADS[board]?.[0]?.id ?? '';
      const thread = THREADS[board]?.find((t) => t.id === tid);
      if (!thread) {
        lines.push(' ' + style.dim('Thread not found. Esc to go back.'));
      } else {
        lines.push(' ' + style.bold(thread.title));
        lines.push(' ' + style.dim(thread.author + ' \u00b7 ' + thread.ageH + 'h \u00b7 ')
          + style.accent(thread.votes + ' \u2191'));
        lines.push('');
        lines.push(' ' + thread.body);
        lines.push('');
        lines.push(' ' + sep('replies', width - 2, style));
        lines.push('');
        const list = REPLIES[tid] ?? [];
        list.forEach((r, i) => {
          const sel = i === state.replyCur;
          const lead = sel ? rail(style) : noRail();
          lines.push(' ' + lead + style.dim(r.author + ' \u00b7 ' + r.ageH + 'h \u00b7 ')
            + style.accent(r.votes + ' \u2191'));
          lines.push('     ' + r.body);
          lines.push('');
        });
      }
    }

    if (state.filtering) {
      lines.push(' ' + style.accent('/') + ' ' + state.filter + style.dim('\u258f'));
    }
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
    if (state.view === 'boards') {
      switch (event.key) {
        case 'j': case 'down':
          state.boardCur = Math.min(BOARDS.length - 1, state.boardCur + 1); return { kind: 'none' };
        case 'k': case 'up':
          state.boardCur = Math.max(0, state.boardCur - 1); return { kind: 'none' };
        case 'enter':
          state.board = BOARDS[state.boardCur]?.id;
          state.view = 'threads'; state.threadCur = 0;
          return { kind: 'none' };
        case 'n': return { kind: 'status', message: 'new thread editor (fixture)' };
        case '/': state.filtering = true; return { kind: 'none' };
        default: return { kind: 'none' };
      }
    }
    if (state.view === 'threads') {
      const list = THREADS[state.board ?? ''] ?? [];
      switch (event.key) {
        case 'j': case 'down':
          state.threadCur = Math.min(list.length - 1, state.threadCur + 1); return { kind: 'none' };
        case 'k': case 'up':
          state.threadCur = Math.max(0, state.threadCur - 1); return { kind: 'none' };
        case 'enter':
          state.thread = list[state.threadCur]?.id;
          state.view = 'reader'; state.replyCur = 0;
          return { kind: 'none' };
        case 'esc': state.view = 'boards'; return { kind: 'none' };
        case 'n': return { kind: 'status', message: 'new thread editor (fixture)' };
        case '/': state.filtering = true; return { kind: 'none' };
        default: return { kind: 'none' };
      }
    }
    // reader
    const replies = REPLIES[state.thread ?? ''] ?? [];
    switch (event.key) {
      case 'j': case 'down':
        state.replyCur = Math.min(replies.length - 1, state.replyCur + 1); return { kind: 'none' };
      case 'k': case 'up':
        state.replyCur = Math.max(0, state.replyCur - 1); return { kind: 'none' };
      case 'esc': state.view = 'threads'; return { kind: 'none' };
      case 'r': return { kind: 'status', message: 'reply composer (fixture)' };
      case 'v': return { kind: 'status', message: 'voted' };
      case 'f': return { kind: 'status', message: 'flagged for review' };
      default: return { kind: 'none' };
    }
  },
};
