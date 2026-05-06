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

type AuthUser = {
  id: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
};

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

async function requireUser(c: any): Promise<AuthUser | Response> {
  const authHeader = c.req.header('authorization') || '';
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
  const token = bearer || getCookie(c, 'agora_token');

  if (!token) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  const existing = await c.env.DB.prepare(
    'SELECT id, username, display_name, avatar_url FROM users WHERE github_access_token = ?'
  ).bind(token).first() as any;

  if (existing) {
    return {
      id: existing.id,
      username: existing.username,
      displayName: existing.display_name,
      avatarUrl: existing.avatar_url
    };
  }

  const githubUser = await fetchGitHubUser(token);
  if (!githubUser) {
    return c.json({ error: 'Invalid token' }, 401);
  }

  const now = new Date().toISOString();
  await c.env.DB.prepare(`
    INSERT INTO users (id, username, display_name, avatar_url, github_id, github_access_token, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(github_id) DO UPDATE SET
      username = excluded.username,
      display_name = excluded.display_name,
      avatar_url = excluded.avatar_url,
      github_access_token = excluded.github_access_token,
      updated_at = excluded.updated_at
  `).bind(
    String(githubUser.id),
    githubUser.login,
    githubUser.name || githubUser.login,
    githubUser.avatar_url,
    String(githubUser.id),
    token,
    now,
    now
  ).run();

  return {
    id: String(githubUser.id),
    username: githubUser.login,
    displayName: githubUser.name || githubUser.login,
    avatarUrl: githubUser.avatar_url
  };
}

async function fetchGitHubUser(token: string): Promise<any | null> {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'agora-cli'
      }
    });

    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[\/_]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

function normalizeTags(tags: unknown): string {
  if (Array.isArray(tags)) return JSON.stringify(tags.map(String));
  if (typeof tags === 'string') {
    const trimmed = tags.trim();
    if (!trimmed) return JSON.stringify([]);
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return JSON.stringify(parsed.map(String));
    } catch {
      // Fall back to comma-separated tags.
    }
    return JSON.stringify(trimmed.split(',').map((tag) => tag.trim()).filter(Boolean));
  }
  return JSON.stringify([]);
}

function normalizePackageCategory(category: unknown): string {
  return category === 'prompt' || category === 'workflow' || category === 'skill' ? category : 'mcp';
}

function normalizeDiscussionCategory(category: unknown): string {
  return category === 'question' || category === 'idea' || category === 'showcase' ? category : 'discussion';
}

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

