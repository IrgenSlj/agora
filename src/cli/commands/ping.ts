import { detectAgoraDataDir, loadAgoraState, getAuthState } from '../../state.js';
import type { FetchLike } from '../../live.js';
import { writeLine, writeJson, usageError, stringFlag } from '../helpers.js';
import type { CommandHandler } from './types.js';

interface PingResult {
  apiUrl: string;
  status: number | null;
  okBoards: boolean;
  durationMs: number;
  authenticated: boolean;
  error?: string;
}

async function ping(
  apiUrl: string,
  token: string | undefined,
  fetcher: FetchLike = globalThis.fetch
): Promise<PingResult> {
  const start = Date.now();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetcher(`${apiUrl.replace(/\/$/, '')}/api/community/boards`, {
      headers,
      signal: AbortSignal.timeout(8000)
    });
    return {
      apiUrl,
      status: res.status,
      okBoards: res.ok,
      durationMs: Date.now() - start,
      authenticated: Boolean(token)
    };
  } catch (e) {
    return {
      apiUrl,
      status: null,
      okBoards: false,
      durationMs: Date.now() - start,
      authenticated: Boolean(token),
      error: e instanceof Error ? e.message : String(e)
    };
  }
}

export const commandPing: CommandHandler = async (parsed, io, style) => {
  const explicit = stringFlag(parsed, 'apiUrl') || stringFlag(parsed, 'api-url');
  const dataDir = detectAgoraDataDir({ cwd: io.cwd, env: io.env });
  const auth = getAuthState(loadAgoraState(dataDir));
  const apiUrl = explicit || io.env?.AGORA_API_URL || auth?.apiUrl;
  const token = auth?.accessToken;

  if (!apiUrl) {
    return usageError(
      io,
      'No backend configured. Pass --api-url <url>, set AGORA_API_URL, or run `agora auth login`.'
    );
  }

  const result = await ping(apiUrl, token, io.fetcher);

  if (parsed.flags.json) {
    writeJson(io.stdout, result);
    return result.okBoards ? 0 : 1;
  }

  const dur = `${result.durationMs}ms`;
  if (result.okBoards) {
    writeLine(
      io.stdout,
      `${style.accent('✓')} ${apiUrl} reachable in ${dur} (HTTP ${result.status}` +
        (result.authenticated ? ', authenticated' : ', anon' ) + ')'
    );
    return 0;
  }

  const detail =
    result.status !== null ? `HTTP ${result.status}` : result.error || 'no response';
  writeLine(io.stderr, `${style.accent('✗')} ${apiUrl} unreachable in ${dur} (${detail})`);
  return 1;
};
