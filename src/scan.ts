import type { MarketplaceItem, PackageMarketplaceItem } from './marketplace.js';
import { hasPermissions, getInstallKind } from './marketplace.js';
import type { FetchLike } from './live.js';

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface ScanCheck {
  name: string;
  label: string;
  status: CheckStatus;
  message: string;
}

export interface ScanResult {
  id: string;
  itemKind: 'package' | 'workflow';
  checks: ScanCheck[];
  summary: { pass: number; warn: number; fail: number };
}

export interface ScanOptions {
  fetcher?: FetchLike;
  now?: () => Date;
  githubToken?: string;
}

function tally(checks: ScanCheck[]): { pass: number; warn: number; fail: number } {
  let pass = 0, warn = 0, fail = 0;
  for (const c of checks) {
    if (c.status === 'pass') pass++;
    else if (c.status === 'warn') warn++;
    else fail++;
  }
  return { pass, warn, fail };
}

function licenseCheck(status: CheckStatus, message: string): ScanCheck {
  return { name: 'license_present', label: 'License declared', status, message };
}

// Returns repo_reachable plus (when the repo is reachable) license_present,
// both derived from a single GitHub repos API call. A missing license is a
// warning, never a hard fail — many legitimate repos lack a detected license.
async function checkRepo(item: PackageMarketplaceItem, opts: ScanOptions): Promise<ScanCheck[]> {
  const base: Omit<ScanCheck, 'status' | 'message'> = {
    name: 'repo_reachable',
    label: 'Repository reachable'
  };
  if (!item.repository) {
    return [{ ...base, status: 'pass', message: 'no repository field, skipped' }];
  }

  let url: URL;
  try {
    url = new URL(item.repository);
  } catch {
    return [{ ...base, status: 'pass', message: 'non-github repository, skipped' }];
  }

  if (url.hostname !== 'github.com') {
    return [{ ...base, status: 'pass', message: 'non-github repository, skipped' }];
  }

  const path = url.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/').slice(0, 2).join('/');
  const apiUrl = `https://api.github.com/repos/${path}`;
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (opts.githubToken) headers.Authorization = `Bearer ${opts.githubToken}`;

  const fetcher = opts.fetcher ?? globalThis.fetch;
  try {
    const res = await fetcher(apiUrl, { headers, signal: AbortSignal.timeout(8000) });
    if (res.status === 200) {
      const reachable: ScanCheck = { ...base, status: 'pass', message: `github.com/${path}` };
      let license: ScanCheck;
      try {
        const body = (await res.json()) as { license?: { spdx_id?: string } | null };
        const spdx = body.license?.spdx_id;
        license =
          spdx && spdx !== 'NOASSERTION'
            ? licenseCheck('pass', spdx)
            : licenseCheck('warn', 'no license detected on the repository');
      } catch {
        license = licenseCheck('warn', 'could not read license metadata');
      }
      return [reachable, license];
    }
    if (res.status === 404) return [{ ...base, status: 'fail', message: 'repo not found' }];
    return [{ ...base, status: 'warn', message: 'could not verify (rate limited or network)' }];
  } catch {
    return [{ ...base, status: 'warn', message: 'could not verify (rate limited or network)' }];
  }
}

async function checkNpmExists(
  item: PackageMarketplaceItem,
  opts: ScanOptions
): Promise<ScanCheck> {
  const base: Omit<ScanCheck, 'status' | 'message'> = {
    name: 'npm_exists',
    label: 'npm package exists'
  };
  if (!item.npmPackage) return { ...base, status: 'pass', message: 'no npm package, skipped' };

  const encoded = encodeURIComponent(item.npmPackage).replace('%40', '@').replace('%2F', '/');
  const fetcher = opts.fetcher ?? globalThis.fetch;
  try {
    const res = await fetcher(`https://registry.npmjs.org/${encoded}/latest`, {
      signal: AbortSignal.timeout(8000)
    });
    if (res.status === 200) {
      const json = await res.json() as { version?: string };
      return { ...base, status: 'pass', message: `${item.npmPackage}@${json.version ?? 'unknown'}` };
    }
    if (res.status === 404) return { ...base, status: 'fail', message: 'package not found on npm' };
    return { ...base, status: 'warn', message: 'could not verify (network)' };
  } catch {
    return { ...base, status: 'warn', message: 'could not verify (network)' };
  }
}

