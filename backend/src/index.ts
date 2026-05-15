import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

type Env = {
  Bindings: {
    DB: D1Database;
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
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization']
  })
);

// ── Rate-limit middleware ───────────────────────────────────────────────────

type RateLimitOpts = { limit: number; window: number }; // window in seconds

const RATE_LIMITS: Record<string, RateLimitOpts> = {
  default: { limit: 60, window: 60 },
  write: { limit: 10, window: 60 },
};

async function rateLimit(
  c: any,
  opts: RateLimitOpts = RATE_LIMITS.default
): Promise<Response | null> {
  const auth = c.req.header('authorization');
  const key = auth
    ? `user:${auth.slice(0, 16)}`
    : `ip:${c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown'}`;
  const windowKey = `${key}:${Math.floor(Date.now() / (opts.window * 1000))}`;

  try {
    const row = (await c.env.DB.prepare(
      'SELECT requests FROM rate_limits WHERE key = ?'
    ).bind(windowKey).first()) as any;

    const count = row ? row.requests + 1 : 1;

    if (count === 1) {
      await c.env.DB.prepare(
        'INSERT OR REPLACE INTO rate_limits (key, requests, reset_at) VALUES (?, 1, datetime("now", ? || " seconds"))'
      ).bind(windowKey, String(opts.window)).run();
    } else {
      await c.env.DB.prepare(
        'UPDATE rate_limits SET requests = ? WHERE key = ?'
      ).bind(count, windowKey).run();
    }

    const adjusted = auth ? opts.limit : Math.floor(opts.limit / 2);

    if (count > adjusted) {
      return c.json({ error: 'Rate limit exceeded', limit: adjusted, window: opts.window }, 429);
    }
  } catch {
    // rate-limit failures are non-fatal — allow the request through
  }
  return null;
}

// Apply rate limits to API routes (skip auth routes)
app.use('/api/*', async (c, next) => {
  const method = c.req.method;
  const opts = method === 'GET' ? RATE_LIMITS.default : RATE_LIMITS.write;
  const blocked = await rateLimit(c, opts);
  if (blocked) return blocked;
  await next();
});

app.get('/', (c) =>
  c.json({
    name: 'Agora API',
    version: '1.0.0',
    status: 'running'
  })
);

app.get('/health', (c) => c.json({ status: 'ok' }));

// Auth - GitHub OAuth
app.get('/auth/github', async (c) => {
  const clientId = c.env.GITHUB_CLIENT_ID;
  const redirectUri = c.req.query('redirect') || 'http://localhost:8787/auth/callback';

  const state = crypto.randomUUID();
  const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user&state=${state}`;

  setCookie(c, 'oauth_state', state, {
    httpOnly: true,
    secure: c.env.AGORA_ENV === 'production',
    sameSite: 'Lax',
    maxAge: 600
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
        Accept: 'application/json'
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code
      })
    });

    const tokenData = (await tokenRes.json()) as any;

    if (tokenData.error) {
      return c.json({ error: tokenData.error_description }, 400);
    }

    const accessToken = tokenData.access_token;

    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3+json'
      }
    });

    const userData = (await userRes.json()) as any;

    const username = userData.login;
    const githubId = String(userData.id);
    const avatarUrl = userData.avatar_url;
    const now = new Date().toISOString();

    await c.env.DB.prepare(
      `
      INSERT INTO users (id, username, display_name, avatar_url, github_id, github_access_token, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(github_id) DO UPDATE SET
        github_access_token = excluded.github_access_token,
        updated_at = excluded.updated_at
    `
    )
      .bind(
        githubId,
        username,
        userData.name || username,
        avatarUrl,
        githubId,
        accessToken,
        now,
        now
      )
      .run();

    setCookie(c, 'agora_token', accessToken, {
      httpOnly: true,
      secure: c.env.AGORA_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30
    });

    return c.redirect('/');
  } catch (e) {
    console.error('Auth callback error:', e);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.post('/auth/logout', (c) => {
  deleteCookie(c, 'agora_token');
  return c.json({ success: true });
});

// ── JWT utilities (HS256 via Web Crypto API) ────────────────────────────────

async function jwtSecret(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder().encode(secret);
  return crypto.subtle.importKey('raw', enc, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function base64Url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function signJwt(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const enc = new TextEncoder();
  const headerB64 = base64Url(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64Url(enc.encode(JSON.stringify(payload)));
  const key = await jwtSecret(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${headerB64}.${payloadB64}`));
  return `${headerB64}.${payloadB64}.${base64Url(sig)}`;
}

