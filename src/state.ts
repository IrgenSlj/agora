import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import type { MarketplaceItem } from './marketplace.js';
import { findMarketplaceItem } from './marketplace.js';

export interface StatePathOptions {
  explicitDir?: string;
  cwd?: string;
  home?: string;
  env?: Record<string, string | undefined>;
}

export interface SavedItem {
  id: string;
  savedAt: string;
  item?: MarketplaceItem;
}

export interface AuthState {
  token: string;
  apiUrl?: string;
  savedAt: string;
}

export interface AgoraState {
  version: 1;
  savedItems: SavedItem[];
  auth?: AuthState;
}

export interface ResolvedSavedItem {
  saved: SavedItem;
  item: MarketplaceItem | null;
}

const STATE_FILE = 'state.json';

export function detectAgoraDataDir(options: StatePathOptions = {}): string {
  const cwd = options.cwd || process.cwd();
  const home = options.home || homedir();
  const env = options.env || process.env;
  const configured = options.explicitDir || env.AGORA_HOME;

  if (configured) {
    return resolvePath(configured, cwd, home);
  }

  const xdgConfigHome = env.XDG_CONFIG_HOME
    ? resolvePath(env.XDG_CONFIG_HOME, cwd, home)
    : join(home, '.config');

  return join(xdgConfigHome, 'agora');
}

export function getAgoraStatePath(dataDir: string): string {
  return join(dataDir, STATE_FILE);
}

export function loadAgoraState(dataDir: string): AgoraState {
  const statePath = getAgoraStatePath(dataDir);

  if (!existsSync(statePath)) {
    return createEmptyState();
  }

  try {
    const parsed = JSON.parse(readFileSync(statePath, 'utf8')) as Partial<AgoraState>;
    return normalizeState(parsed);
  } catch {
    return createEmptyState();
  }
}

export function writeAgoraState(dataDir: string, state: AgoraState): void {
  mkdirSync(dataDir, { recursive: true });
  const statePath = getAgoraStatePath(dataDir);
  writeFileSync(statePath, `${JSON.stringify(normalizeState(state), null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });

  try {
    chmodSync(statePath, 0o600);
  } catch {
    // Best effort: some filesystems do not support POSIX permissions.
  }
}

export function saveItemToState(
  state: AgoraState,
  item: MarketplaceItem,
  now = new Date()
): { state: AgoraState; added: boolean } {
  if (state.savedItems.some((saved) => saved.id === item.id)) {
    return { state: normalizeState(state), added: false };
  }

  return {
    state: normalizeState({
      ...state,
      savedItems: [
        {
          id: item.id,
          savedAt: now.toISOString(),
          item
        },
        ...state.savedItems
      ]
    }),
    added: true
  };
}

export function removeItemFromState(
  state: AgoraState,
  id: string
): { state: AgoraState; removed: boolean } {
  const normalized = normalizeState(state);
  const nextItems = normalized.savedItems.filter((saved) => saved.id !== id);

  return {
    state: {
      ...normalized,
      savedItems: nextItems
    },
    removed: nextItems.length !== normalized.savedItems.length
  };
}

export function setAuthState(
  state: AgoraState,
  auth: { token: string; apiUrl?: string },
  now = new Date()
): AgoraState {
  return normalizeState({
    ...state,
    auth: {
      token: auth.token.trim(),
      apiUrl: auth.apiUrl?.trim() || undefined,
      savedAt: now.toISOString()
    }
  });
}

export function clearAuthState(state: AgoraState): AgoraState {
  const normalized = normalizeState(state);

  return {
    version: 1,
    savedItems: normalized.savedItems
  };
}

export function getAuthState(state: AgoraState): AuthState | undefined {
  return normalizeState(state).auth;
}

export function resolveSavedItems(state: AgoraState): ResolvedSavedItem[] {
  return normalizeState(state).savedItems.map((saved) => ({
    saved,
    item: saved.item || findMarketplaceItem(saved.id)
  }));
}

function createEmptyState(): AgoraState {
  return {
    version: 1,
    savedItems: []
  };
}

function normalizeState(state: Partial<AgoraState>): AgoraState {
  const seen = new Set<string>();
  const savedItems = Array.isArray(state.savedItems)
    ? state.savedItems
      .filter((saved): saved is SavedItem => {
        return Boolean(saved && typeof saved.id === 'string' && typeof saved.savedAt === 'string');
      })
      .map((saved) => ({
        id: saved.id,
        savedAt: saved.savedAt,
        item: isMarketplaceItem(saved.item) ? saved.item : undefined
      }))
      .filter((saved) => {
        if (seen.has(saved.id)) return false;
        seen.add(saved.id);
        return true;
      })
    : [];

  return {
    version: 1,
    savedItems,
    auth: normalizeAuthState(state.auth)
  };
}

function normalizeAuthState(auth: unknown): AuthState | undefined {
  if (!auth || typeof auth !== 'object') return undefined;

  const candidate = auth as Partial<AuthState>;
  const token = typeof candidate.token === 'string' ? candidate.token.trim() : '';
  if (!token) return undefined;

  const apiUrl = typeof candidate.apiUrl === 'string' && candidate.apiUrl.trim()
    ? candidate.apiUrl.trim()
    : undefined;
  const savedAt = typeof candidate.savedAt === 'string' && candidate.savedAt
    ? candidate.savedAt
    : new Date(0).toISOString();

  return {
    token,
    apiUrl,
    savedAt
  };
}

function resolvePath(filePath: string, cwd: string, home: string): string {
  const expanded = filePath === '~' || filePath.startsWith('~/')
    ? join(home, filePath.slice(2))
    : filePath;

  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

function isMarketplaceItem(value: unknown): value is MarketplaceItem {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<MarketplaceItem>;
  return Boolean(
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    (candidate.kind === 'package' || candidate.kind === 'workflow')
  );
}
