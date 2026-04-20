export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  language: string;
  topics: string[];
  updated_at: string;
  owner: {
    login: string;
    avatar_url: string;
  };
}

export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  html_url: string;
}

export async function fetchGitHubRepo(owner: string, repo: string, token?: string): Promise<GitHubRepo | null> {
  try {
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
    };
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
    if (!res.ok) return null;
    
    return await res.json() as GitHubRepo;
  } catch {
    return null;
  }
}

export async function searchGitHubRepos(query: string, limit = 20) {
  try {
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
    };
    
    const res = await fetch(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=${limit}`,
      { headers }
    );
    if (!res.ok) return [];
    
    const data = await res.json() as any;
    return data.items || [];
  } catch {
    return [];
  }
}

export async function getGitHubReleases(owner: string, repo: string, token?: string): Promise<GitHubRelease[]> {
  try {
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
    };
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/releases`,
      { headers }
    );
    if (!res.ok) return [];
    
    const data = await res.json() as any;
    return data.slice(0, 10) as GitHubRelease[];
  } catch {
    return [];
  }
}

export async function getGitHubTopics(owner: string, repo: string, token?: string): Promise<string[]> {
  const repoData = await fetchGitHubRepo(owner, repo, token);
  return repoData?.topics || [];
}

export function isMcpServer(pkg: any): boolean {
  const keywords = pkg.keywords || [];
  const name = pkg.name?.toLowerCase() || '';
  
  return keywords.includes('mcp') ||
    keywords.includes('mcp-server') ||
    keywords.includes('modelcontextprotocol') ||
    name.includes('mcp-') ||
    name.includes('-mcp');
}

export function extractNpmFromRepo(repo: GitHubRepo): string | null {
  const readme = ''; // Would fetch readme in real implementation
  
  const npmPatterns = [
    /npm\s+install\s+([@a-z0-9\/.-]+)/i,
    /npm\s+i\s+([@a-z0-9\/.-]+)/i,
    /(@[a-z0-9-]+)\/([a-z0-9-]+)/gi,
  ];
  
  // Check repo URL for npm organization
  const url = repo.html_url;
  const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
  if (match) {
    return `@${match[1]}/${match[2].replace('server-', '')}`;
  }
  
  return null;
}