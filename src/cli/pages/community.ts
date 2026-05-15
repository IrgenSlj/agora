import type { Page, PageAction, PageContext } from './types.js';
import type { BoardSummary, Thread, Reply } from '../../community/types.js';
import type { SourceOptions } from '../../live.js';
import { communityBoardsSource, communityThreadsSource, communityThreadSource } from '../../community/client.js';
import { BOARD_LABELS } from '../../community/types.js';
import { loadAgoraState, getAuthState } from '../../state.js';

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

function hoursAgo(iso: string): number {
  return Math.max(0, (Date.now() - new Date(iso).getTime()) / 3600000);
}

function fmtAge(hours: number): string {
  if (hours < 1) return '<1h';
  if (hours < 24) return Math.round(hours) + 'h';
  return Math.round(hours / 24) + 'd';
}

function detectDataDir(): string {
  return process.env.AGORA_DATA_DIR || (process.env.HOME ? process.env.HOME + '/.config/agora' : '.agora');
}

let cachedBoards: BoardSummary[] = [];
let cachedThreads: Thread[] = [];
let cachedReplies: Reply[] = [];
let boardsLoading = true;

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

interface FlatReply {
  reply: Reply;
  depth: number;
}

function flattenReplies(replies: Reply[], depth = 0): FlatReply[] {
  const flat: FlatReply[] = [];
  for (const r of replies) {
    flat.push({ reply: r, depth });
    if (r.children && r.children.length > 0) {
      flat.push(...flattenReplies(r.children, depth + 1));
    }
  }
  return flat;
}

function buildSourceOptions(ctx: PageContext): SourceOptions {
  const dir = detectDataDir();
  let apiUrl = process.env.AGORA_API_URL || '';
  let token = process.env.AGORA_TOKEN || process.env.AGORA_API_TOKEN || '';
  if (!apiUrl || !token) {
    try {
      const agoraState = loadAgoraState(dir);
      const auth = getAuthState(agoraState);
      if (auth) {
        if (!apiUrl) apiUrl = auth.apiUrl || '';
        if (!token) token = auth.token || '';
      }
    } catch { /* ignore */ }
  }
  return { useApi: Boolean(apiUrl), apiUrl, token, fetcher: ctx.io.fetcher, timeoutMs: 10000 };
}