app.post('/api/packages', async (c) => {
  const user = await requireUser(c);
  if (isResponse(user)) return user;

  const body = await c.req.json() as any;
  const name = String(body.name || '').trim();
  const description = String(body.description || '').trim();
  const id = String(body.id || slugify(name)).trim();
  const version = String(body.version || '1.0.0').trim();
  const category = normalizePackageCategory(body.category);
  const tags = normalizeTags(body.tags);
  const repository = body.repository ? String(body.repository).trim() : null;
  const npmPackage = body.npmPackage || body.npm_package ? String(body.npmPackage || body.npm_package).trim() : null;
  const now = new Date().toISOString();

  if (!id || !name || !description) {
    return c.json({ error: 'id, name, and description are required' }, 400);
  }

  if (category === 'mcp' && !npmPackage) {
    return c.json({ error: 'npmPackage is required for MCP packages' }, 400);
  }

  try {
    const existing = await c.env.DB.prepare(
      'SELECT id, author FROM packages WHERE id = ?'
    ).bind(id).first() as any;

    if (existing && existing.author !== user.username) {
      return c.json({ error: 'Package id is owned by another user' }, 403);
    }

    await c.env.DB.prepare(`
      INSERT INTO packages (id, name, description, author, version, category, tags, repository, npm_package, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        version = excluded.version,
        category = excluded.category,
        tags = excluded.tags,
        repository = excluded.repository,
        npm_package = excluded.npm_package,
        updated_at = excluded.updated_at
    `).bind(id, name, description, user.username, version, category, tags, repository, npmPackage, now, now).run();

    const pkg = await c.env.DB.prepare(
      'SELECT * FROM packages WHERE id = ?'
    ).bind(id).first();

    return c.json({ package: pkg, created: !existing });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

app.get('/api/packages/:id', async (c) => {
  const id = c.req.param('id');
  
  try {
    const pkg = await c.env.DB.prepare(
      'SELECT * FROM packages WHERE id = ? OR name = ?'
    ).bind(id, id).first();
    
    if (!pkg) {
      return c.json({ error: 'Package not found' }, 404);
    }
    return c.json({ package: pkg });
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

app.post('/api/workflows', async (c) => {
  const user = await requireUser(c);
  if (isResponse(user)) return user;

  const body = await c.req.json() as any;
  const name = String(body.name || '').trim();
  const description = String(body.description || '').trim();
  const prompt = String(body.prompt || '').trim();
  const id = String(body.id || `wf-${slugify(name)}`).trim();
  const model = body.model ? String(body.model).trim() : null;
  const tags = normalizeTags(body.tags);
  const now = new Date().toISOString();

  if (!id || !name || !description || !prompt) {
    return c.json({ error: 'id, name, description, and prompt are required' }, 400);
  }

  try {
    const existing = await c.env.DB.prepare(
      'SELECT id, author FROM workflows WHERE id = ?'
    ).bind(id).first() as any;

    if (existing && existing.author !== user.username) {
      return c.json({ error: 'Workflow id is owned by another user' }, 403);
    }

    await c.env.DB.prepare(`
      INSERT INTO workflows (id, name, description, author, prompt, model, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        prompt = excluded.prompt,
        model = excluded.model,
        tags = excluded.tags,
        updated_at = excluded.updated_at
    `).bind(id, name, description, user.username, prompt, model, tags, now, now).run();

    const workflow = await c.env.DB.prepare(
      'SELECT * FROM workflows WHERE id = ?'
    ).bind(id).first();

    return c.json({ workflow, created: !existing });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

app.get('/api/workflows/:id', async (c) => {
  const id = c.req.param('id');
  
  try {
    const workflow = await c.env.DB.prepare(
      'SELECT * FROM workflows WHERE id = ?'
    ).bind(id).first();
    
    if (!workflow) {
      return c.json({ error: 'Workflow not found' }, 404);
    }
    return c.json({ workflow });
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
  const user = await requireUser(c);
  if (isResponse(user)) return user;

  const body = await c.req.json() as any;
  const title = String(body.title || '').trim();
  const content = String(body.content || '').trim();
  const category = normalizeDiscussionCategory(body.category);

  if (!title || !content) {
    return c.json({ error: 'title and content are required' }, 400);
  }
  
  const id = `disc-${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  
  try {
    await c.env.DB.prepare(`
      INSERT INTO discussions (id, title, content, category, author, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(id, title, content, category, user.username, createdAt, createdAt).run();

    return c.json({
      discussion: {
        id,
        title,
        content,
        category,
        author: user.username,
        stars: 0,
        reply_count: 0,
        created_at: createdAt
      }
    });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

app.get('/api/reviews', async (c) => {
  const itemId = c.req.query('item_id') || c.req.query('itemId');
  const itemType = c.req.query('item_type') || c.req.query('itemType');
  const limit = c.req.query('limit') || '20';
  const params: any[] = [];
  const conditions: string[] = [];
  let query = 'SELECT * FROM reviews';

  if (itemId) {
    conditions.push('item_id = ?');
    params.push(itemId);
  }

  if (itemType) {
    conditions.push('item_type = ?');
    params.push(itemType);
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(' AND ')}`;
  }

  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(parseInt(limit));

  try {
    const { results } = await c.env.DB.prepare(query).bind(...params).all();
    return c.json({ reviews: results || [] });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

app.post('/api/reviews', async (c) => {
  const user = await requireUser(c);
  if (isResponse(user)) return user;

  const body = await c.req.json() as any;
  const itemId = String(body.itemId || body.item_id || '').trim();
  const itemType = String(body.itemType || body.item_type || 'package').trim();
  const rating = Number(body.rating);
  const content = String(body.content || '').trim();

  if (!itemId || !content || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return c.json({ error: 'itemId, rating 1-5, and content are required' }, 400);
  }

  if (itemType !== 'package' && itemType !== 'workflow') {
    return c.json({ error: 'itemType must be package or workflow' }, 400);
  }

  const id = `review-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  try {
    await c.env.DB.prepare(`
      INSERT INTO reviews (id, item_id, item_type, author, rating, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(id, itemId, itemType, user.username, rating, content, now).run();

    const review = await c.env.DB.prepare(
      'SELECT * FROM reviews WHERE id = ?'
    ).bind(id).first();

    return c.json({ review });
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
    const user = await c.env.DB.prepare(`
      SELECT id, username, display_name, bio, avatar_url, created_at
      FROM users
      WHERE username = ?
    `).bind(username).first() as any;
    
    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    const packageCount = await c.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM packages WHERE author = ?'
    ).bind(user.username).first() as any;
    const workflowCount = await c.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM workflows WHERE author = ?'
    ).bind(user.username).first() as any;
    const discussionCount = await c.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM discussions WHERE author = ?'
    ).bind(user.username).first() as any;

    return c.json({
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        bio: user.bio,
        avatar_url: user.avatar_url,
        package_count: Number(packageCount?.count || 0),
        workflow_count: Number(workflowCount?.count || 0),
        discussion_count: Number(discussionCount?.count || 0),
        created_at: user.created_at
      }
    });
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
