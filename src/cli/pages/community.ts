import type { Page, PageAction, PageContext } from './types.js';
import type {
  BoardId,
  BoardSummary,
  Thread,
  Reply,
  SearchHit,
  SearchResult
} from '../../community/types.js';
import type { SourceOptions } from '../../live.js';
import {
  communityBoardsSource,
  communityThreadsSource,
  communityThreadSource,
  communitySearchSource,
  createThreadSource,
  createReplySource,
  voteSource,
  flagSource
} from '../../community/client.js';
import { BOARD_LABELS } from '../../community/types.js';
import { loadAgoraState, getAuthState } from '../../state.js';
import { vlen, rail, noRail, sep, frame } from './helpers.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function hoursAgo(iso: string): number {
  return Math.max(0, (Date.now() - new Date(iso).getTime()) / 3600000);
}

function fmtAge(hours: number): string {
  if (hours < 1) return '<1h';
  if (hours < 24) return Math.round(hours) + 'h';
  return Math.round(hours / 24) + 'd';
}

function detectDataDir(): string {
  return (
    process.env.AGORA_DATA_DIR ||
    (process.env.HOME ? process.env.HOME + '/.config/agora' : '.agora')
  );
}

// ── Types ────────────────────────────────────────────────────────────────────

interface ComposerState {
  active: boolean;
  mode: 'reply' | 'new-thread' | null;
  lines: string[];
  cursorLine: number;
  cursorCol: number;
  title?: string;
  board?: BoardId;
  replyTo?: string;
  status: 'editing' | 'sending' | 'error';
  errorMessage?: string;
}

interface FlagModalState {
  active: boolean;
  targetId: string;
  targetType: 'discussion' | 'reply';
  awaitingNotes: boolean;
  notes: string;
}

type View = 'boards' | 'threads' | 'reader';

type ThreadSort = 'top' | 'new' | 'active';

interface SearchState {
  active: boolean;
  query: string;
  cursorCol: number;
  results: SearchResult | null;
  loading: boolean;
  selectedIndex: number;
  scope: 'all' | BoardId;
}

interface ComState {
  view: View;
  boardCur: number;
  threadCur: number;
  replyCur: number;
  board?: string;
  thread?: string;
  filter: string;
  filtering: boolean;
  threadSort: ThreadSort;
  composer: ComposerState | null;
  flagModal: FlagModalState | null;
  expandedItems: Set<string>;
  userVotes: Map<string, -1 | 0 | 1>;
  statusMessage: string;
  statusTimer: ReturnType<typeof setTimeout> | null;
  search: SearchState | null;
}

interface FlatReply {
  reply: Reply;
  depth: number;
}

// ── Module state ─────────────────────────────────────────────────────────────

let cachedBoards: BoardSummary[] = [];
let cachedThreads: Thread[] = [];
let cachedReplies: Reply[] = [];
let boardsLoading = true;

const state: ComState = {
  view: 'boards',
  boardCur: 0,
  threadCur: 0,
  replyCur: 0,
  filter: '',
  filtering: false,
  threadSort: 'top',
  composer: null,
  flagModal: null,
  expandedItems: new Set(),
  userVotes: new Map(),
  statusMessage: '',
  statusTimer: null,
  search: null
};

// Debounce timer for search API calls
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// ── Pure helpers (exported for tests) ────────────────────────────────────────

export function isCollapsed(id: string, flagCount: number, expandedItems: Set<string>): boolean {
  return flagCount >= 3 && !expandedItems.has(id);
}

export function renderCollapsed(flagCount: number): string {
  return `[flagged: ${flagCount} · press X to expand]`;
}

export function voteGlyph(
  yourVote: -1 | 0 | 1 | undefined,
  score: number,
  style: { accent(s: string): string; dim(s: string): string }
): string {
  if (yourVote === 1) return style.accent('▲') + style.accent(String(score));
  if (yourVote === -1) return style.accent('▼') + style.accent(String(score));
  return style.dim('↑') + String(score);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

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
        if (!token) token = auth.accessToken || '';
      }
    } catch {
      /* ignore */
    }
  }
  return { useApi: Boolean(apiUrl), apiUrl, token, fetcher: ctx.io.fetcher, timeoutMs: 10000 };
}

