import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { getCookie, setCookie } from 'hono/cookie';

type Env = {
  DB: D1Database;
  Bindings: {
    AGORA_ENV: string;
    GITHUB_CLIENT_ID: string;
    GITHUB_CLIENT_SECRET: string;
    AUTH_SECRET: string;
  };
};

const app = new Hono<Env>();

app.use('*', logger());
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

app.get('/', (c) => c.json({
  name: 'Agora API',
  version: '1.0.0',
  status: 'running'
}));

app.get('/health', (c) => c.json({ status: 'ok' }));

// Auth - GitHub OAuth
app.get('/auth/github', async (c) => {
  const clientId = c.env.GITHUB_CLIENT_ID;
  const redirectUri = c.req.query('redirect') || 'http://localhost:8787/auth/callback';
  
  const state = crypto.randomUUID();
  const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user&state=${state}`;
  
  c.cookie('oauth_state', state, {
    httpOnly: true,
    secure: c.env.AGORA_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
  });
  
  return c.redirect(url);
});

app.get('/auth/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const cookieState = getCookie(c, 'oauth_state');
  
  if (!code || !state || state !== cookieState) {
    return c.json({ error: 'Invalid state or code' }, 400);
  }
  
  const clientId = c.env.GITHUB_CLIENT_ID;
  const clientSecret = c.env.GITHUB_CLIENT_SECRET;
  
  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });
    
    const tokenData = await tokenRes.json() as any;
    
    if (tokenData.error) {
      return c.json({ error: tokenData.error_description }, 400);
    }
    
    const accessToken = tokenData.access_token;
    
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });
    
    const userData = await userRes.json() as any;
    
    const username = userData.login;
    const githubId = String(userData.id);
    const avatarUrl = userData.avatar_url;
    const now = new Date().toISOString();
    
    await c.env.DB.prepare(`
      INSERT INTO users (id, username, display_name, avatar_url, github_id, github_access_token, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(github_id) DO UPDATE SET
        github_access_token = excluded.github_access_token,
        updated_at = excluded.updated_at
    `).bind(githubId, username, userData.name || username, avatarUrl, githubId, accessToken, now, now).run();
    
    setCookie(c, 'agora_token', accessToken, {
      httpOnly: true,
      secure: c.env.AGORA_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
    });
    
    return c.redirect('/');
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

app.post('/auth/logout', (c) => {
  c.deleteCookie('agora_token');
  return c.json({ success: true });
});

// Packages
app.get('/api/packages', async (c) => {
  const search = c.req.query('q');
  const category = c.req.query('category');
  const limit = c.req.query('limit') || '20';
  
  let query = 'SELECT * FROM packages';
  const params: any[] = [];
  const conditions: string[] = [];
  
  if (search) {
    conditions.push('(name LIKE ? OR description LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (category) {
    conditions.push('category = ?');
    params.push(category);
  }
  
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY stars DESC LIMIT ?';
  params.push(parseInt(limit));
  
  try {
    const { results } = await c.env.DB.prepare(query).bind(...params).all();
    return c.json({ packages: results || [] });
  } catch (e) {
    return c.json({ error: 'Database error', details: String(e) }, 500);
  }
});

app.get('/api/packages/:id', async (c) => {
  const id = c.req.param('id');
  
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM packages WHERE id = ? OR name = ?'
    ).bind(id, id).first();
    
    if (!results) {
      return c.json({ error: 'Package not found' }, 404);
    }
    return c.json({ package: results });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

// Workflows
app.get('/api/workflows', async (c) => {
  const search = c.req.query('q');
  const limit = c.req.query('limit') || '20';
  
  let query = 'SELECT * FROM workflows';
  const params: any[] = [];
  
  if (search) {
    query += ' WHERE name LIKE ? OR description LIKE ?';
    params.push(`%${search}%`, `%${search}%`);
  }
  query += ' ORDER BY stars DESC LIMIT ?';
  params.push(parseInt(limit));
  
  try {
    const { results } = await c.env.DB.prepare(query).bind(...params).all();
    return c.json({ workflows: results || [] });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

app.get('/api/workflows/:id', async (c) => {
  const id = c.req.param('id');
  
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM workflows WHERE id = ?'
    ).bind(id).first();
    
    if (!results) {
      return c.json({ error: 'Workflow not found' }, 404);
    }
    return c.json({ workflow: results });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

// Discussions
app.get('/api/discussions', async (c) => {
  const category = c.req.query('category');
  const limit = c.req.query('limit') || '20';
  
  let query = 'SELECT * FROM discussions';
  const params: any[] = [];
  
  if (category) {
    query += ' WHERE category = ?';
    params.push(category);
  }
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(parseInt(limit));
  
  try {
    const { results } = await c.env.DB.prepare(query).bind(...params).all();
    return c.json({ discussions: results || [] });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

app.post('/api/discussions', async (c) => {
  const body = await c.req.json();
  const { title, content, category, author } = body;
  
  if (!title || !content || !author) {
    return c.json({ error: 'Missing required fields' }, 400);
  }
  
  const id = `disc-${Date.now()}`;
  const createdAt = new Date().toISOString();
  
  try {
    await c.env.DB.prepare(`
      INSERT INTO discussions (id, title, content, category, author, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, title, content, category || 'discussion', author, createdAt).run();
    
    return c.json({ id, title, content, category, author, createdAt });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

// Tutorials
app.get('/api/tutorials', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM tutorials ORDER BY id'
    ).all();
    return c.json({ tutorials: results || [] });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

// Users
app.get('/api/users/:username', async (c) => {
  const username = c.req.param('username');
  
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM users WHERE username = ?'
    ).bind(username).first();
    
    if (!results) {
      return c.json({ error: 'User not found' }, 404);
    }
    return c.json({ user: results });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

// Trending
app.get('/api/trending', async (c) => {
  try {
    const topPackages = await c.env.DB.prepare(
      'SELECT * FROM packages ORDER BY stars DESC LIMIT 5'
    ).all();
    
    const topWorkflows = await c.env.DB.prepare(
      'SELECT * FROM workflows ORDER BY stars DESC LIMIT 5'
    ).all();
    
    return c.json({
      packages: topPackages.results || [],
      workflows: topWorkflows.results || []
    });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

// Search
app.get('/api/search', async (c) => {
  const q = c.req.query('q');
  const type = c.req.query('type') || 'all';
  
  if (!q) {
    return c.json({ error: 'Query required' }, 400);
  }
  
  try {
    const packages = type === 'all' || type === 'packages' 
      ? await c.env.DB.prepare(
          'SELECT * FROM packages WHERE name LIKE ? OR description LIKE ? LIMIT 10'
        ).bind(`%${q}%`, `%${q}%`).all()
      : { results: [] };
    
    const workflows = type === 'all' || type === 'workflows'
      ? await c.env.DB.prepare(
          'SELECT * FROM workflows WHERE name LIKE ? OR description LIKE ? LIMIT 10'
        ).bind(`%${q}%`, `%${q}%`).all()
      : { results: [] };
    
    return c.json({
      query: q,
      packages: packages.results || [],
      workflows: workflows.results || []
    });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

// Import aggregation services
import { fetchNpmPackage, searchNpmPackages, isMcpServer } from './services/npm';
import { fetchGitHubRepo, getGitHubReleases } from './services/github';

// Aggregation - npm/GitHub data
app.get('/api/aggregate/packages', async (c) => {
  const query = c.req.query('q');
  const limit = parseInt(c.req.query('limit') || '20');
  
  if (!query) {
    return c.json({ error: 'Query required' }, 400);
  }
  
  try {
    const npmResults = await searchNpmPackages(query, limit);
    const mcpPackages = npmResults.filter(isMcpServer);
    
    return c.json({
      query,
      npm: npmResults,
      mcp: mcpPackages,
    });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

app.get('/api/aggregate/mcp/:name', async (c) => {
  const name = c.req.param('name');
  const npmData = await fetchNpmPackage(name);
  
  return c.json({
    npm: npmData,
    isMcp: npmData ? isMcpServer(npmData) : false,
  });
});

app.get('/api/aggregate/github/:owner/:repo', async (c) => {
  const owner = c.req.param('owner');
  const repo = c.req.param('repo');
  
  const repoData = await fetchGitHubRepo(owner, repo);
  const releases = await getGitHubReleases(owner, repo);
  const topics = repoData?.topics || [];
  
  return c.json({
    repo: repoData,
    releases,
    topics,
    likelyMcp: topics.includes('mcp') || topics.includes('mcp-server'),
  });
});

export default app;