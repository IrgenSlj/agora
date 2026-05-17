import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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
  accessToken: string;
  accessExp: number; // unix seconds
  refreshToken?: string;
  refreshExp?: number; // unix seconds
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
    console.error(`Warning: ${statePath} was unreadable and has been reset`);
    return createEmptyState();
  }
}

export function writeAgoraState(dataDir: string, state: AgoraState): void {
  mkdirSync(dataDir, { recursive: true });
  const statePath = getAgoraStatePath(dataDir);
  const tmpPath = `${statePath}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(normalizeState(state), null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });

  try {
    chmodSync(tmpPath, 0o600);
  } catch {
    // Best effort: some filesystems do not support POSIX permissions.
  }

  renameSync(tmpPath, statePath);
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
  auth: {
    accessToken: string;
    accessExp: number;
    refreshToken?: string;
    refreshExp?: number;
    apiUrl?: string;
  },
  now = new Date()
): AgoraState {
  return normalizeState({
    ...state,
    auth: {
      accessToken: auth.accessToken.trim(),
      accessExp: auth.accessExp,
      refreshToken: auth.refreshToken?.trim() || undefined,
      refreshExp: auth.refreshExp,
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
          return Boolean(
            saved && typeof saved.id === 'string' && typeof saved.savedAt === 'string'
          );
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

  const candidate = auth as Record<string, unknown>;

  // Backward-compat: legacy shape has only `token`
  let accessToken: string;
  let accessExp: number;
  if (typeof candidate.accessToken === 'string' && candidate.accessToken.trim()) {
    accessToken = candidate.accessToken.trim();
    accessExp = typeof candidate.accessExp === 'number' ? candidate.accessExp : 0;
  } else if (typeof candidate.token === 'string' && candidate.token.trim()) {
    accessToken = candidate.token.trim();
    accessExp = 0;
  } else {
    return undefined;
  }

  const refreshToken =
    typeof candidate.refreshToken === 'string' && candidate.refreshToken.trim()
      ? candidate.refreshToken.trim()
      : undefined;
  const refreshExp = typeof candidate.refreshExp === 'number' ? candidate.refreshExp : undefined;
  const apiUrl =
    typeof candidate.apiUrl === 'string' && candidate.apiUrl.trim()
      ? candidate.apiUrl.trim()
      : undefined;
  const savedAt =
    typeof candidate.savedAt === 'string' && candidate.savedAt
      ? candidate.savedAt
      : new Date(0).toISOString();

  return {
    accessToken,
    accessExp,
    refreshToken,
    refreshExp,
    apiUrl,
    savedAt
  };
}

export function decodeJwtExp(token: string): number {
  try {
    const part = token.split('.')[1];
    if (!part) return 0;
    const padded = part.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    return Number(payload.exp) || 0;
  } catch {
    return 0;
  }
}

function resolvePath(filePath: string, cwd: string, home: string): string {
  const expanded =
    filePath === '~' || filePath.startsWith('~/') ? join(home, filePath.slice(2)) : filePath;

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