async function verifyJwt(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  try {
    const key = await jwtSecret(secret);
    const enc = new TextEncoder();
    const valid = await crypto.subtle.verify(
      'HMAC', key, base64UrlDecode(sigB64), enc.encode(`${headerB64}.${payloadB64}`)
    );
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Token hashing ────────────────────────────────────────────────────────────

async function hashToken(token: string): Promise<string> {
  const enc = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', enc.encode(token));
  return base64Url(hash);
}

// ── Device-code flow ────────────────────────────────────────────────────────

const DEVICE_CODE_EXPIRY = 900; // 15 minutes
const USER_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const POLL_INTERVAL_MS = 5000;

function generateUserCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += USER_CODE_CHARS[Math.floor(Math.random() * USER_CODE_CHARS.length)];
  }
  return code;
}

function generateDeviceCode(): string {
  return crypto.randomUUID();
}

/**
 * POST /auth/device/code — Mint a new device-code pair.
 * Returns user_code, device_code, verification_uri, and expires_in.
 */
app.post('/auth/device/code', async (c) => {
  const clientId = c.req.query('client_id') || 'agora-cli';
  const deviceCode = generateDeviceCode();
  const userCode = generateUserCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DEVICE_CODE_EXPIRY * 1000).toISOString();

  try {
    await c.env.DB.prepare(
      `INSERT INTO device_codes (device_code, user_code, client_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(deviceCode, userCode, clientId, now.toISOString(), expiresAt)
      .run();

    const baseUrl = `${c.req.url.split('/auth')[0]}`;
    return c.json({
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: `${baseUrl}/auth/device`,
      expires_in: DEVICE_CODE_EXPIRY,
      interval: 5
    });
  } catch (e) {
    console.error('POST /auth/device/code error:', e);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * GET /auth/device — Render a simple HTML page where the user enters their code.
 */
app.get('/auth/device', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Agora — Device Login</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:500px;margin:40px auto;padding:0 20px}
  h1{color:#D4A85A;font-size:1.5rem}
  input{font-size:1.2rem;padding:8px 12px;width:100%;box-sizing:border-box;letter-spacing:4px;text-align:center;font-family:monospace}
  button{background:#D4A85A;color:#1a1a1a;border:none;padding:10px 24px;font-size:1rem;border-radius:6px;cursor:pointer;margin-top:12px}
  button:hover{background:#c4994a}
  .error{color:#e74c3c;margin-top:8px}
  .success{color:#2ecc71;margin-top:8px}
</style></head>
<body>
<h1>Agora — Device Login</h1>
<p>Enter the code shown in your terminal:</p>
<input type="text" id="code" maxlength="8" autofocus placeholder="XXXXXXXX"
  oninput="this.value=this.value.toUpperCase().replace(/[^A-Z2-9]/g,'')">
<button onclick="verify()">Verify</button>
<div id="status"></div>
<script>
async function verify(){
  const code=document.getElementById('code').value;
  const status=document.getElementById('status');
  if(code.length<8){status.className='error';status.textContent='Enter the 8-character code';return}
  status.textContent='Verifying...';status.className='';
  try{
    const r=await fetch('/auth/device/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_code:code})});
    const d=await r.json();
    if(r.ok){status.className='success';status.textContent='✓ Authorized! Return to your terminal.'}
    else{status.className='error';status.textContent=d.error||'Verification failed'}
  }catch(e){status.className='error';status.textContent='Network error';}
}
</script>
</body></html>`);
});

/**
 * POST /auth/device/verify — Browser submits the user code to link it with a
 * GitHub OAuth session. The browser is redirected here via GitHub OAuth.
 * This triggers a redirect to GitHub OAuth, then back to complete.
 */
