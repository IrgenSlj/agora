import type { Styler } from '../ui.js';
import { createStyler, supportsTrueColor } from '../ui.js';
import type { CliIo } from './app.js';
import type {
  Page, PageId, KeyEvent, PageContext, AppState, PageAction, Hotkey,
} from './pages/types.js';
import { homePage } from './pages/home.js';
import { marketplacePage } from './pages/marketplace.js';
import { communityPage } from './pages/community.js';
import { newsPage } from './pages/news.js';
import { settingsPage } from './pages/settings.js';
import { vlen, padRight, truncate } from './pages/helpers.js';

const ALT_ON = '\x1b[?1049h';
const ALT_OFF = '\x1b[?1049l';
const CUR_HIDE = '\x1b[?25l';
const CUR_SHOW = '\x1b[?25h';
const CLEAR = '\x1b[2J\x1b[H';
const HOME_CUR = '\x1b[H';

const PAGE_ORDER: ReadonlyArray<PageId> = ['home', 'marketplace', 'community', 'news', 'settings'];

function getPage(id: PageId): Page {
  switch (id) {
    case 'home': return homePage;
    case 'marketplace': return marketplacePage;
    case 'community': return communityPage;
    case 'news': return newsPage;
    case 'settings': return settingsPage;
  }
}

function parseKey(chunk: string): KeyEvent {
  let key: string = chunk;
  let ctrl = false;
  const shift = chunk === '\x1b[Z';
  const meta = false;
  if (chunk.length === 1) {
    const c = chunk.charCodeAt(0);
    if (c === 13 || c === 10) key = 'enter';
    else if (c === 27) key = 'esc';
    else if (c === 9) key = 'tab';
    else if (c === 127 || c === 8) key = 'backspace';
    else if (c === 32) key = 'space';
    else if (c < 32) { ctrl = true; key = String.fromCharCode(c + 96); }
    else key = chunk;
  } else if (chunk === '\x1b[A') key = 'up';
  else if (chunk === '\x1b[B') key = 'down';
  else if (chunk === '\x1b[C') key = 'right';
  else if (chunk === '\x1b[D') key = 'left';
  else if (chunk === '\x1b[5~') key = 'pageup';
  else if (chunk === '\x1b[6~') key = 'pagedown';
  else if (chunk === '\x1b[H' || chunk === '\x1b[1~') key = 'home';
  else if (chunk === '\x1b[F' || chunk === '\x1b[4~') key = 'end';
  else if (chunk === '\x1b[Z') key = 'tab';
  else if (chunk === '\x1b') key = 'esc';
  return { raw: chunk, key, ctrl, shift, meta };
}

function superscript(n: number): string {
  const m: Record<string, string> = {
    '0': '\u2070', '1': '\u00b9', '2': '\u00b2', '3': '\u00b3',
    '4': '\u2074', '5': '\u2075', '6': '\u2076', '7': '\u2077',
    '8': '\u2078', '9': '\u2079',
  };
  return String(n).split('').map((c) => m[c] ?? c).join('');
}

function fmtTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function shortCwd(cwd: string, home: string | undefined): string {
  if (home && cwd.startsWith(home)) return '~' + cwd.slice(home.length);
  return cwd;
}

interface HeaderOpts {
  width: number;
  style: Styler;
  current: PageId;
  app: AppState;
  narrow: boolean;
}

function renderHeader(o: HeaderOpts): [string, string] {
  const { width, style, current, app, narrow } = o;
  const brand = ' ' + style.accent('AGORA') + ' ';
  const brandWidth = vlen(brand);

  const tabParts: string[] = [];
  for (const id of PAGE_ORDER) {
    const p = getPage(id);
    const lab = narrow ? (p.navIcon ?? p.navLabel.slice(0, 1)) : p.navLabel;
    const badgeN = id === 'news' ? app.unread.news
      : id === 'community' ? app.unread.community : 0;
    const badge = badgeN > 0 ? style.accent(superscript(badgeN)) : '';
    if (id === current) tabParts.push(style.accent('[' + lab + ']') + badge);
    else tabParts.push(style.dim(lab) + badge);
  }
  const tabs = ' ' + tabParts.join(style.dim(' \u00b7 ')) + ' ';

  const user = app.user.username || 'anon';
  const cwd = shortCwd(app.cwd, process.env.HOME);
  const time = fmtTime(new Date());
  const right = style.dim(' ' + user + ' \u00b7 ' + cwd + ' \u00b7 ' + time + ' ');

  const leftCap = '\u250c\u2500' + brand + '\u2500\u252c\u2500';
  const rightCap = '\u2500\u2510';
  const inner = width - vlen(leftCap) - vlen(rightCap);
  const gap = inner - vlen(tabs) - vlen(right);
  const middle = gap >= 0
    ? tabs + style.dim('\u2500'.repeat(gap)) + right
    : padRight(truncate(tabs, inner), inner);
  const row1 = leftCap + middle + rightCap;

  const div =
    '\u251c' +
    '\u2500'.repeat(brandWidth + 2) +
    '\u2534' +
    '\u2500'.repeat(Math.max(0, width - brandWidth - 5)) +
    '\u2524';
  return [row1, div];
}

