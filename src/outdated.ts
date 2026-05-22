import type { FetchLike } from './live.js';

export type FreshnessStatus = 'fresh' | 'stale' | 'unknown';

export interface OutdatedEntry {
  pkg: string;
  latestVersion: string | null;
  modifiedAt: string | null;
  ageDays: number | null;
  status: FreshnessStatus;
  message: string;
}

export interface OutdatedResult {
  entries: OutdatedEntry[];
  summary: { fresh: number; stale: number; unknown: number };
}

export interface OutdatedOptions {
  fetcher?: FetchLike;
  now?: () => Date;
}

function tally(entries: OutdatedEntry[]): { fresh: number; stale: number; unknown: number } {
  let fresh = 0,
    stale = 0,
    unknown = 0;
  for (const e of entries) {
    if (e.status === 'fresh') fresh++;
    else if (e.status === 'stale') stale++;
    else unknown++;
  }
  return { fresh, stale, unknown };
}

async function checkPackage(pkg: string, opts: OutdatedOptions): Promise<OutdatedEntry> {
  const encoded = encodeURIComponent(pkg).replace('%40', '@').replace('%2F', '/');
  const url = `https://registry.npmjs.org/${encoded}`;
  const fetcher = opts.fetcher ?? globalThis.fetch;
  const now = opts.now ? opts.now() : new Date();

  try {
    const res = await fetcher(url, { signal: AbortSignal.timeout(8000) });

    if (res.status === 404) {
      return {
        pkg,
        latestVersion: null,
        modifiedAt: null,
        ageDays: null,
        status: 'unknown',
        message: 'not found on npm'
      };
    }

    if (res.status !== 200) {
      return {
        pkg,
        latestVersion: null,
        modifiedAt: null,
        ageDays: null,
        status: 'unknown',
        message: 'could not verify (network)'
      };
    }

    const json = (await res.json()) as {
      'dist-tags'?: { latest?: string };
      time?: { modified?: string };
    };
    const latestVersion = json['dist-tags']?.latest ?? null;
    const modifiedAt = json.time?.modified ?? null;

    if (!modifiedAt) {
      return {
        pkg,
        latestVersion,
        modifiedAt: null,
        ageDays: null,
        status: 'unknown',
        message: `latest ${latestVersion ?? 'unknown'} · publish date unknown`
      };
    }

    const ageDays = Math.floor((now.getTime() - new Date(modifiedAt).getTime()) / 86_400_000);
    const status: FreshnessStatus = ageDays <= 365 ? 'fresh' : 'stale';
    const message = `latest ${latestVersion ?? 'unknown'} · published ${ageDays}d ago`;

    return { pkg, latestVersion, modifiedAt, ageDays, status, message };
  } catch {
    return {
      pkg,
      latestVersion: null,
      modifiedAt: null,
      ageDays: null,
      status: 'unknown',
      message: 'could not verify (network)'
    };
  }
}

export async function checkOutdated(
  packageNames: string[],
  opts?: OutdatedOptions
): Promise<OutdatedResult> {
  const resolvedOpts = opts ?? {};
  const entries = await Promise.all(packageNames.map((pkg) => checkPackage(pkg, resolvedOpts)));
  return { entries, summary: tally(entries) };
}
