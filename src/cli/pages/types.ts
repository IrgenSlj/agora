import type { Styler } from '../../ui.js';
import type { CliIo } from '../app.js';

export type PageId = 'home' | 'marketplace' | 'community' | 'news' | 'settings';

export interface KeyEvent {
  raw: string;
  key:
    | 'up' | 'down' | 'left' | 'right'
    | 'enter' | 'esc' | 'tab' | 'backspace' | 'space'
    | 'pageup' | 'pagedown' | 'home' | 'end'
    | string;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
}

export interface Hotkey {
  key: string;
  label: string;
  hidden?: boolean;
}

export type PageAction =
  | { kind: 'none' }
  | { kind: 'quit' }
  | { kind: 'switch'; to: PageId }
  | { kind: 'open-url'; url: string }
  | { kind: 'run-shell'; cmd: string }
  | { kind: 'status'; message: string; tone?: 'info' | 'warn' | 'error' };

export interface AppState {
  user: { username?: string; isLLM?: boolean };
  cwd: string;
  unread: { news: number; community: number };
  lastPage?: PageId;
}

export interface PageContext {
  io: CliIo;
  style: Styler;
  width: number;
  height: number;
  trueColor: boolean;
  app: AppState;
}

export interface Page {
  id: PageId;
  title: string;
  navLabel: string;
  navIcon?: string;
  hotkeys: Hotkey[];
  mount?(ctx: PageContext): void | Promise<void>;
  unmount?(ctx: PageContext): void | Promise<void>;
  render(ctx: PageContext): string;
  handleKey(event: KeyEvent, ctx: PageContext): PageAction | Promise<PageAction>;
}