function setStatus(msg: string): void {
  if (state.statusTimer) clearTimeout(state.statusTimer);
  state.statusMessage = msg;
  state.statusTimer = setTimeout(() => {
    state.statusMessage = '';
    state.statusTimer = null;
  }, 3000);
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadBoards(ctx: PageContext): Promise<void> {
  try {
    const opts = buildSourceOptions(ctx);
    const result = await communityBoardsSource(opts);
    cachedBoards = result.data.boards;
  } catch {
    /* keep empty */
  }
  boardsLoading = false;
  ctx.repaint();
}

async function loadThreads(boardId: string, ctx: PageContext): Promise<void> {
  const opts = buildSourceOptions(ctx);
  const result = await communityThreadsSource(opts, boardId as BoardId, state.threadSort);
  cachedThreads = result.data.threads;
}

// ── Composer state-machine ─────────────────────────────────────────────────

function composerInsertChar(ch: string): void {
  if (!state.composer) return;
  const c = state.composer;
  const line = c.lines[c.cursorLine] ?? '';
  c.lines[c.cursorLine] = line.slice(0, c.cursorCol) + ch + line.slice(c.cursorCol);
  c.cursorCol++;
}

function composerBackspace(): void {
  if (!state.composer) return;
  const c = state.composer;
  const line = c.lines[c.cursorLine] ?? '';
  if (c.cursorCol > 0) {
    c.lines[c.cursorLine] = line.slice(0, c.cursorCol - 1) + line.slice(c.cursorCol);
    c.cursorCol--;
  } else if (c.cursorLine > 0) {
    const prev = c.lines[c.cursorLine - 1] ?? '';
    c.lines.splice(c.cursorLine, 1);
    c.cursorLine--;
    c.cursorCol = prev.length;
    c.lines[c.cursorLine] = prev + line;
  }
}

function composerNewline(): void {
  if (!state.composer) return;
  const c = state.composer;
  const line = c.lines[c.cursorLine] ?? '';
  const rest = line.slice(c.cursorCol);
  c.lines[c.cursorLine] = line.slice(0, c.cursorCol);
  c.lines.splice(c.cursorLine + 1, 0, rest);
  c.cursorLine++;
  c.cursorCol = 0;
}

function openComposer(mode: 'reply' | 'new-thread', replyTo?: string): void {
  state.composer = {
    active: true,
    mode,
    lines: [''],
    cursorLine: 0,
    cursorCol: 0,
    title: mode === 'new-thread' ? '' : undefined,
    board: mode === 'new-thread' ? ((state.board as BoardId) ?? 'meta') : undefined,
    replyTo,
    status: 'editing'
  };
}

function closeComposer(): void {
  state.composer = null;
}

async function sendComposer(ctx: PageContext): Promise<void> {
  if (!state.composer) return;
  const c = state.composer;
  const content = c.lines.join('\n').trim();
  if (!content) return;

  c.status = 'sending';

  const opts = buildSourceOptions(ctx);

  try {
    if (c.mode === 'reply' && c.replyTo) {
      await createReplySource(opts, c.replyTo, { content });
      // Refresh thread
      const tid = state.thread ?? '';
      if (tid) {
        const result = await communityThreadSource(opts, tid);
        cachedReplies = result.data.replies;
      }
      closeComposer();
      setStatus('Reply posted.');
    } else if (c.mode === 'new-thread') {
      const title = (c.title ?? '').trim();
      if (!title) {
        c.status = 'error';
        c.errorMessage = 'Title is required.';
        return;
      }
      const board = c.board ?? 'meta';
      await createThreadSource(opts, { board, title, content });
      // Refresh threads
      const result = await communityThreadsSource(opts, board);
      cachedThreads = result.data.threads;
      state.view = 'threads';
      closeComposer();
      setStatus('Thread created.');
    }
  } catch (err) {
    c.status = 'error';
    c.errorMessage = err instanceof Error ? err.message : 'Unknown error';
  }
}

// ── Voting ────────────────────────────────────────────────────────────────────

async function doVote(
  targetId: string,
  targetType: 'discussion' | 'reply',
  dir: 1 | -1,
  ctx: PageContext
): Promise<void> {
  const current = state.userVotes.get(targetId) ?? 0;
  const newVal: -1 | 0 | 1 = current === dir ? 0 : dir;

  // Optimistic update
  state.userVotes.set(targetId, newVal);
  const delta = newVal - current;
  if (targetType === 'discussion') {
    const t = cachedThreads.find((x) => x.id === targetId);
    if (t) t.score += delta;
  } else {
    const flat = flattenReplies(cachedReplies);
    const rn = flat.find((f) => f.reply.id === targetId);
    if (rn) rn.reply.score += delta;
  }

  try {
    const opts = buildSourceOptions(ctx);
    const result = await voteSource(opts, targetId, { value: newVal, targetType });
    // Reconcile with actual score
    if (targetType === 'discussion') {
      const t = cachedThreads.find((x) => x.id === targetId);
      if (t) t.score = result.data.score;
    } else {
      const flat = flattenReplies(cachedReplies);
      const rn = flat.find((f) => f.reply.id === targetId);
      if (rn) rn.reply.score = result.data.score;
    }
    state.userVotes.set(targetId, result.data.userVote);
  } catch {
    setStatus('Vote failed.');
    // Revert optimistic
    state.userVotes.set(targetId, current as -1 | 0 | 1);
    if (targetType === 'discussion') {
      const t = cachedThreads.find((x) => x.id === targetId);
      if (t) t.score -= delta;
    } else {
      const flat = flattenReplies(cachedReplies);
      const rn = flat.find((f) => f.reply.id === targetId);
      if (rn) rn.reply.score -= delta;
    }
  }
}

// ── Flagging ──────────────────────────────────────────────────────────────────

async function submitFlag(
  reason: 'spam' | 'harassment' | 'undisclosed-llm' | 'malicious' | 'other',
  ctx: PageContext
): Promise<void> {
  if (!state.flagModal) return;
  const { targetId, targetType, notes } = state.flagModal;
  const opts = buildSourceOptions(ctx);
  try {
    await flagSource(opts, targetId, { reason, notes: notes || undefined, targetType });
    setStatus('Flagged.');
  } catch {
    setStatus('Flag failed.');
  }
  state.flagModal = null;
}

// ── Search ────────────────────────────────────────────────────────────────────

function openSearch(scope: 'all' | BoardId): void {
  state.search = {
    active: true,
    query: '',
    cursorCol: 0,
    results: null,
    loading: false,
    selectedIndex: 0,
    scope
  };
}

function closeSearch(): void {
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
  state.search = null;
}

function scheduleSearch(ctx: PageContext): void {
  if (!state.search) return;
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  const q = state.search.query;
  if (q.length < 2) {
    state.search.results = null;
    state.search.loading = false;
    return;
  }
  state.search.loading = true;
  // Debounce: fire the API call only when the user pauses typing for 400ms
  searchDebounceTimer = setTimeout(async () => {
    searchDebounceTimer = null;
    if (!state.search || state.search.query !== q) return;
    try {
      const opts = buildSourceOptions(ctx);
      const board = state.search.scope === 'all' ? undefined : (state.search.scope as BoardId);
      const result = await communitySearchSource(opts, q, board);
      if (state.search && state.search.query === q) {
        state.search.results = result.data;
        state.search.loading = false;
        state.search.selectedIndex = 0;
      }
    } catch {
      if (state.search) state.search.loading = false;
    }
  }, 400);
}

function searchFlatList(results: SearchResult): SearchHit[] {
  return [...results.results.threads, ...results.results.replies];
}

function renderSearchView(ctx: PageContext, width: number, height: number): string {
  const { style } = ctx;
  const s = state.search;
  if (!s) return frame([], width, height);
  const lines: string[] = [];
  const rule = ' ' + style.dim('─'.repeat(Math.max(0, width - 2)));

  // Header
  const scopeLabel = 'scope: ' + s.scope;
  const headerLeft = style.bold('─ SEARCH ─');
  const headerRight = style.dim(scopeLabel);
  const gap = Math.max(2, width - vlen(' ' + headerLeft) - vlen(headerRight) - 2);
  lines.push(' ' + headerLeft + ' '.repeat(gap) + headerRight);

  // Query input line
  const cursor = style.dim('▏');
  const queryBefore = s.query.slice(0, s.cursorCol);
  const queryAfter = s.query.slice(s.cursorCol);
  lines.push(' ' + style.accent('> ') + queryBefore + cursor + queryAfter);
  lines.push(rule);

  if (!s.results && !s.loading) {
    lines.push(' ' + style.dim('type to search (min 2 chars) · Tab to change scope'));
  } else if (s.loading) {
    lines.push(' ' + style.dim('(loading…)'));
  } else if (s.results) {
    const flat = searchFlatList(s.results);
    if (flat.length === 0) {
      lines.push(' ' + style.dim('(no results)'));
    } else {
      if (s.results.truncated) {
        lines.push(' ' + style.dim('(truncated — refine query)'));
      }
      const threads = s.results.results.threads;
      const replies = s.results.results.replies;

      if (threads.length > 0) {
        lines.push(' ' + style.bold('THREADS (' + threads.length + ')'));
        threads.forEach((hit, i) => {
          const absIdx = i;
          const sel = absIdx === s.selectedIndex;
          const lead = sel ? style.accent('> ') : '  ';
          lines.push(
            lead + style.dim('/' + hit.board + ' · ') + (sel ? style.bold(hit.title) : hit.title)
          );
          lines.push('  ' + style.dim('  ') + renderSnippet(hit.snippet, style));
        });
      }

      if (replies.length > 0) {
        lines.push(' ' + style.bold('REPLIES (' + replies.length + ')'));
        replies.forEach((hit, i) => {
          const absIdx = threads.length + i;
          const sel = absIdx === s.selectedIndex;
          const lead = sel ? style.accent('> ') : '  ';
          lines.push(lead + style.dim('/' + hit.board + ' · in "' + hit.title + '"'));
          lines.push('  ' + style.dim('  ') + renderSnippet(hit.snippet, style));
        });
      }
    }
  }

  return frame(lines, width, height);
}

function renderSnippet(
  snippet: string,
  style: { accent(s: string): string; dim(s: string): string }
): string {
  // Highlight [matched] text with accent style; keep surrounding text dim
  return snippet.replace(/\[([^\]]*)\]/g, (_match, inner) => style.accent(inner));
}