async function scanPackage(
  item: PackageMarketplaceItem,
  opts: ScanOptions
): Promise<ScanCheck[]> {
  const checks: ScanCheck[] = [];

  // 1. permissions_declared
  const hasPerm = hasPermissions(item.permissions);
  if (hasPerm) {
    const parts: string[] = [];
    if (item.permissions?.fs?.length) parts.push('fs');
    if (item.permissions?.net?.length) parts.push('net');
    if (item.permissions?.exec?.length) parts.push('exec');
    checks.push({ name: 'permissions_declared', label: 'Permissions declared', status: 'pass', message: parts.join('|') });
  } else {
    checks.push({ name: 'permissions_declared', label: 'Permissions declared', status: 'warn', message: 'no permissions manifest declared' });
  }

  // 2. permission_consistency
  const kind = getInstallKind(item);
  if (kind === 'git-clone' && !item.permissions?.exec?.length) {
    checks.push({ name: 'permission_consistency', label: 'Permission consistency', status: 'warn', message: 'git-clone install runs shell commands; declare exec' });
  } else if (kind === 'mcp-config-patch' && item.npmPackage && !item.permissions?.exec?.length) {
    checks.push({ name: 'permission_consistency', label: 'Permission consistency', status: 'warn', message: 'npx invocation runs binaries; declare exec' });
  } else {
    checks.push({ name: 'permission_consistency', label: 'Permission consistency', status: 'pass', message: 'declared permissions match install kind' });
  }

  // 3. repo_reachable (+ license_present when reachable)
  if (item.repository) {
    checks.push(...(await checkRepo(item, opts)));
  }

  // 4. npm_exists
  if (item.npmPackage) {
    checks.push(await checkNpmExists(item, opts));
  }

  // 5. recently_active
  if (item.pushedAt) {
    const now = opts.now ? opts.now() : new Date();
    const days = Math.floor((now.getTime() - new Date(item.pushedAt).getTime()) / 86_400_000);
    if (days <= 365) {
      checks.push({ name: 'recently_active', label: 'Recently active', status: 'pass', message: `pushed ${days}d ago` });
    } else {
      checks.push({ name: 'recently_active', label: 'Recently active', status: 'warn', message: `last push ${days}d ago — may be unmaintained` });
    }
  }

  // 6. flag_count_low
  const flags = item.flagCount ?? 0;
  if (flags < 3) {
    checks.push({ name: 'flag_count_low', label: 'Flag count low', status: 'pass', message: `${flags} flags` });
  } else if (flags < 10) {
    checks.push({ name: 'flag_count_low', label: 'Flag count low', status: 'warn', message: `${flags} flags — under review threshold` });
  } else {
    checks.push({ name: 'flag_count_low', label: 'Flag count low', status: 'fail', message: `${flags} flags — would auto-hide` });
  }

  return checks;
}

export async function scanItem(item: MarketplaceItem, opts: ScanOptions = {}): Promise<ScanResult> {
  let checks: ScanCheck[];

  if (item.kind === 'workflow') {
    const n = (item as { flagCount?: number }).flagCount ?? 0;
    checks = [
      { name: 'workflow_kind', label: 'Workflow kind', status: 'pass', message: 'Workflow items are inert prompts — no install side effects to scan.' },
      {
        name: 'flag_count_low',
        label: 'Flag count low',
        status: n < 3 ? 'pass' : n < 10 ? 'warn' : 'fail',
        message: n < 3 ? `${n} flags` : n < 10 ? `${n} flags — under review threshold` : `${n} flags — would auto-hide`
      }
    ];
  } else {
    checks = await scanPackage(item, opts);
  }

  return {
    id: item.id,
    itemKind: item.kind,
    checks,
    summary: tally(checks)
  };
}