app.post('/auth/device/verify', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const userCode = String(body.user_code || '').trim().toUpperCase();
  if (!userCode || userCode.length < 8) {
    return c.json({ error: 'Invalid code' }, 400);
  }

  try {
    const record = (await c.env.DB.prepare(
      `SELECT device_code, status, expires_at FROM device_codes WHERE user_code = ?`
    ).bind(userCode).first()) as any;

    if (!record) return c.json({ error: 'Invalid code' }, 404);
    if (record.status !== 'pending') return c.json({ error: 'Code already used' }, 400);
    if (new Date(record.expires_at) < new Date()) {
      await c.env.DB.prepare(`UPDATE device_codes SET status = 'expired' WHERE device_code = ?`)
        .bind(record.device_code).run();
      return c.json({ error: 'Code expired. Generate a new one.' }, 400);
    }

    // Redirect to GitHub OAuth with the device_code as state to link back
    const clientId = c.env.GITHUB_CLIENT_ID;
    const callbackUrl = `${c.req.url.split('/auth')[0]}/auth/device/callback?device_code=${record.device_code}`;
    const state = record.device_code;
    const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=read:user&state=${state}`;

    return c.json({ redirect_url: url, device_code: record.device_code });
  } catch (e) {
    console.error('POST /auth/device/verify error:', e);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * GET /auth/device/callback — GitHub OAuth callback for the device flow.
 * Stores the GitHub token and marks the device_code as authorized.
 */
app.get('/auth/device/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const deviceCode = c.req.query('device_code') || state;

  if (!code || !deviceCode) {
    return c.html('<html><body><h1>Authentication failed</h1><p>Missing code or state.</p></body></html>');
  }

  try {
    const record = (await c.env.DB.prepare(
      `SELECT status, expires_at FROM device_codes WHERE device_code = ?`
    ).bind(deviceCode).first()) as any;

    if (!record || record.status !== 'pending' || new Date(record.expires_at) < new Date()) {
      return c.html('<html><body><h1>Expired or invalid session</h1><p>Please generate a new code.</p></body></html>');
    }

    // Exchange code for GitHub access token
    const clientId = c.env.GITHUB_CLIENT_ID;
    const clientSecret = c.env.GITHUB_CLIENT_SECRET;
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code })
    });
    const tokenData = (await tokenRes.json()) as any;
    if (tokenData.error) {
      return c.html(`<html><body><h1>GitHub auth failed</h1><p>${tokenData.error_description || tokenData.error}</p></body></html>`);
    }

    const accessToken = tokenData.access_token;
    const hashedToken = await hashToken(accessToken);

    // Fetch GitHub user
    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github.v3+json' }
    });
    const userData = (await userRes.json()) as any;
    const username = userData.login;
    const githubId = String(userData.id);
    const now = new Date().toISOString();

    // Upsert user with hashed token
    await c.env.DB.prepare(
      `INSERT INTO users (id, username, display_name, avatar_url, github_id, github_access_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(github_id) DO UPDATE SET
         github_access_token = excluded.github_access_token,
         updated_at = excluded.updated_at`
    ).bind(githubId, username, userData.name || username, userData.avatar_url, githubId, hashedToken, now, now).run();

    // Mark device code as authorized
    await c.env.DB.prepare(`UPDATE device_codes SET status = 'authorized', github_token = ? WHERE device_code = ?`)
      .bind(hashedToken, deviceCode).run();

    return c.html(`<html><body style="font-family:sans-serif;text-align:center;padding:60px 20px">
      <h1 style="color:#D4A85A">✓ Authorized!</h1>
      <p>Signed in as <strong>${username}</strong>.</p>
      <p>Return to your terminal to continue.</p>
    </body></html>`);
  } catch (e) {
    console.error('GET /auth/device/callback error:', e);
    return c.html('<html><body><h1>Internal error</h1><p>Please try again.</p></body></html>');
  }
});

/**
 * POST /auth/device/token — Polled by the CLI to exchange a device_code for a
 * JWT once the user authorizes in the browser.
 */
app.post('/auth/device/token', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const deviceCode = String(body.device_code || '').trim();
  if (!deviceCode) return c.json({ error: 'device_code required' }, 400);

  try {
    const record = (await c.env.DB.prepare(
      `SELECT status, github_token, expires_at FROM device_codes WHERE device_code = ?`
    ).bind(deviceCode).first()) as any;

    if (!record) return c.json({ error: 'Invalid device_code' }, 404);

    if (new Date(record.expires_at) < new Date()) {
      await c.env.DB.prepare(`UPDATE device_codes SET status = 'expired' WHERE device_code = ?`)
        .bind(deviceCode).run();
      return c.json({ error: 'expired' }, 400);
    }

    if (record.status === 'pending') {
      return c.json({ error: 'authorization_pending' }, 400);
    }

    if (record.status === 'authorized' && record.github_token) {
      // Issue a short-lived JWT
      const now = Math.floor(Date.now() / 1000);
      const jwt = await signJwt({
        sub: record.github_token,
        iat: now,
        exp: now + 3600, // 1 hour
        iss: 'agora-api'
      }, c.env.AUTH_SECRET);

      // Mark as completed (one-time use)
      await c.env.DB.prepare(`UPDATE device_codes SET status = 'completed' WHERE device_code = ?`)
        .bind(deviceCode).run();

      return c.json({ access_token: jwt, token_type: 'Bearer', expires_in: 3600 });
    }

    return c.json({ error: 'authorization_pending' }, 400);
  } catch (e) {
    console.error('POST /auth/device/token error:', e);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// ── Require user middleware (JWT-first, with legacy token fallback) ──────────

async function requireUser(c: any): Promise<AuthUser | Response> {
  const authHeader = c.req.header('authorization') || '';
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
  const token = bearer || getCookie(c, 'agora_token');

  if (!token) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  // Try JWT first
  const jwtPayload = await verifyJwt(token, c.env.AUTH_SECRET);
  if (jwtPayload && jwtPayload.sub) {
    const hashedToken = String(jwtPayload.sub);
    const existing = (await c.env.DB.prepare(
      'SELECT id, username, display_name, avatar_url FROM users WHERE github_access_token = ?'
    ).bind(hashedToken).first()) as any;

    if (existing) {
      return {
        id: existing.id,
        username: existing.username,
        displayName: existing.display_name,
        avatarUrl: existing.avatar_url
      };
    }
  }

  // Legacy: try raw GitHub token (plaintext lookup, then GitHub API)
  const existing = (await c.env.DB.prepare(
    'SELECT id, username, display_name, avatar_url FROM users WHERE github_access_token = ?'
  ).bind(token).first()) as any;

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

  const hashedToken = await hashToken(token);
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO users (id, username, display_name, avatar_url, github_id, github_access_token, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(github_id) DO UPDATE SET
       username = excluded.username,
       display_name = excluded.display_name,
       avatar_url = excluded.avatar_url,
       github_access_token = excluded.github_access_token,
       updated_at = excluded.updated_at`
  ).bind(
    String(githubUser.id), githubUser.login,
    githubUser.name || githubUser.login, githubUser.avatar_url,
    String(githubUser.id), hashedToken, now, now
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
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
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
    return JSON.stringify(
      trimmed
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
    );
  }
  return JSON.stringify([]);
}

function normalizePackageCategory(category: unknown): string {
  return category === 'prompt' || category === 'workflow' || category === 'skill'
    ? category
    : 'mcp';
}

function normalizeDiscussionCategory(category: unknown): string {
  return category === 'question' || category === 'idea' || category === 'showcase'
    ? category
    : 'discussion';
}

/**
 * Parse a limit query parameter. Defaults to `defaultVal` when missing, NaN,
 * or less than 1. Clamps to a maximum of 100.
 */
function parseLimit(raw: string | undefined, defaultVal = 50): number {
  const n = parseInt(raw ?? '', 10);
  if (!Number.isFinite(n) || n < 1) return defaultVal;
  return Math.min(n, 100);
}

// Packages
app.get('/api/packages', async (c) => {
  const search = c.req.query('q');
  const category = c.req.query('category');
  const limit = parseLimit(c.req.query('limit'));

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
  params.push(limit);

  try {
    const { results } = await c.env.DB.prepare(query)
      .bind(...params)
      .all();
    return c.json({ packages: results || [] });
  } catch (e) {
    console.error('GET /api/packages error:', e);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.post('/api/packages', async (c) => {
  const user = await requireUser(c);
  if (isResponse(user)) return user;

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const name = String(body.name || '').trim();
  const description = String(body.description || '').trim();
  const id = String(body.id || slugify(name)).trim();
  const version = String(body.version || '1.0.0').trim();
  const category = normalizePackageCategory(body.category);
  const tags = normalizeTags(body.tags);
  const repository = body.repository ? String(body.repository).trim() : null;
  const npmPackage =
    body.npmPackage || body.npm_package ? String(body.npmPackage || body.npm_package).trim() : null;
  const now = new Date().toISOString();

  if (!id || !name || !description) {
    return c.json({ error: 'id, name, and description are required' }, 400);
  }

  if (category === 'mcp' && !npmPackage) {
    return c.json({ error: 'npmPackage is required for MCP packages' }, 400);
  }

  try {
    const existing = (await c.env.DB.prepare('SELECT id, author FROM packages WHERE id = ?')
      .bind(id)
      .first()) as any;

    if (existing && existing.author !== user.username) {
      return c.json({ error: 'Package id is owned by another user' }, 403);
    }

    await c.env.DB.prepare(
      `
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
    `
    )
      .bind(
        id,
        name,
        description,
        user.username,
        version,
        category,
        tags,
        repository,
        npmPackage,
        now,
        now
      )
      .run();

    const pkg = await c.env.DB.prepare('SELECT * FROM packages WHERE id = ?').bind(id).first();

    return c.json({ package: pkg, created: !existing });
  } catch (e) {
    console.error('POST /api/packages error:', e);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.get('/api/packages/:id', async (c) => {
  const id = c.req.param('id');

  try {
    const pkg = await c.env.DB.prepare('SELECT * FROM packages WHERE id = ?').bind(id).first();

    if (!pkg) {
      return c.json({ error: 'Package not found' }, 404);
    }
    return c.json({ package: pkg });
  } catch (e) {
    console.error('GET /api/packages/:id error:', e);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Workflows
app.get('/api/workflows', async (c) => {
  const search = c.req.query('q');
  const limit = parseLimit(c.req.query('limit'));

  let query = 'SELECT * FROM workflows';
  const params: any[] = [];

  if (search) {
    query += ' WHERE name LIKE ? OR description LIKE ?';
    params.push(`%${search}%`, `%${search}%`);
  }
  query += ' ORDER BY stars DESC LIMIT ?';
  params.push(limit);

  try {
    const { results } = await c.env.DB.prepare(query)
      .bind(...params)
      .all();
    return c.json({ workflows: results || [] });
  } catch (e) {
    console.error('GET /api/workflows error:', e);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.post('/api/workflows', async (c) => {
  const user = await requireUser(c);
  if (isResponse(user)) return user;

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

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
    const existing = (await c.env.DB.prepare('SELECT id, author FROM workflows WHERE id = ?')
      .bind(id)
      .first()) as any;

    if (existing && existing.author !== user.username) {
      return c.json({ error: 'Workflow id is owned by another user' }, 403);
    }

    await c.env.DB.prepare(
      `
      INSERT INTO workflows (id, name, description, author, prompt, model, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        prompt = excluded.prompt,
        model = excluded.model,
        tags = excluded.tags,
        updated_at = excluded.updated_at
    `
    )
      .bind(id, name, description, user.username, prompt, model, tags, now, now)
      .run();

    const workflow = await c.env.DB.prepare('SELECT * FROM workflows WHERE id = ?')
      .bind(id)
      .first();

    return c.json({ workflow, created: !existing });
  } catch (e) {
    console.error('POST /api/workflows error:', e);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.get('/api/workflows/:id', async (c) => {
  const id = c.req.param('id');

  try {
    const workflow = await c.env.DB.prepare('SELECT * FROM workflows WHERE id = ?')
      .bind(id)
      .first();

    if (!workflow) {
      return c.json({ error: 'Workflow not found' }, 404);
    }
    return c.json({ workflow });
  } catch (e) {
    console.error('GET /api/workflows/:id error:', e);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Discussions
app.get('/api/discussions', async (c) => {
  const category = c.req.query('category');
  const limit = parseLimit(c.req.query('limit'));

  let query = 'SELECT * FROM discussions';
  const params: any[] = [];

  if (category) {
    query += ' WHERE category = ?';
    params.push(category);
  }
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  try {
    const { results } = await c.env.DB.prepare(query)
      .bind(...params)
      .all();
    return c.json({ discussions: results || [] });
  } catch (e) {
    console.error('GET /api/discussions error:', e);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.post('/api/discussions', async (c) => {
  const user = await requireUser(c);
  if (isResponse(user)) return user;

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const title = String(body.title || '').trim();
  const content = String(body.content || '').trim();
  const category = normalizeDiscussionCategory(body.category);

  if (!title || !content) {
    return c.json({ error: 'title and content are required' }, 400);
  }

  const id = `disc-${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();

  try {
    await c.env.DB.prepare(
      `
      INSERT INTO discussions (id, title, content, category, author, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
    )
      .bind(id, title, content, category, user.username, createdAt, createdAt)
      .run();

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
    console.error('POST /api/discussions error:', e);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.get('/api/reviews', async (c) => {
  const itemId = c.req.query('item_id') || c.req.query('itemId');
  const itemType = c.req.query('item_type') || c.req.query('itemType');
  const limit = parseLimit(c.req.query('limit'));
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
  params.push(limit);

  try {
    const { results } = await c.env.DB.prepare(query)
      .bind(...params)
      .all();
    return c.json({ reviews: results || [] });
  } catch (e) {
    console.error('GET /api/reviews error:', e);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.post('/api/reviews', async (c) => {
  const user = await requireUser(c);
  if (isResponse(user)) return user;

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

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
    await c.env.DB.prepare(
      `
      INSERT INTO reviews (id, item_id, item_type, author, rating, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
    )
      .bind(id, itemId, itemType, user.username, rating, content, now)
      .run();

    const review = await c.env.DB.prepare('SELECT * FROM reviews WHERE id = ?').bind(id).first();

    return c.json({ review });
  } catch (e) {
    console.error('POST /api/reviews error:', e);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Tutorials
app.get('/api/tutorials', async (c) => {
  try {
    const { results } = await c.env.DB.prepare('SELECT * FROM tutorials ORDER BY id').all();
    return c.json({ tutorials: results || [] });
  } catch (e) {
    console.error('GET /api/tutorials error:', e);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Users
app.get('/api/users/:username', async (c) => {
  const username = c.req.param('username');

  try {
    const user = (await c.env.DB.prepare(
      `
      SELECT id, username, display_name, bio, avatar_url, created_at
      FROM users
      WHERE username = ?
    `
    )
      .bind(username)
      .first()) as any;

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    const packageCount = (await c.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM packages WHERE author = ?'
    )
      .bind(user.username)
      .first()) as any;
    const workflowCount = (await c.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM workflows WHERE author = ?'
    )
      .bind(user.username)
      .first()) as any;
    const discussionCount = (await c.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM discussions WHERE author = ?'
    )
      .bind(user.username)
      .first()) as any;

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
    console.error('GET /api/users/:username error:', e);
    return c.json({ error: 'Internal server error' }, 500);
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
    console.error('GET /api/trending error:', e);
    return c.json({ error: 'Internal server error' }, 500);
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
    const packages =
      type === 'all' || type === 'packages'
        ? await c.env.DB.prepare(
            'SELECT * FROM packages WHERE name LIKE ? OR description LIKE ? LIMIT 10'
          )
            .bind(`%${q}%`, `%${q}%`)
            .all()
        : { results: [] };

    const workflows =
      type === 'all' || type === 'workflows'
        ? await c.env.DB.prepare(
            'SELECT * FROM workflows WHERE name LIKE ? OR description LIKE ? LIMIT 10'
          )
            .bind(`%${q}%`, `%${q}%`)
            .all()
        : { results: [] };

    return c.json({
      query: q,
      packages: packages.results || [],
      workflows: workflows.results || []
    });
  } catch (e) {
    console.error('GET /api/search error:', e);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Import aggregation services
import { fetchNpmPackage, searchNpmPackages, isMcpServer } from './services/npm';
import { fetchGitHubRepo, getGitHubReleases } from './services/github';

// Aggregation - npm/GitHub data
app.get('/api/aggregate/packages', async (c) => {
  const query = c.req.query('q');
  const limit = parseLimit(c.req.query('limit'));

  if (!query) {
    return c.json({ error: 'Query required' }, 400);
  }

  try {
    const npmResults = await searchNpmPackages(query, limit);
    const mcpPackages = npmResults.filter(isMcpServer);

    return c.json({
      query,
      npm: npmResults,
      mcp: mcpPackages
    });
  } catch (e) {
    console.error('GET /api/aggregate/packages error:', e);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.get('/api/aggregate/mcp/:name', async (c) => {
  const name = c.req.param('name');
  const npmData = await fetchNpmPackage(name);

  return c.json({
    npm: npmData,
    isMcp: npmData ? isMcpServer(npmData) : false
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
    likelyMcp: topics.includes('mcp') || topics.includes('mcp-server')
  });
});

export default app;
