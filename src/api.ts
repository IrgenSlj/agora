const API_BASE = process.env.AGORA_API_URL || '';

export interface Package {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  category: string;
  tags: string[];
  stars: number;
  installs: number;
  repository?: string;
  npm_package?: string;
  created_at: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  author: string;
  prompt: string;
  model?: string;
  tags: string[];
  stars: number;
  forks: number;
  created_at: string;
}

export interface Discussion {
  id: string;
  title: string;
  content: string;
  author: string;
  category: string;
  stars: number;
  reply_count: number;
  created_at: string;
}

export interface User {
  id: string;
  username: string;
  display_name?: string;
  bio?: string;
  avatar_url?: string;
  package_count?: number;
  workflow_count?: number;
  discussion_count?: number;
  created_at?: string;
}

export async function searchPackages(query: string, category?: string): Promise<Package[]> {
  if (!API_BASE) return [];
  const params = new URLSearchParams({ q: query });
  if (category) params.set('category', category);

  const res = await fetch(`${API_BASE}/api/packages?${params}`);
  if (!res.ok) return [];

  const data = await res.json() as any;
  return data.packages || [];
}

export async function getPackage(id: string): Promise<Package | null> {
  if (!API_BASE) return null;
  const res = await fetch(`${API_BASE}/api/packages/${id}`);
  if (!res.ok) return null;

  const data = await res.json() as any;
  return data.package || null;
}

export async function searchWorkflows(query: string): Promise<Workflow[]> {
  if (!API_BASE) return [];
  const res = await fetch(`${API_BASE}/api/workflows?q=${encodeURIComponent(query)}`);
  if (!res.ok) return [];

  const data = await res.json() as any;
  return data.workflows || [];
}

export async function getWorkflow(id: string): Promise<Workflow | null> {
  if (!API_BASE) return null;
  const res = await fetch(`${API_BASE}/api/workflows/${id}`);
  if (!res.ok) return null;

  const data = await res.json() as any;
  return data.workflow || null;
}

export async function getTrending(_type: 'packages' | 'workflows' | 'all' = 'all') {
  if (!API_BASE) return { packages: [], workflows: [] };
  const res = await fetch(`${API_BASE}/api/trending`);
  if (!res.ok) return { packages: [], workflows: [] };

  return res.json();
}

export async function getDiscussions(category?: string): Promise<Discussion[]> {
  if (!API_BASE) return [];
  const params = category ? `?category=${category}` : '';
  const res = await fetch(`${API_BASE}/api/discussions${params}`);
  if (!res.ok) return [];

  const data = await res.json() as any;
  return data.discussions || [];
}

export async function createDiscussion(data: {
  title: string;
  content: string;
  category: string;
  author?: string;
}, token?: string): Promise<{ id: string } | null> {
  if (!API_BASE) {
    throw new Error(
      'AGORA_API_URL is not set. The hosted backend is not yet deployed — set AGORA_API_URL to your self-hosted backend (see backend/) to use --api mode.'
    );
  }
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_BASE}/api/discussions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data)
  });

  if (!res.ok) return null;
  const payload = await res.json() as any;
  return payload.discussion || payload;
}

export async function getUser(username: string): Promise<User | null> {
  if (!API_BASE) return null;
  const res = await fetch(`${API_BASE}/api/users/${username}`);
  if (!res.ok) return null;

  const data = await res.json() as any;
  return data.user || null;
}

export async function searchNpmPackages(query: string): Promise<{ npm: any[]; mcp: any[] }> {
  if (!API_BASE) return { npm: [], mcp: [] };
  const res = await fetch(`${API_BASE}/api/aggregate/packages?q=${encodeURIComponent(query)}`);
  if (!res.ok) return { npm: [], mcp: [] };

  return res.json() as Promise<{ npm: any[]; mcp: any[] }>;
}

export async function getMcpPackage(name: string): Promise<any | null> {
  if (!API_BASE) return null;
  const res = await fetch(`${API_BASE}/api/aggregate/mcp/${name}`);
  if (!res.ok) return null;

  return res.json();
}

export async function getGitHubRepo(owner: string, repo: string): Promise<any | null> {
  if (!API_BASE) return null;
  const res = await fetch(`${API_BASE}/api/aggregate/github/${owner}/${repo}`);
  if (!res.ok) return null;

  return res.json();
}