// ── Render ────────────────────────────────────────────────────────────────────

export const communityPage: Page = {
  id: 'community',
  title: 'COMMUNITY',
  navLabel: 'Comm',
  navIcon: 'C',
  hotkeys: [
    { key: 'j/k', label: 'nav' },
    { key: 'g/G', label: 'top/end' },
    { key: 'Enter', label: 'open' },
    { key: 'n', label: 'new' },
    { key: 'o', label: 'sort' },
    { key: '/', label: 'search' },
    { key: 'r', label: 'reply' },
    { key: '+/-', label: 'vote' },
    { key: 'f', label: 'flag' },
    { key: 'X', label: 'expand' },
    { key: 'Esc', label: 'back' }
  ],
  mount(_ctx: PageContext): void {
    boardsLoading = true;
    loadBoards(_ctx);
  },
  unmount(): void {
    if (state.statusTimer) {
      clearTimeout(state.statusTimer);
      state.statusTimer = null;
    }
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }
    state.search = null;
    state.composer = null;
    state.flagModal = null;
    state.filtering = false;
    state.filter = '';
    state.view = 'boards';
    state.expandedItems.clear();
    state.userVotes.clear();
  },
  render(ctx: PageContext): string {
    const { style, width, height } = ctx;
    const lines: string[] = [];
    const rule = ' ' + style.dim('─'.repeat(Math.max(0, width - 2)));

    // Search overlay takes priority over all other views
    if (state.search?.active) {
      return renderSearchView(ctx, width, height);
    }

    if (boardsLoading) {
      lines.push(' ' + style.dim('Loading community…'));
      return frame(lines, width, height);
    }

    if (state.view === 'boards') {
      const newTotal = cachedBoards.reduce((s, b) => s + b.newToday, 0);
      lines.push(
        ' ' +
          style.bold(style.accent('COMMUNITY')) +
          style.dim('  ' + cachedBoards.length + ' boards · ' + newTotal + ' new today')
      );
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
          const stats = style.dim(
            b.threadCount.toString().padStart(4) +
              ' th  ' +
              b.newToday.toString().padStart(2) +
              ' new'
          );
          const gap = Math.max(2, width - vlen(' ' + lead + displayName) - vlen(stats) - 1);
          lines.push(' ' + lead + name + ' '.repeat(gap) + stats);
          const label = BOARD_LABELS[b.id];
          if (label) lines.push('     ' + style.dim(label));
        });
      }
    } else if (state.view === 'threads') {
      const board = state.board ?? cachedBoards[state.boardCur]?.id ?? 'mcp';
      const list = cachedThreads.filter(
        (t) => !state.filter || t.title.toLowerCase().includes(state.filter.toLowerCase())
      );
      lines.push(
        ' ' +
          style.bold(style.accent('/' + board)) +
          style.dim('  ' + list.length + ' threads') +
          '   ' +
          style.dim('sort: ') +
          style.accent(state.threadSort)
      );
      lines.push(rule);
      if (list.length === 0) {
        lines.push(' ' + style.dim('Empty board. ') + style.accent('n') + style.dim(' to start.'));
      } else {
        list.forEach((t, i) => {
          const sel = i === state.threadCur;
          const lead = sel ? rail(style) : noRail();
          const age = fmtAge(hoursAgo(t.createdAt));

          if (isCollapsed(t.id, t.flagCount, state.expandedItems)) {
            const collapsed = renderCollapsed(t.flagCount);
            const title = sel ? style.bold(collapsed) : style.dim(collapsed);
            lines.push(' ' + lead + title);
            lines.push(rule);
            return;
          }

          const title = sel ? style.bold(t.title) : t.title;
          let authorMeta = t.author;
          if (t.authorIsLLM) authorMeta += style.dim(' [bot · ' + (t.authorModel ?? 'llm') + ']');
          const meta = style.dim(authorMeta + ' · ' + age);
          const myVote = state.userVotes.get(t.id) ?? 0;
          const voteStr = voteGlyph(myVote as -1 | 0 | 1, t.score, style);
          const counts =
            voteStr +
            style.dim('  ') +
            style.accent(t.replyCount.toString().padStart(2)) +
            style.dim(' replies');
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
        let authorMeta = t.author;
        if (t.authorIsLLM) authorMeta += style.dim(' [bot · ' + (t.authorModel ?? 'llm') + ']');
        const myVoteThread = state.userVotes.get(t.id) ?? 0;
        const threadVoteStr = voteGlyph(myVoteThread as -1 | 0 | 1, t.score, style);
        lines.push(' ' + style.bold(t.title) + '  ' + threadVoteStr);
        lines.push(' ' + style.dim(authorMeta + ' · ' + age + ' · ' + t.replyCount + ' replies'));
        lines.push(' ' + sep('body', width - 2, style));
        lines.push(' ' + t.content);
        lines.push(' ' + sep('replies', width - 2, style));
        const flatReplies = flattenReplies(cachedReplies);
        flatReplies.forEach((rn, i) => {
          const sel = i === state.replyCur;
          const lead = sel ? rail(style) : noRail();
          const indent = '│ '.repeat(rn.depth);
          const ra = fmtAge(hoursAgo(rn.reply.createdAt));

          if (isCollapsed(rn.reply.id, rn.reply.flagCount, state.expandedItems)) {
            lines.push(' ' + indent + lead + style.dim(renderCollapsed(rn.reply.flagCount)));
            lines.push(rule);
            return;
          }

          let replyAuthor = rn.reply.author;
          if (rn.reply.authorIsLLM)
            replyAuthor += style.dim(' [bot · ' + (rn.reply.authorModel ?? 'llm') + ']');
          const myVoteReply = state.userVotes.get(rn.reply.id) ?? 0;
          const replyVoteStr = voteGlyph(myVoteReply as -1 | 0 | 1, rn.reply.score, style);
          lines.push(
            ' ' +
              indent +
              lead +
              style.dim(replyAuthor + ' · ' + ra) +
              '  ' +
              replyVoteStr
          );
          lines.push('     ' + indent + rn.reply.content);
          lines.push(rule);
        });
      }
    }

    // Status message
    if (state.statusMessage) {
      lines.push(' ' + style.dim(state.statusMessage));
    }

    if (state.filtering) {
      lines.push(' ' + style.accent('/') + ' ' + state.filter + style.dim('▏'));
    }

    // Flag modal overlay (last — overwrites bottom lines in frame)
    if (state.flagModal?.active) {
      const fm = state.flagModal;
      const rendered = frame(lines, width, height).split('\n');
      const modalLines = [
        ' ' + style.bold('Flag reason:'),
        '   ' + style.accent('1') + style.dim('. spam'),
        '   ' + style.accent('2') + style.dim('. harassment'),
        '   ' + style.accent('3') + style.dim('. undisclosed-llm'),
        '   ' + style.accent('4') + style.dim('. malicious'),
        '   ' + style.accent('5') + style.dim('. other'),
        ' ' + style.dim('Esc to cancel')
      ];
      if (fm.awaitingNotes) {
        modalLines.push(' Notes: ' + fm.notes + style.dim('▏'));
      }
      const startLine = Math.max(0, height - modalLines.length - 1);
      rendered[startLine] = ' ' + style.dim('─'.repeat(Math.max(0, width - 2)));
      for (let i = 0; i < modalLines.length; i++) {
        if (startLine + 1 + i < height) {
          rendered[startLine + 1 + i] = modalLines[i]!.padEnd(width).slice(0, width);
        }
      }
      return rendered.join('\n');
    }

    // Composer overlay
    if (state.composer?.active) {
      const comp = state.composer;
      const rendered = frame(lines, width, height).split('\n');
      const label =
        comp.mode === 'reply'
          ? '[REPLY to ' + (comp.replyTo ?? '') + ']'
          : '[NEW THREAD in /' + (comp.board ?? 'meta') + ']';
      const compLines: string[] = [];
      compLines.push(' ' + style.dim('─'.repeat(Math.max(0, width - 2))));
      compLines.push(' ' + style.accent(label) + style.dim('  ' + comp.lines.length + ' lines'));
      if (comp.mode === 'new-thread') {
        compLines.push(
          ' Title: ' + (comp.title ?? '') + (comp.status === 'editing' ? style.dim('▏') : '')
        );
      }
      const visibleContentLines = Math.max(3, height - rendered.length + compLines.length - 2);
      const contentStart = Math.max(0, comp.cursorLine - visibleContentLines + 1);
      for (
        let i = contentStart;
        i < Math.min(comp.lines.length, contentStart + visibleContentLines);
        i++
      ) {
        const lineText = comp.lines[i] ?? '';
        if (i === comp.cursorLine) {
          compLines.push(
            ' ' +
              lineText.slice(0, comp.cursorCol) +
              style.dim('▏') +
              lineText.slice(comp.cursorCol)
          );
        } else {
          compLines.push(' ' + lineText);
        }
      }
      if (comp.status === 'sending') {
        compLines.push(' ' + style.dim('Sending…'));
      } else if (comp.status === 'error') {
        compLines.push(' ' + style.dim('Error: ' + (comp.errorMessage ?? 'unknown')));
      } else {
        compLines.push(' ' + style.dim('Ctrl+S send · Esc cancel'));
      }

      const startLine = Math.max(0, height - compLines.length);
      for (let i = 0; i < compLines.length; i++) {
        if (startLine + i < height) {
          rendered[startLine + i] = (compLines[i] ?? '').padEnd(width).slice(0, width);
        }
      }
      return rendered.join('\n');
    }

    return frame(lines, width, height);
  },
  async handleKey(event, ctx): Promise<PageAction> {
    // ── Search ──────────────────────────────────────────────────────────────
    if (state.search?.active) {
      const s = state.search;
      const flat = s.results ? searchFlatList(s.results) : [];

      if (event.key === 'esc') {
        closeSearch();
        return { kind: 'none' };
      }
      if (event.key === 'enter') {
        const hit = flat[s.selectedIndex];
        if (hit) {
          closeSearch();
          // Fetch thread if not in cache
          const opts = buildSourceOptions(ctx);
          let thread = cachedThreads.find((t) => t.id === hit.threadId);
          if (!thread) {
            const result = await communityThreadSource(opts, hit.threadId);
            if (result.data.thread) {
              cachedThreads = [...cachedThreads, result.data.thread];
              cachedReplies = result.data.replies;
              thread = result.data.thread;
            }
          } else {
            const result = await communityThreadSource(opts, hit.threadId);
            cachedReplies = result.data.replies;
          }
          if (thread) {
            state.board = thread.board;
            state.thread = hit.threadId;
            state.view = 'reader';
            const flatR = flattenReplies(cachedReplies);
            if (hit.kind === 'reply') {
              const idx = flatR.findIndex((r) => r.reply.id === hit.id);
              state.replyCur = idx >= 0 ? idx : 0;
            } else {
              state.replyCur = 0;
            }
          }
        }
        return { kind: 'none' };
      }
      if (event.key === 'j' || event.key === 'down') {
        s.selectedIndex = Math.min(flat.length - 1, s.selectedIndex + 1);
        return { kind: 'none' };
      }
      if (event.key === 'k' || event.key === 'up') {
        s.selectedIndex = Math.max(0, s.selectedIndex - 1);
        return { kind: 'none' };
      }
      if (event.key === 'tab') {
        // Cycle scope: 'all' ↔ current board
        const currentBoard = (state.board as BoardId) ?? undefined;
        if (s.scope === 'all' && currentBoard) {
          s.scope = currentBoard;
        } else {
          s.scope = 'all';
        }
        scheduleSearch(ctx);
        return { kind: 'none' };
      }
      if (event.key === 'backspace') {
        if (s.cursorCol > 0) {
          s.query = s.query.slice(0, s.cursorCol - 1) + s.query.slice(s.cursorCol);
          s.cursorCol--;
          scheduleSearch(ctx);
        }
        return { kind: 'none' };
      }
      if (event.key.length === 1 && !event.ctrl && !event.meta) {
        s.query = s.query.slice(0, s.cursorCol) + event.key + s.query.slice(s.cursorCol);
        s.cursorCol++;
        scheduleSearch(ctx);
        return { kind: 'none' };
      }
      if (event.key === 'space') {
        s.query = s.query.slice(0, s.cursorCol) + ' ' + s.query.slice(s.cursorCol);
        s.cursorCol++;
        scheduleSearch(ctx);
        return { kind: 'none' };
      }
      return { kind: 'none' };
    }

    // ── Flag modal ──────────────────────────────────────────────────────────
    if (state.flagModal?.active) {
      const fm = state.flagModal;
      if (fm.awaitingNotes) {
        if (event.key === 'esc') {
          state.flagModal = null;
          return { kind: 'none' };
        }
        if (event.key === 'enter') {
          await submitFlag('other', ctx);
          return { kind: 'none' };
        }
        if (event.key === 'backspace') {
          fm.notes = fm.notes.slice(0, -1);
          return { kind: 'none' };
        }
        if (event.key.length === 1 && !event.ctrl) {
          fm.notes += event.key;
          return { kind: 'none' };
        }
        return { kind: 'none' };
      }
      if (event.key === 'esc') {
        state.flagModal = null;
        return { kind: 'none' };
      }
      const reasonMap: Record<
        string,
        'spam' | 'harassment' | 'undisclosed-llm' | 'malicious' | 'other'
      > = {
        '1': 'spam',
        '2': 'harassment',
        '3': 'undisclosed-llm',
        '4': 'malicious',
        '5': 'other'
      };
      const reason = reasonMap[event.key];
      if (reason) {
        if (reason === 'other') {
          fm.awaitingNotes = true;
          return { kind: 'none' };
        }
        await submitFlag(reason, ctx);
        return { kind: 'none' };
      }
      return { kind: 'none' };
    }

    // ── Composer ────────────────────────────────────────────────────────────
    if (state.composer?.active) {
      const comp = state.composer;
      if (comp.status === 'sending') return { kind: 'none' };

      if (event.ctrl && event.key === 's') {
        await sendComposer(ctx);
        return { kind: 'none' };
      }
      if (event.key === 'esc') {
        const hasContent = comp.lines.some((l) => l.length > 0);
        if (hasContent) {
          // confirm discard — just close for now
        }
        closeComposer();
        return { kind: 'none' };
      }
      if (event.key === 'enter') {
        // If new-thread and title not yet set, move to content
        if (comp.mode === 'new-thread' && comp.title === '') {
          comp.title = comp.lines.join('').trim();
          comp.lines = [''];
          comp.cursorLine = 0;
          comp.cursorCol = 0;
          return { kind: 'none' };
        }
        composerNewline();
        return { kind: 'none' };
      }
      if (event.key === 'backspace') {
        if (
          comp.mode === 'new-thread' &&
          typeof comp.title === 'string' &&
          comp.title.length === 0 &&
          comp.lines.join('') === ''
        ) {
          // editing title still
        }
        composerBackspace();
        return { kind: 'none' };
      }
      if (event.key === 'up' && comp.cursorLine > 0) {
        comp.cursorLine--;
        comp.cursorCol = Math.min(comp.cursorCol, (comp.lines[comp.cursorLine] ?? '').length);
        return { kind: 'none' };
      }
      if (event.key === 'down' && comp.cursorLine < comp.lines.length - 1) {
        comp.cursorLine++;
        comp.cursorCol = Math.min(comp.cursorCol, (comp.lines[comp.cursorLine] ?? '').length);
        return { kind: 'none' };
      }
      if (event.key === 'left' && comp.cursorCol > 0) {
        comp.cursorCol--;
        return { kind: 'none' };
      }
      if (event.key === 'right') {
        const lineLen = (comp.lines[comp.cursorLine] ?? '').length;
        if (comp.cursorCol < lineLen) comp.cursorCol++;
        return { kind: 'none' };
      }
      if (event.key.length === 1 && !event.ctrl && !event.meta) {
        // If new-thread mode and title not set yet, type into title field
        if (comp.mode === 'new-thread' && typeof comp.title === 'string' && !comp.title) {
          // title is filled by user hitting enter — for now just accumulate in lines
        }
        composerInsertChar(event.key);
        return { kind: 'none' };
      }
      if (event.key === 'space') {
        composerInsertChar(' ');
        return { kind: 'none' };
      }
      return { kind: 'none' };
    }

    // ── Filter mode ─────────────────────────────────────────────────────────
    if (state.filtering) {
      if (event.key === 'esc') {
        state.filtering = false;
        state.filter = '';
        return { kind: 'none' };
      }
      if (event.key === 'enter') {
        state.filtering = false;
        return { kind: 'none' };
      }
      if (event.key === 'backspace') {
        state.filter = state.filter.slice(0, -1);
        return { kind: 'none' };
      }
      if (event.key.length === 1 && !event.ctrl) {
        state.filter += event.key;
        return { kind: 'none' };
      }
      return { kind: 'none' };
    }

    // ── g/G global jumps ────────────────────────────────────────────────────
    if (event.key === 'g') {
      if (state.view === 'boards') state.boardCur = 0;
      else if (state.view === 'threads') state.threadCur = 0;
      else state.replyCur = 0;
      return { kind: 'none' };
    }
    if (event.key === 'G') {
      if (state.view === 'boards') {
        state.boardCur = Math.max(0, cachedBoards.length - 1);
      } else if (state.view === 'threads') {
        const list = cachedThreads.filter(
          (t) => !state.filter || t.title.toLowerCase().includes(state.filter.toLowerCase())
        );
        state.threadCur = Math.max(0, list.length - 1);
      } else {
        const flatReplies = flattenReplies(cachedReplies);
        state.replyCur = Math.max(0, flatReplies.length - 1);
      }
      return { kind: 'none' };
    }

    // ── Board view ──────────────────────────────────────────────────────────
    if (state.view === 'boards') {
      switch (event.key) {
        case 'j':
        case 'down':
          state.boardCur = Math.min(cachedBoards.length - 1, state.boardCur + 1);
          return { kind: 'none' };
        case 'k':
        case 'up':
          state.boardCur = Math.max(0, state.boardCur - 1);
          return { kind: 'none' };
        case 'enter': {
          const boardId = cachedBoards[state.boardCur]?.id;
          if (boardId) {
            const opts = buildSourceOptions(ctx);
            const result = await communityThreadsSource(opts, boardId as BoardId);
            cachedThreads = result.data.threads;
            cachedReplies = [];
            state.board = boardId;
            state.view = 'threads';
            state.threadCur = 0;
          }
          return { kind: 'none' };
        }
        case 'n': {
          const boardId = (cachedBoards[state.boardCur]?.id ?? 'meta') as BoardId;
          openComposer('new-thread');
          if (state.composer) state.composer.board = boardId;
          return { kind: 'none' };
        }
        case '/':
          openSearch('all');
          return { kind: 'none' };
        default:
          return { kind: 'none' };
      }
    }

    // ── Thread list view ────────────────────────────────────────────────────
    if (state.view === 'threads') {
      const list = cachedThreads.filter(
        (t) => !state.filter || t.title.toLowerCase().includes(state.filter.toLowerCase())
      );
      switch (event.key) {
        case 'j':
        case 'down':
          state.threadCur = Math.min(list.length - 1, state.threadCur + 1);
          return { kind: 'none' };
        case 'k':
        case 'up':
          state.threadCur = Math.max(0, state.threadCur - 1);
          return { kind: 'none' };
        case 'o': {
          const sortOrder: ThreadSort[] = ['top', 'new', 'active'];
          state.threadSort =
            sortOrder[(sortOrder.indexOf(state.threadSort) + 1) % sortOrder.length] ?? 'top';
          const board = state.board ?? cachedBoards[state.boardCur]?.id;
          if (board) {
            loadThreads(board, ctx).then(() => ctx.repaint()).catch(() => {});
          }
          return { kind: 'none' };
        }
        case 'enter': {
          const t = list[state.threadCur];
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
        case 'X': {
          const t = list[state.threadCur];
          if (t) {
            if (state.expandedItems.has(t.id)) state.expandedItems.delete(t.id);
            else state.expandedItems.add(t.id);
          }
          return { kind: 'none' };
        }
        case '+':
        case '=': {
          const t = list[state.threadCur];
          if (t) await doVote(t.id, 'discussion', 1, ctx);
          return { kind: 'none' };
        }
        case '-': {
          const t = list[state.threadCur];
          if (t) await doVote(t.id, 'discussion', -1, ctx);
          return { kind: 'none' };
        }
        case 'f': {
          const t = list[state.threadCur];
          if (t) {
            state.flagModal = {
              active: true,
              targetId: t.id,
              targetType: 'discussion',
              awaitingNotes: false,
              notes: ''
            };
          }
          return { kind: 'none' };
        }
        case 'esc':
          state.view = 'boards';
          return { kind: 'none' };
        case 'n': {
          const boardId = (state.board ?? 'meta') as BoardId;
          openComposer('new-thread');
          if (state.composer) state.composer.board = boardId;
          return { kind: 'none' };
        }
        case '/': {
          const scope = (state.board as BoardId) ?? 'all';
          openSearch(scope);
          return { kind: 'none' };
        }
        default:
          return { kind: 'none' };
      }
    }

    // ── Reader view ─────────────────────────────────────────────────────────
    const flatReplies = flattenReplies(cachedReplies);
    switch (event.key) {
      case 'j':
      case 'down':
        state.replyCur = Math.min(flatReplies.length - 1, state.replyCur + 1);
        return { kind: 'none' };
      case 'k':
      case 'up':
        state.replyCur = Math.max(0, state.replyCur - 1);
        return { kind: 'none' };
      case 'esc':
        state.view = 'threads';
        return { kind: 'none' };
      case '/': {
        const scope = (state.board as BoardId) ?? 'all';
        openSearch(scope);
        return { kind: 'none' };
      }
      case 'r': {
        const threadId = state.thread ?? '';
        if (state.replyCur >= 0 && flatReplies.length > 0) {
          const focused = flatReplies[state.replyCur];
          openComposer('reply', focused?.reply.id ?? threadId);
        } else {
          openComposer('reply', threadId);
        }
        return { kind: 'none' };
      }
      case '+':
      case '=': {
        if (flatReplies.length > 0) {
          const focused = flatReplies[state.replyCur];
          if (focused) await doVote(focused.reply.id, 'reply', 1, ctx);
        } else {
          const t = cachedThreads.find((x) => x.id === state.thread);
          if (t) await doVote(t.id, 'discussion', 1, ctx);
        }
        return { kind: 'none' };
      }
      case '-': {
        if (flatReplies.length > 0) {
          const focused = flatReplies[state.replyCur];
          if (focused) await doVote(focused.reply.id, 'reply', -1, ctx);
        } else {
          const t = cachedThreads.find((x) => x.id === state.thread);
          if (t) await doVote(t.id, 'discussion', -1, ctx);
        }
        return { kind: 'none' };
      }
      case 'f': {
        const focused = flatReplies[state.replyCur];
        if (focused) {
          state.flagModal = {
            active: true,
            targetId: focused.reply.id,
            targetType: 'reply',
            awaitingNotes: false,
            notes: ''
          };
        } else {
          const t = cachedThreads.find((x) => x.id === state.thread);
          if (t) {
            state.flagModal = {
              active: true,
              targetId: t.id,
              targetType: 'discussion',
              awaitingNotes: false,
              notes: ''
            };
          }
        }
        return { kind: 'none' };
      }
      case 'X': {
        const focused = flatReplies[state.replyCur];
        if (focused) {
          const id = focused.reply.id;
          if (state.expandedItems.has(id)) state.expandedItems.delete(id);
          else state.expandedItems.add(id);
        }
        return { kind: 'none' };
      }
      default:
        return { kind: 'none' };
    }
  }
};
