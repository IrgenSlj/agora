export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_OPTS: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  signal: undefined!
};

function jitter(delay: number): number {
  return delay * (0.5 + Math.random() * 0.5);
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts?: RetryOptions
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs, signal } = { ...DEFAULT_OPTS, ...opts };
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      lastError = err;
      if (attempt < maxRetries) {
        const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
        await sleep(jitter(delay), signal);
      }
    }
  }

  throw lastError;
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface FetchWithRetryOptions extends RetryOptions {
  fetcher?: FetchLike;
}

export async function fetchWithRetry(
  url: string | URL,
  init?: RequestInit,
  opts?: FetchWithRetryOptions
): Promise<Response> {
  const fetcher = opts?.fetcher ?? globalThis.fetch;
  return withRetry(async (_attempt) => {
    const res = await fetcher(url, { ...init, signal: opts?.signal ?? init?.signal });
    if (res.status >= 500 || res.status === 429) {
      throw new Error(`HTTP ${res.status} fetching ${url}`);
    }
    return res;
  }, opts);
}
