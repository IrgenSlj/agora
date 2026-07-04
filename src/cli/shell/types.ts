export type TuiPageId = 'home' | 'marketplace' | 'news' | 'settings';

export type Dispatch =
  | { kind: 'noop' }
  | {
      kind: 'meta';
      sub:
        | 'help'
        | 'quit'
        | 'exit'
        | 'clear'
        | 'transcript'
        | 'menu'
        | 'terminal'
        | 'verbose'
        | 'quiet'
        | 'medium'
        | 'last'
        | 'again'
        | 'dry-run'
        | 'env'
        | 'jobs'
        | 'fg'
        | 'bg'
        | 'abc'
        | 'sessions'
        | 'recall';
      args?: string;
    }
  | { kind: 'tui'; page?: TuiPageId }
  | { kind: 'bash'; cmd: string }
  | { kind: 'chat'; msg: string };

export type LetterDispatch =
  | { kind: 'meta'; sub: string }
  | { kind: 'tui'; page?: TuiPageId }
  | { kind: 'bash'; cmd: string };
