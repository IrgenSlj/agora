import { cache } from 'hono/cache';

export interface NpmPackage {
  name: string;
  version: string;
  description: string;
  keywords: string[];
  author: { name: string };
  repository: { url: string };
  homepage: string;
  downloads: number;
  stars?: number;
}

export async function fetchNpmPackage(name: string): Promise<NpmPackage | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${name}`);
    if (!res.ok) return null;

    const data = (await res.json()) as any;
    const latest = data['dist-tags']?.latest;
    if (!latest) return null;

    const pkg = data.versions?.[latest];
    if (!pkg) return null;

    return {
      name: data.name,
      version: latest,
      description: pkg.description || '',
      keywords: pkg.keywords || [],
      author: pkg.author || { name: 'unknown' },
      repository: pkg.repository || {},
      homepage: pkg.homepage || '',
      downloads: 0
    };
  } catch {
    return null;
  }
}

export async function searchNpmPackages(query: string, limit = 20) {
  try {
    const res = await fetch(
      `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${limit}`
    );
    if (!res.ok) return [];

    const data = (await res.json()) as any;
    return (
      data.objects?.map((obj: any) => ({
        name: obj.package.name,
        version: obj.package.version,
        description: obj.package.description,
        keywords: obj.package.keywords || [],
        author: obj.package.author?.name || 'unknown'
      })) || []
    );
  } catch {
    return [];
  }
}

export async function getNpmDownloads(name: string): Promise<number> {
  try {
    const res = await fetch(`https://api.npmjs.org/downloads/point/last-week/${name}`);
    if (!res.ok) return 0;

    const data = (await res.json()) as any;
    return data.downloads || 0;
  } catch {
    return 0;
  }
}

export function createNpmCache() {
  // Pre-existing mismatch with hono/cache signature; tracked for a separate workstream
  const cacheAny = cache as (...args: unknown[]) => unknown;
  return cacheAny(
    async (c: { req: { param: (n: string) => string } }) => {
      const name = c.req.param('name');
      return await fetchNpmPackage(name);
    },
    { cacheName: 'npm-packages', cacheControl: 'max-age=3600' }
  );
}

export function isMcpServer(pkg: NpmPackage): boolean {
  const keywords = pkg.keywords || [];
  const name = pkg.name?.toLowerCase() || '';

  return (
    keywords.includes('mcp') ||
    keywords.includes('mcp-server') ||
    keywords.includes('modelcontextprotocol') ||
    name.includes('mcp-') ||
    name.startsWith('mcp')
  );
}