async function loadBoards(ctx: PageContext): Promise<void> {
  try {
    const opts = buildSourceOptions(ctx);
    const result = await communityBoardsSource(opts);
    cachedBoards = result.data.boards;
  } catch { /* keep empty */ }
  boardsLoading = false;
}

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
  mount(_ctx: PageContext): void {
    boardsLoading = true;
    loadBoards(_ctx);
  },
  render(ctx: PageContext): string {
    const { style, width, height } = ctx;
    const lines: string[] = [];
    const rule = ' ' + style.dim('\u2500'.repeat(Math.max(0, width - 2)));

    if (boardsLoading) {
      lines.push(' ' + style.dim('Loading community\u2026'));
      return frame(lines, width, height);
    }

    if (state.view === 'boards') {
      const newTotal = cachedBoards.reduce((s, b) => s + b.newToday, 0);
      lines.push(' ' + style.bold(style.accent('COMMUNITY'))
        + style.dim('  ' + cachedBoards.length + ' boards \u00b7 ' + newTotal + ' new today'));
      lines.push(rule);
      const list = cachedBoards.filter((b) => !state.filter || b.id.includes(state.filter));
      if (list.length === 0) {
        lines.push(' ' + style.dim('No boards match.'));
      } else {
        list.forEach((b, i) => {
          const sel = i === state.boardCur;
          const lead = sel ? rail(style) : noRail();
          const displayName = '/' + b.id;
          const name = sel ? style.bold(displayName) : displayName;
          const stats = style.dim(b.threadCount.toString().padStart(4) + ' th  '
            + b.newToday.toString().padStart(2) + ' new');
          const gap = Math.max(2, width - vlen(' ' + lead + displayName) - vlen(stats) - 1);
          lines.push(' ' + lead + name + ' '.repeat(gap) + stats);
          const label = BOARD_LABELS[b.id];
          if (label) lines.push('     ' + style.dim(label));
        });
      }
    } else if (state.view === 'threads') {
      const board = state.board ?? cachedBoards[state.boardCur]?.id ?? 'mcp';
      const list = cachedThreads.filter((t) =>
        !state.filter || t.title.toLowerCase().includes(state.filter.toLowerCase()));
      lines.push(' ' + style.bold(style.accent('/' + board))
        + style.dim('  ' + list.length + ' threads'));
      lines.push(rule);
      if (list.length === 0) {
        lines.push(' ' + style.dim('Empty board. ')
          + style.accent('n') + style.dim(' to start.'));
      } else {
        list.forEach((t, i) => {
          const sel = i === state.threadCur;
          const lead = sel ? rail(style) : noRail();
          const title = sel ? style.bold(t.title) : t.title;
          const age = fmtAge(hoursAgo(t.createdAt));
          const meta = style.dim(t.author + ' \u00b7 ' + age);
          const counts = style.accent(t.score.toString().padStart(3)) + style.dim('\u2191  ')
            + style.accent(t.replyCount.toString().padStart(2)) + style.dim(' replies');
          lines.push(' ' + lead + title);
          lines.push('     ' + meta + '   ' + counts);
          lines.push(rule);
        });
      }
    } else {
      const tid = state.thread ?? '';
      const t = cachedThreads.find((x) => x.id === tid);
      if (!t) {
        lines.push(' ' + style.dim('Thread not found. Esc to go back.'));
      } else {
        const age = fmtAge(hoursAgo(t.createdAt));
        lines.push(' ' + style.bold(t.title) + '  '
          + style.accent(t.score + ' \u2191'));
        lines.push(' ' + style.dim(t.author + ' \u00b7 ' + age + ' \u00b7 ' + t.replyCount + ' replies'));
        lines.push(' ' + sep('body', width - 2, style));
        lines.push(' ' + t.content);
        lines.push(' ' + sep('replies', width - 2, style));
        const flatReplies = flattenReplies(cachedReplies);
        flatReplies.forEach((rn, i) => {
          const sel = i === state.replyCur;
          const lead = sel ? rail(style) : noRail();
          const indent = '\u2502 '.repeat(rn.depth);
          const ra = fmtAge(hoursAgo(rn.reply.createdAt));
          lines.push(' ' + indent + lead + style.dim(rn.reply.author + ' \u00b7 ' + ra)
            + '  ' + style.accent(rn.reply.score + ' \u2191'));
          lines.push('     ' + indent + rn.reply.content);
          lines.push(rule);
        });
      }
    }
    if (state.filtering) {
      lines.push(' ' + style.accent('/') + ' ' + state.filter + style.dim('\u258f'));
    }
    return frame(lines, width, height);
  },
  async handleKey(event, ctx): Promise<PageAction> {
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
          state.boardCur = Math.min(cachedBoards.length - 1, state.boardCur + 1); return { kind: 'none' };
        case 'k': case 'up':
          state.boardCur = Math.max(0, state.boardCur - 1); return { kind: 'none' };
        case 'enter': {
          const boardId = cachedBoards[state.boardCur]?.id;
          if (boardId) {
            const opts = buildSourceOptions(ctx);
            const result = await communityThreadsSource(opts, boardId);
            cachedThreads = result.data.threads;
            cachedReplies = [];
            state.board = boardId;
            state.view = 'threads';
            state.threadCur = 0;
          }
          return { kind: 'none' };
        }
        case 'n': return { kind: 'status', message: 'new thread (fixture)' };
        case '/': state.filtering = true; return { kind: 'none' };
        default: return { kind: 'none' };
      }
    }
    if (state.view === 'threads') {
      switch (event.key) {
        case 'j': case 'down':
          state.threadCur = Math.min(cachedThreads.length - 1, state.threadCur + 1); return { kind: 'none' };
        case 'k': case 'up':
          state.threadCur = Math.max(0, state.threadCur - 1); return { kind: 'none' };
        case 'enter': {
          const t = cachedThreads[state.threadCur];
          if (t) {
            const opts = buildSourceOptions(ctx);
            const result = await communityThreadSource(opts, t.id);
            cachedReplies = result.data.replies;
            state.thread = t.id;
            state.view = 'reader';
            state.replyCur = 0;
          }
          return { kind: 'none' };
        }
        case 'esc': state.view = 'boards'; return { kind: 'none' };
        case 'n': return { kind: 'status', message: 'new thread (fixture)' };
        case '/': state.filtering = true; return { kind: 'none' };
        default: return { kind: 'none' };
      }
    }
    const flatReplies = flattenReplies(cachedReplies);
    switch (event.key) {
      case 'j': case 'down':
        state.replyCur = Math.min(flatReplies.length - 1, state.replyCur + 1); return { kind: 'none' };
      case 'k': case 'up':
        state.replyCur = Math.max(0, state.replyCur - 1); return { kind: 'none' };
      case 'esc': state.view = 'threads'; return { kind: 'none' };
      case 'r': return { kind: 'status', message: 'reply composer (fixture)' };
      case 'v': return { kind: 'status', message: 'voted' };
      case 'f': return { kind: 'status', message: 'flagged' };
      default: return { kind: 'none' };
    }
  },
};