function renderFooter(width: number, style: Styler, hotkeys: ReadonlyArray<Hotkey>, status: { msg: string; tone?: 'info' | 'warn' | 'error' } | null): [string, string] {
  const parts: string[] = [];
  parts.push(style.accent('1-5') + ' page');
  parts.push(style.accent('j/k') + ' nav');
  for (const hk of hotkeys) {
    if (hk.hidden) continue;
    parts.push(style.accent(hk.key) + ' ' + hk.label);
  }
  parts.push(style.accent('?') + ' help');
  parts.push(style.accent('q') + ' quit');
  const text = ' ' + parts.join(style.dim('  \u00b7  '));
  const hotkeyLine = padRight(truncate(text, width), width);

  let statusLine: string;
  if (status) {
    const icon = status.tone === 'error' ? style.accent('\u26a0') : style.dim('\u00b7');
    statusLine = padRight(' ' + icon + ' ' + status.msg, width);
  } else {
    statusLine = padRight('', width);
  }
  return [statusLine, hotkeyLine];
}

export interface RunOpts {
  initial?: PageId;
}

export async function runTui(io: CliIo, opts: RunOpts = {}): Promise<number> {
  const env = io.env ?? process.env;
  const cwd = io.cwd ?? process.cwd();
  const useColor = env.NO_COLOR === undefined && env.TERM !== 'dumb';
  const tc = useColor && supportsTrueColor(env);
  const style = createStyler(useColor, tc);

  const out = io.stdout;
  const stdin = process.stdin;
  const stdout = process.stdout;

  const app: AppState = {
    user: { username: env.USER || env.USERNAME || 'anon' },
    cwd,
    unread: { news: 0, community: 0 },
  };

  let current: PageId = opts.initial ?? 'home';
  let helpOpen = false;
  let status: { msg: string; tone?: 'info' | 'warn' | 'error' } | null = null;
  let statusTimer: ReturnType<typeof setTimeout> | null = null;

  function setStatus(msg: string, tone?: 'info' | 'warn' | 'error'): void {
    status = { msg, tone };
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { status = null; statusTimer = null; paint(); }, 2000);
    paint();
  }

  function size(): { w: number; h: number } {
    return { w: stdout.columns ?? 80, h: stdout.rows ?? 24 };
  }

  function ctxFor(): PageContext {
    const { w, h } = size();
    return { io, style, width: w, height: Math.max(1, h - 4), trueColor: tc, app };
  }

  function renderHelp(page: Page): string {
    const lines: string[] = [];
    lines.push('');
    lines.push('  ' + style.bold(style.accent('Help')));
    lines.push('');
    lines.push('  ' + style.dim('Global'));
    lines.push('    ' + style.accent('1-5') + '    switch page');
    lines.push('    ' + style.accent('Tab') + '    next page');
    lines.push('    ' + style.accent('?') + '      toggle this help');
    lines.push('    ' + style.accent('Ctrl-L') + ' redraw');
    lines.push('    ' + style.accent('q') + '      quit');
    lines.push('');
    lines.push('  ' + style.dim(page.title));
    for (const hk of page.hotkeys) {
      lines.push('    ' + style.accent(hk.key.padEnd(6)) + ' ' + hk.label);
    }
    lines.push('');
    lines.push('  ' + style.dim('press ? or Esc to close'));
    return lines.join('\n');
  }

  function compose(): string {
    const { w, h } = size();
    if (w < 60 || h < 20) {
      return 'agora tui needs at least 60\u00d720 (current ' + w + '\u00d7' + h + ')\n';
    }
    const narrow = w < 80;
    const [r1, r2] = renderHeader({ width: w, style, current, app, narrow });
    const page = getPage(current);
    const ctx = ctxFor();
    const body = helpOpen ? renderHelp(page) : page.render(ctx);
    const lines = body.split('\n');
    while (lines.length < ctx.height) lines.push('');
    if (lines.length > ctx.height) lines.length = ctx.height;
    const [statusLine, footerLine] = renderFooter(w, style, page.hotkeys, status);
    const rendered = [r1, r2, ...lines.map((l) => padRight(truncate(l, w), w)), statusLine, footerLine].join('\n');
    return rendered;
  }

  function paint(): void { out.write(HOME_CUR + compose()); }

  if (stdin.isTTY && stdin.setRawMode) stdin.setRawMode(true);
  stdin.resume?.();
  stdin.setEncoding?.('utf8');
  out.write(ALT_ON + CUR_HIDE + CLEAR);

  let resolveDone: (n: number) => void = () => undefined;
  const done = new Promise<number>((res) => { resolveDone = res; });

  async function applyAction(a: PageAction): Promise<void> {
    switch (a.kind) {
      case 'none': return;
      case 'quit': finish(0); return;
      case 'switch':
        if (a.to !== current) {
          await getPage(current).unmount?.(ctxFor());
          current = a.to;
          await getPage(current).mount?.(ctxFor());
          status = null;
          if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
        }
        return;
      case 'open-url': setStatus('open ' + a.url); return;
      case 'run-shell': setStatus('would run: ' + a.cmd); return;
      case 'status': setStatus(a.message, a.tone); return;
    }
  }

  const onData = async (chunk: Buffer | string): Promise<void> => {
    try {
      const txt = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const ev = parseKey(txt);

      if (ev.ctrl && ev.key === 'c') { finish(130); return; }
      if (!helpOpen && ev.key === 'q') { finish(0); return; }
      if (ev.ctrl && ev.key === 'l') { paint(); return; }
      if (ev.key === '?') { helpOpen = !helpOpen; paint(); return; }
      if (helpOpen) {
        if (ev.key === 'esc' || ev.key === '?' || ev.key === 'q') { helpOpen = false; paint(); }
        return;
      }
      if (/^[1-5]$/.test(ev.key)) {
        const next = PAGE_ORDER[Number(ev.key) - 1];
        if (next && next !== current) {
          await getPage(current).unmount?.(ctxFor());
          current = next;
          await getPage(current).mount?.(ctxFor());
          status = null;
        }
        paint(); return;
      }
      if (ev.key === 'tab') {
        const i = PAGE_ORDER.indexOf(current);
        const step = ev.shift ? -1 : 1;
        const next = PAGE_ORDER[(i + step + PAGE_ORDER.length) % PAGE_ORDER.length];
        if (next) {
          await getPage(current).unmount?.(ctxFor());
          current = next;
          await getPage(current).mount?.(ctxFor());
          status = null;
        }
        paint(); return;
      }
      const action = await Promise.resolve(getPage(current).handleKey(ev, ctxFor()));
      await applyAction(action);
      paint();
    } catch (err) {
      // Any unhandled error must still clean up the terminal.
      // Without this, stdin stays raw, alt screen stays active,
      // cursor stays hidden, and the shell's next readLine breaks.
      try {
        process.stderr.write('\n\x1b[31mTUI error:\x1b[0m ' + (err instanceof Error ? err.message : String(err)) + '\n');
      } catch { /* ignore */ }
      finish(1);
    }
  };

  const onResize = (): void => { paint(); };

  stdin.on('data', onData);
  stdout.on?.('resize', onResize);

  await getPage(current).mount?.(ctxFor());
  paint();

  function finish(code: number): void {
    try { stdin.off('data', onData); } catch { /* ignore */ }
    try { stdout.off?.('resize', onResize); } catch { /* ignore */ }
    if (stdin.isTTY && stdin.setRawMode) stdin.setRawMode(false);
    out.write(CUR_SHOW + ALT_OFF);
    stdin.pause?.();
    resolveDone(code);
  }

  return done;
}
