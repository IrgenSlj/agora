import type { AgoraState } from '../state.js';
import { setAuthState, getAuthState, clearAuthState, writeAgoraState } from '../state.js';
import type { FetchLike } from '../live.js';

export interface EnsureFreshOpts {
  dataDir: string;
  fetcher?: FetchLike;
  /** Seconds of slack before access exp at which to refresh. Default 60. */
  slack?: number;
}

/**
 * Returns auth with a fresh access token, refreshing if needed.
 * Persists the rotated pair back to state.json on success.
 * Returns the original auth (untouched) if:
 *   - no refresh token available, OR
 *   - refresh request fails (let the API call fail with 401 downstream)
 */
export async function ensureFreshAccess(
  state: AgoraState,
  opts: EnsureFreshOpts
): Promise<AgoraState> {
  const auth = getAuthState(state);
  if (!auth || !auth.apiUrl) return state;

  const now = Math.floor(Date.now() / 1000);
  const slack = opts.slack ?? 60;
  if (auth.accessExp > now + slack) return state; // still fresh
  if (!auth.refreshToken) return state; // can't refresh

  const fetcher = opts.fetcher ?? globalThis.fetch;
  try {
    const res = await fetcher(`${auth.apiUrl.replace(/\/+$/, '')}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: auth.refreshToken })
    });
    if (res.status === 401) {
      // Refresh revoked/expired — clear local auth so next attempt is clean
      const cleared = clearAuthState(state);
      writeAgoraState(opts.dataDir, cleared);
      return cleared;
    }
    if (!res.ok) return state; // transient; let caller retry
    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      refresh_expires_in: number;
    };
    const nowSec = Math.floor(Date.now() / 1000);
    const next = setAuthState(state, {
      accessToken: data.access_token,
      accessExp: nowSec + (data.expires_in || 0),
      refreshToken: data.refresh_token,
      refreshExp: nowSec + (data.refresh_expires_in || 0),
      apiUrl: auth.apiUrl
    });
    writeAgoraState(opts.dataDir, next);
    return next;
  } catch {
    return state; // network error; let caller fail naturally
  }
}
