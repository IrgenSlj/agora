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
  write: { limit: 10, window: 60 }
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
    const row = (await c.env.DB.prepare('SELECT requests FROM rate_limits WHERE key = ?')
      .bind(windowKey)
      .first()) as any;

    const count = row ? row.requests + 1 : 1;

    if (count === 1) {
      await c.env.DB.prepare(
        'INSERT OR REPLACE INTO rate_limits (key, requests, reset_at) VALUES (?, 1, datetime("now", ? || " seconds"))'
      )
        .bind(windowKey, String(opts.window))
        .run();
    } else {
      await c.env.DB.prepare('UPDATE rate_limits SET requests = ? WHERE key = ?')
        .bind(count, windowKey)
        .run();
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

    // Upsert user (GitHub OAuth tokens are never persisted)
    await c.env.DB.prepare(
      `
      INSERT INTO users (id, username, display_name, avatar_url, github_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(github_id) DO UPDATE SET
        updated_at = excluded.updated_at
    `
    )
      .bind(githubId, username, userData.name || username, avatarUrl, githubId, now, now)
      .run();

    const tokens = await mintTokenPair(c, githubId);

    setCookie(c, 'agora_access', tokens.access_token, {
      httpOnly: true,
      secure: c.env.AGORA_ENV === 'production',
      sameSite: 'lax',
      maxAge: ACCESS_TTL_SECONDS
    });
    setCookie(c, 'agora_refresh', tokens.refresh_token, {
      httpOnly: true,
      secure: c.env.AGORA_ENV === 'production',
      sameSite: 'lax',
      maxAge: REFRESH_TTL_SECONDS
    });

    return c.redirect('/');
  } catch (e) {
    console.error('Auth callback error:', e);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.post('/auth/refresh', async (c) => {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
  const rl = await checkRateLimit(c.env.DB, `ip:${ip}`, RATE_LIMITS.write);
  if (!rl.allowed) return c.json({ error: 'Rate limit exceeded', resetIn: rl.resetIn }, 429);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_refresh' }, 401);
  }

  const refreshToken = String(body.refresh_token || '').trim();
  if (!refreshToken) return c.json({ error: 'invalid_refresh' }, 401);

  const payload = await verifyJwt(refreshToken, c.env.AUTH_SECRET);
  if (!payload) return c.json({ error: 'expired_refresh' }, 401);
  if (payload.type !== 'refresh' || !payload.sub || !payload.jti) {
    return c.json({ error: 'invalid_refresh' }, 401);
  }

  const jtiHash = await hashToken(String(payload.jti));
  const row = (await c.env.DB.prepare('SELECT jti_hash FROM refresh_tokens WHERE jti_hash = ?')
    .bind(jtiHash)
    .first()) as any;

  if (!row) return c.json({ error: 'revoked_refresh' }, 401);

  // Rotate: delete old, mint new pair
  await c.env.DB.prepare('DELETE FROM refresh_tokens WHERE jti_hash = ?').bind(jtiHash).run();
  const tokens = await mintTokenPair(c, String(payload.sub));
  return c.json(tokens);
});

app.post('/auth/logout', async (c) => {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
  const rl = await checkRateLimit(c.env.DB, `ip:${ip}`, RATE_LIMITS.write);
  if (!rl.allowed) return c.json({ error: 'Rate limit exceeded', resetIn: rl.resetIn }, 429);

  const user = await requireUser(c);
  if (isResponse(user)) return user;

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const refreshToken = body.refresh_token ? String(body.refresh_token).trim() : null;

  if (refreshToken) {
    const payload = await verifyJwt(refreshToken, c.env.AUTH_SECRET);
    if (payload && payload.jti) {
      await revokeRefreshToken(c, String(payload.jti));
    }
    deleteCookie(c, 'agora_access');
    deleteCookie(c, 'agora_refresh');
    return c.json({ success: true, revoked: 'one' });
  } else {
    await revokeAllUserRefreshTokens(c, user.id);
    deleteCookie(c, 'agora_access');
    deleteCookie(c, 'agora_refresh');
    return c.json({ success: true, revoked: 'all' });
  }
});

// ── JWT utilities (HS256 via Web Crypto API) ────────────────────────────────

async function jwtSecret(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder().encode(secret);
  return crypto.subtle.importKey('raw', enc, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify'
  ]);
}

function base64Url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...bytes))
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
      'HMAC',
      key,
      base64UrlDecode(sigB64),
      enc.encode(`${headerB64}.${payloadB64}`)
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

// ── Token pair helpers ────────────────────────────────────────────────────────

const ACCESS_TTL_SECONDS = 3600;
const REFRESH_TTL_SECONDS = 90 * 86400;

async function mintTokenPair(
  c: any,
  userId: string
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
}> {
  const now = Math.floor(Date.now() / 1000);
  const jti = crypto.randomUUID();
  const access = await signJwt(
    { sub: userId, type: 'access', iat: now, exp: now + ACCESS_TTL_SECONDS },
    c.env.AUTH_SECRET
  );
  const refresh = await signJwt(
    { sub: userId, type: 'refresh', jti, iat: now, exp: now + REFRESH_TTL_SECONDS },
    c.env.AUTH_SECRET
  );
  const jtiHash = await hashToken(jti);
  const expiresAt = new Date((now + REFRESH_TTL_SECONDS) * 1000).toISOString();
  await c.env.DB.prepare(
    'INSERT INTO refresh_tokens (jti_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  )
    .bind(jtiHash, userId, new Date().toISOString(), expiresAt)
    .run();
  return {
    access_token: access,
    refresh_token: refresh,
    expires_in: ACCESS_TTL_SECONDS,
    refresh_expires_in: REFRESH_TTL_SECONDS
  };
}

async function revokeRefreshToken(c: any, jti: string): Promise<void> {
  const jtiHash = await hashToken(jti);
  await c.env.DB.prepare('DELETE FROM refresh_tokens WHERE jti_hash = ?').bind(jtiHash).run();
}

async function revokeAllUserRefreshTokens(c: any, userId: string): Promise<void> {
  await c.env.DB.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').bind(userId).run();
}

// ── checkRateLimit (inline, returns {allowed, resetIn}) ───────────────────────

async function checkRateLimit(
  db: D1Database,
  key: string,
  opts: RateLimitOpts = RATE_LIMITS.default
): Promise<{ allowed: boolean; resetIn: number }> {
  const windowKey = `${key}:${Math.floor(Date.now() / (opts.window * 1000))}`;
  try {
    const row = (await db
      .prepare('SELECT requests FROM rate_limits WHERE key = ?')
      .bind(windowKey)
      .first()) as any;

    const count = row ? row.requests + 1 : 1;

    if (count === 1) {
      await db
        .prepare(
          'INSERT OR REPLACE INTO rate_limits (key, requests, reset_at) VALUES (?, 1, datetime("now", ? || " seconds"))'
        )
        .bind(windowKey, String(opts.window))
        .run();
    } else {
      await db
        .prepare('UPDATE rate_limits SET requests = ? WHERE key = ?')
        .bind(count, windowKey)
        .run();
    }

    if (count > opts.limit) {
      const resetIn = opts.window - (Math.floor(Date.now() / 1000) % opts.window);
      return { allowed: false, resetIn };
    }
  } catch {
    // rate-limit failures are non-fatal — allow through
  }
  return { allowed: true, resetIn: 0 };
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
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const userCode = String(body.user_code || '')
    .trim()
    .toUpperCase();
  if (!userCode || userCode.length < 8) {
    return c.json({ error: 'Invalid code' }, 400);
  }

  try {
    const record = (await c.env.DB.prepare(
      `SELECT device_code, status, expires_at FROM device_codes WHERE user_code = ?`
    )
      .bind(userCode)
      .first()) as any;

    if (!record) return c.json({ error: 'Invalid code' }, 404);
    if (record.status !== 'pending') return c.json({ error: 'Code already used' }, 400);
    if (new Date(record.expires_at) < new Date()) {
      await c.env.DB.prepare(`UPDATE device_codes SET status = 'expired' WHERE device_code = ?`)
        .bind(record.device_code)
        .run();
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
    return c.html(
      '<html><body><h1>Authentication failed</h1><p>Missing code or state.</p></body></html>'
    );
  }

  try {
    const record = (await c.env.DB.prepare(
      `SELECT status, expires_at FROM device_codes WHERE device_code = ?`
    )
      .bind(deviceCode)
      .first()) as any;

    if (!record || record.status !== 'pending' || new Date(record.expires_at) < new Date()) {
      return c.html(
        '<html><body><h1>Expired or invalid session</h1><p>Please generate a new code.</p></body></html>'
      );
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
      return c.html(
        `<html><body><h1>GitHub auth failed</h1><p>${tokenData.error_description || tokenData.error}</p></body></html>`
      );
    }

    const accessToken = tokenData.access_token;

    // Fetch GitHub user
    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github.v3+json' }
    });
    const userData = (await userRes.json()) as any;
    const username = userData.login;
    const githubId = String(userData.id);
    const now = new Date().toISOString();

    // Upsert user (GitHub OAuth tokens are never persisted)
    await c.env.DB.prepare(
      `INSERT INTO users (id, username, display_name, avatar_url, github_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(github_id) DO UPDATE SET
         updated_at = excluded.updated_at`
    )
      .bind(githubId, username, userData.name || username, userData.avatar_url, githubId, now, now)
      .run();

    // Mark device code as authorized; store github_id so /auth/device/token can find the user
    await c.env.DB.prepare(
      `UPDATE device_codes SET status = 'authorized', github_id = ? WHERE device_code = ?`
    )
      .bind(githubId, deviceCode)
      .run();

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
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const deviceCode = String(body.device_code || '').trim();
  if (!deviceCode) return c.json({ error: 'device_code required' }, 400);

  try {
    const record = (await c.env.DB.prepare(
      `SELECT status, github_id, expires_at FROM device_codes WHERE device_code = ?`
    )
      .bind(deviceCode)
      .first()) as any;

    if (!record) return c.json({ error: 'Invalid device_code' }, 404);

    if (new Date(record.expires_at) < new Date()) {
      await c.env.DB.prepare(`UPDATE device_codes SET status = 'expired' WHERE device_code = ?`)
        .bind(deviceCode)
        .run();
      return c.json({ error: 'expired' }, 400);
    }

    if (record.status === 'pending') {
      return c.json({ error: 'authorization_pending' }, 400);
    }

    if (record.status === 'authorized' && record.github_id) {
      const user = (await c.env.DB.prepare('SELECT id FROM users WHERE github_id = ?')
        .bind(record.github_id)
        .first()) as any;

      if (!user) {
        return c.json({ error: 'User not found' }, 404);
      }

      // Mark as completed (one-time use)
      await c.env.DB.prepare(`UPDATE device_codes SET status = 'completed' WHERE device_code = ?`)
        .bind(deviceCode)
        .run();

      const tokens = await mintTokenPair(c, user.id);
      return c.json({ ...tokens, token_type: 'Bearer' });
    }

    return c.json({ error: 'authorization_pending' }, 400);
  } catch (e) {
    console.error('POST /auth/device/token error:', e);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// ── Require user middleware (JWT access token only) ──────────────────────────

async function requireUser(c: any): Promise<AuthUser | Response> {
  const authHeader = c.req.header('authorization') || '';
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
  const token = bearer || getCookie(c, 'agora_access');
  if (!token) return c.json({ error: 'Authentication required' }, 401);

  const payload = await verifyJwt(token, c.env.AUTH_SECRET);
  if (!payload || payload.type !== 'access' || !payload.sub) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  const user = (await c.env.DB.prepare(
    'SELECT id, username, display_name, avatar_url FROM users WHERE id = ?'
  )
    .bind(String(payload.sub))
    .first()) as any;
  if (!user) return c.json({ error: 'User not found' }, 401);

  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    avatarUrl: user.avatar_url
  };
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
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
  const rl = await checkRateLimit(c.env.DB, `ip:${ip}`, RATE_LIMITS.write);
  if (!rl.allowed) return c.json({ error: 'Rate limit exceeded', resetIn: rl.resetIn }, 429);

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
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
  const rl = await checkRateLimit(c.env.DB, `ip:${ip}`, RATE_LIMITS.write);
  if (!rl.allowed) return c.json({ error: 'Rate limit exceeded', resetIn: rl.resetIn }, 429);

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

app.post('/api/marketplace/flag/:id', async (c) => {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
  const rl = await checkRateLimit(c.env.DB, `ip:${ip}`, RATE_LIMITS.write);
  if (!rl.allowed) return c.json({ error: 'Rate limit exceeded', resetIn: rl.resetIn }, 429);

  const user = await requireUser(c);
  if (isResponse(user)) return user;

  const targetId = c.req.param('id');
  if (!targetId) return c.json({ error: 'Missing target id' }, 400);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const targetType = String(body.targetType || '').trim();
  if (targetType !== 'package' && targetType !== 'workflow') {
    return c.json({ error: 'targetType must be package or workflow' }, 400);
  }

  const reason = String(body.reason || '').trim();
  const validReasons = ['spam', 'harassment', 'undisclosed-llm', 'malicious', 'other'];
  if (!validReasons.includes(reason)) {
    return c.json({ error: 'Invalid reason' }, 400);
  }

  const notes = body.notes ? String(body.notes).slice(0, 500) : null;

  try {
    const existing = await c.env.DB.prepare(
      'SELECT id FROM flags WHERE reporter_id = ? AND target_id = ? AND target_type = ?'
    )
      .bind(user.id, targetId, targetType)
      .first();
    if (existing) {
      return c.json({ success: true, deduplicated: true });
    }

    const id = `flag-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    await c.env.DB.prepare(
      `INSERT INTO flags (id, target_id, target_type, reporter_id, reason, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    )
      .bind(id, targetId, targetType, user.id, reason, notes)
      .run();

    return c.json({ success: true });
  } catch (e) {
    console.error('POST /api/marketplace/flag/:id error:', e);
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
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
  const rl = await checkRateLimit(c.env.DB, `ip:${ip}`, RATE_LIMITS.write);
  if (!rl.allowed) return c.json({ error: 'Rate limit exceeded', resetIn: rl.resetIn }, 429);

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

// ── Community hub endpoints ───────────────────────────────────────────────────

const COMMUNITY_BOARD_IDS = ['mcp', 'agents', 'tools', 'workflows', 'show', 'ask', 'meta'];

app.get('/api/community/boards', async (c) => {
  const yesterday = Date.now() - 86400000;
  const yesterdayIso = new Date(yesterday).toISOString();
  try {
    const { results } = (await c.env.DB.prepare(
      `SELECT board,
              COUNT(*) AS thread_count,
              COUNT(CASE WHEN created_at > ? THEN 1 END) AS new_today
       FROM discussions
       WHERE hidden = 0
       GROUP BY board`
    )
      .bind(yesterdayIso)
      .all()) as any;

    const rowMap = new Map<string, { thread_count: number; new_today: number }>();
    for (const row of results ?? []) {
      rowMap.set(row.board, { thread_count: row.thread_count, new_today: row.new_today });
    }

    const boards = COMMUNITY_BOARD_IDS.map((id) => {
      const row = rowMap.get(id);
      return { id, threadCount: row?.thread_count ?? 0, newToday: row?.new_today ?? 0 };
    });

    return c.json({ boards });
  } catch (e) {
    console.error('GET /api/community/boards error:', e);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.get('/api/community/threads', async (c) => {
  const board = c.req.query('board') ?? '';
  const sort = c.req.query('sort') ?? 'active';
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const PAGE_SIZE = 25;

  if (!COMMUNITY_BOARD_IDS.includes(board)) {
    return c.json({ error: 'Invalid board' }, 400);
  }

  let orderBy: string;
  if (sort === 'new') {
    orderBy = 'created_at DESC';
  } else if (sort === 'top') {
    orderBy = 'score DESC, created_at DESC';
  } else {
    orderBy = 'updated_at DESC';
  }

  try {
    const offset = (page - 1) * PAGE_SIZE;
    const { results } = (await c.env.DB.prepare(
      `SELECT d.*,
              (SELECT COUNT(*) FROM flags f WHERE f.target_id = d.id AND f.target_type = 'discussion') AS computed_flag_count
       FROM discussions d
       WHERE d.board = ? AND d.hidden = 0
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`
    )
      .bind(board, PAGE_SIZE + 1, offset)
      .all()) as any;

    const rows = results ?? [];
    const hasMore = rows.length > PAGE_SIZE;
    const threads = rows.slice(0, PAGE_SIZE).map((r: any) => ({
      id: r.id,
      board: r.board,
      title: r.title,
      author: r.author,
      content: r.content,
      score: r.score,
      replyCount: r.reply_count,
      flagCount: r.computed_flag_count ?? r.flag_count ?? 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      authorIsLLM: Boolean(r.author_is_llm),
      authorModel: r.author_model ?? undefined
    }));

    return c.json({ threads, page, hasMore });
  } catch (e) {
    console.error('GET /api/community/threads error:', e);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.get('/api/community/thread/:id', async (c) => {
  const threadId = c.req.param('id');
  if (!threadId) return c.json({ error: 'Missing thread id' }, 400);

  try {
    const row = (await c.env.DB.prepare(
      `SELECT d.*,
              (SELECT COUNT(*) FROM flags f WHERE f.target_id = d.id AND f.target_type = 'discussion') AS computed_flag_count
       FROM discussions d WHERE d.id = ?`
    )
      .bind(threadId)
      .first()) as any;

    if (!row || row.hidden === 1) return c.json({ error: 'Thread not found' }, 404);

    const thread = {
      id: row.id,
      board: row.board,
      title: row.title,
      author: row.author,
      content: row.content,
      score: row.score,
      replyCount: row.reply_count,
      flagCount: row.computed_flag_count ?? row.flag_count ?? 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      authorIsLLM: Boolean(row.author_is_llm),
      authorModel: row.author_model ?? undefined
    };

    const { results: replyRows } = (await c.env.DB.prepare(
      `SELECT r.*,
              (SELECT COUNT(*) FROM flags f WHERE f.target_id = r.id AND f.target_type = 'reply') AS computed_flag_count
       FROM discussion_replies r
       WHERE r.discussion_id = ?
       ORDER BY r.created_at ASC`
    )
      .bind(threadId)
      .all()) as any;

    const rawReplies = (replyRows ?? []).map((r: any) => ({
      id: r.id,
      threadId: r.discussion_id,
      parentId: r.parent_id ?? undefined,
      author: r.author,
      content: r.content,
      score: r.score,
      flagCount: r.computed_flag_count ?? r.flag_count ?? 0,
      createdAt: r.created_at,
      authorIsLLM: Boolean(r.author_is_llm),
      authorModel: r.author_model ?? undefined
    }));

    const replies = buildReplyTree(rawReplies);

    return c.json({ thread, replies });
  } catch (e) {
    console.error('GET /api/community/thread/:id error:', e);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

function buildReplyTree(replies: any[]): any[] {
  const map = new Map<string, any>();
  const roots: any[] = [];
  for (const r of replies) map.set(r.id, { ...r, children: [] });
  for (const r of replies) {
    const node = map.get(r.id)!;
    if (r.parentId && map.has(r.parentId)) {
      map.get(r.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

app.post('/api/community/threads', async (c) => {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
  const rl = await checkRateLimit(c.env.DB, `ip:${ip}`, RATE_LIMITS.write);
  if (!rl.allowed) return c.json({ error: 'Rate limit exceeded', resetIn: rl.resetIn }, 429);

  const user = await requireUser(c);
  if (isResponse(user)) return user;

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const board = String(body.board || '').trim();
  const title = String(body.title || '').trim();
  const content = String(body.content || '').trim();

  if (!COMMUNITY_BOARD_IDS.includes(board)) return c.json({ error: 'Invalid board' }, 400);
  if (title.length < 1 || title.length > 200)
    return c.json({ error: 'title must be 1-200 chars' }, 400);
  if (content.length < 1 || content.length > 10000)
    return c.json({ error: 'content must be 1-10000 chars' }, 400);

  try {
    const userRow = (await c.env.DB.prepare('SELECT is_llm, llm_model FROM users WHERE id = ?')
      .bind(user.id)
      .first()) as any;

    const authorIsLlm = userRow?.is_llm ? 1 : 0;
    const authorModel = userRow?.llm_model ?? null;

    const slug = crypto.randomUUID().slice(0, 8);
    const id = `thr-${Date.now()}-${slug}`;
    const now = new Date().toISOString();

    await c.env.DB.prepare(
      `INSERT INTO discussions (id, board, title, content, author, score, reply_count, flag_count, hidden, author_is_llm, author_model, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?, ?, ?)`
    )
      .bind(id, board, title, content, user.username, authorIsLlm, authorModel, now, now)
      .run();

    const thread = {
      id,
      board,
      title,
      author: user.username,
      content,
      score: 0,
      replyCount: 0,
      flagCount: 0,
      createdAt: now,
      updatedAt: now,
      authorIsLLM: Boolean(authorIsLlm),
      authorModel: authorModel ?? undefined
    };

    return c.json({ thread }, 201);
  } catch (e) {
    console.error('POST /api/community/threads error:', e);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.post('/api/community/reply/:parentId', async (c) => {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
  const rl = await checkRateLimit(c.env.DB, `ip:${ip}`, RATE_LIMITS.write);
  if (!rl.allowed) return c.json({ error: 'Rate limit exceeded', resetIn: rl.resetIn }, 429);

  const user = await requireUser(c);
  if (isResponse(user)) return user;

  const parentId = c.req.param('parentId');
  if (!parentId) return c.json({ error: 'Missing parentId' }, 400);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const content = String(body.content || '').trim();
  if (content.length < 1 || content.length > 10000)
    return c.json({ error: 'content must be 1-10000 chars' }, 400);

  try {
    // Check if parentId is a thread
    const thread = (await c.env.DB.prepare('SELECT id FROM discussions WHERE id = ?')
      .bind(parentId)
      .first()) as any;

    let discussionId: string;
    let replyParentId: string | null = null;

    if (thread) {
      discussionId = parentId;
    } else {
      // Check if parentId is a reply
      const parentReply = (await c.env.DB.prepare(
        'SELECT id, discussion_id FROM discussion_replies WHERE id = ?'
      )
        .bind(parentId)
        .first()) as any;
      if (!parentReply) return c.json({ error: 'Parent not found' }, 404);
      discussionId = parentReply.discussion_id;
      replyParentId = parentId;
    }

    const userRow = (await c.env.DB.prepare('SELECT is_llm, llm_model FROM users WHERE id = ?')
      .bind(user.id)
      .first()) as any;

    const authorIsLlm = userRow?.is_llm ? 1 : 0;
    const authorModel = userRow?.llm_model ?? null;

    const slug = crypto.randomUUID().slice(0, 8);
    const id = `rpl-${Date.now()}-${slug}`;
    const now = new Date().toISOString();

    await c.env.DB.prepare(
      `INSERT INTO discussion_replies (id, discussion_id, parent_id, author, content, score, flag_count, author_is_llm, author_model, created_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`
    )
      .bind(id, discussionId, replyParentId, user.username, content, authorIsLlm, authorModel, now)
      .run();

    await c.env.DB.prepare(
      `UPDATE discussions SET reply_count = reply_count + 1, updated_at = ? WHERE id = ?`
    )
      .bind(now, discussionId)
      .run();

    const reply = {
      id,
      threadId: discussionId,
      parentId: replyParentId ?? undefined,
      author: user.username,
      content,
      score: 0,
      flagCount: 0,
      createdAt: now,
      authorIsLLM: Boolean(authorIsLlm),
      authorModel: authorModel ?? undefined
    };

    return c.json({ reply }, 201);
  } catch (e) {
    console.error('POST /api/community/reply/:parentId error:', e);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.post('/api/community/vote/:targetId', async (c) => {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
  const rl = await checkRateLimit(c.env.DB, `ip:${ip}`, RATE_LIMITS.write);
  if (!rl.allowed) return c.json({ error: 'Rate limit exceeded', resetIn: rl.resetIn }, 429);

  const user = await requireUser(c);
  if (isResponse(user)) return user;

  const targetId = c.req.param('targetId');
  if (!targetId) return c.json({ error: 'Missing targetId' }, 400);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const targetType = String(body.targetType || '').trim();
  if (targetType !== 'discussion' && targetType !== 'reply') {
    return c.json({ error: 'targetType must be discussion or reply' }, 400);
  }

  const rawValue = Number(body.value);
  if (rawValue !== -1 && rawValue !== 0 && rawValue !== 1) {
    return c.json({ error: 'value must be -1, 0, or 1' }, 400);
  }

  try {
    if (rawValue === 0) {
      await c.env.DB.prepare(
        'DELETE FROM votes WHERE user_id = ? AND target_id = ? AND target_type = ?'
      )
        .bind(user.id, targetId, targetType)
        .run();
    } else {
      await c.env.DB.prepare(
        `INSERT INTO votes (user_id, target_id, target_type, value, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, target_id, target_type) DO UPDATE SET value = excluded.value`
      )
        .bind(user.id, targetId, targetType, rawValue)
        .run();
    }

    const scoreRow = (await c.env.DB.prepare(
      'SELECT COALESCE(SUM(value), 0) AS total FROM votes WHERE target_id = ? AND target_type = ?'
    )
      .bind(targetId, targetType)
      .first()) as any;

    const score = scoreRow?.total ?? 0;

    if (targetType === 'discussion') {
      await c.env.DB.prepare('UPDATE discussions SET score = ? WHERE id = ?')
        .bind(score, targetId)
        .run();
    } else {
      await c.env.DB.prepare('UPDATE discussion_replies SET score = ? WHERE id = ?')
        .bind(score, targetId)
        .run();
    }

    return c.json({ score, userVote: rawValue });
  } catch (e) {
    console.error('POST /api/community/vote/:targetId error:', e);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.post('/api/community/flag/:id', async (c) => {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
  const rl = await checkRateLimit(c.env.DB, `ip:${ip}`, RATE_LIMITS.write);
  if (!rl.allowed) return c.json({ error: 'Rate limit exceeded', resetIn: rl.resetIn }, 429);

  const user = await requireUser(c);
  if (isResponse(user)) return user;

  const targetId = c.req.param('id');
  if (!targetId) return c.json({ error: 'Missing target id' }, 400);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const targetType = String(body.targetType || '').trim();
  if (targetType !== 'discussion' && targetType !== 'reply') {
    return c.json({ error: 'targetType must be discussion or reply' }, 400);
  }

  const reason = String(body.reason || '').trim();
  const validReasons = ['spam', 'harassment', 'undisclosed-llm', 'malicious', 'other'];
  if (!validReasons.includes(reason)) {
    return c.json({ error: 'Invalid reason' }, 400);
  }

  const notes = body.notes ? String(body.notes).slice(0, 500) : null;

  try {
    // Dedup: if this user already flagged this target with any reason, return success without insert.
    const existing = await c.env.DB.prepare(
      'SELECT id FROM flags WHERE reporter_id = ? AND target_id = ? AND target_type = ?'
    )
      .bind(user.id, targetId, targetType)
      .first();
    if (existing) {
      return c.json({ success: true, deduplicated: true });
    }

    const id = `flag-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    await c.env.DB.prepare(
      `INSERT INTO flags (id, target_id, target_type, reporter_id, reason, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    )
      .bind(id, targetId, targetType, user.id, reason, notes)
      .run();

    return c.json({ success: true });
  } catch (e) {
    console.error('POST /api/community/flag/:id error:', e);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// TODO: Switch from LIKE to FTS5 (content tables + triggers) once volume warrants it.
app.get('/api/community/search', async (c) => {
  const q = c.req.query('q') ?? '';
  const boardParam = c.req.query('board') ?? '';
  const limitParam = c.req.query('limit') ?? '';

  if (q.length < 2 || q.length > 200) {
    return c.json({ error: 'q must be between 2 and 200 characters' }, 400);
  }

  if (boardParam && !COMMUNITY_BOARD_IDS.includes(boardParam)) {
    return c.json({ error: 'board must be one of: ' + COMMUNITY_BOARD_IDS.join(', ') }, 400);
  }

  const limit = Math.min(100, Math.max(1, parseInt(limitParam || '25', 10) || 25));

  // User input is passed via .bind() — D1 prepared statement binding handles escaping.
  const pattern = '%' + q.toLowerCase() + '%';

  try {
    const threadConditions = boardParam
      ? 'WHERE d.hidden = 0 AND d.board = ? AND (LOWER(d.title) LIKE ? OR LOWER(d.content) LIKE ?)'
      : 'WHERE d.hidden = 0 AND (LOWER(d.title) LIKE ? OR LOWER(d.content) LIKE ?)';

    const threadBindArgs: (string | number)[] = boardParam
      ? [boardParam, pattern, pattern]
      : [pattern, pattern];

    const { results: threadRows } = (await c.env.DB.prepare(
      `SELECT d.id, d.board, d.title, d.content, d.author, d.score, d.flag_count, d.created_at, d.author_is_llm,
              (SELECT COUNT(*) FROM flags f WHERE f.target_id = d.id AND f.target_type = 'discussion') AS computed_flag_count
       FROM discussions d
       ${threadConditions}
       ORDER BY d.score DESC, d.created_at DESC
       LIMIT ?`
    )
      .bind(...threadBindArgs, limit + 1)
      .all()) as any;

    const threadRowsArr = threadRows ?? [];
    const truncatedThreads = threadRowsArr.length > limit;
    const threadSlice = threadRowsArr.slice(0, limit);

    const threads = threadSlice.map((r: any) => ({
      kind: 'thread' as const,
      id: r.id,
      threadId: r.id,
      board: r.board,
      title: r.title,
      snippet: extractSnippet(r.content, q),
      score: r.score,
      flagCount: r.computed_flag_count ?? r.flag_count ?? 0,
      createdAt: r.created_at,
      author: r.author,
      authorIsLLM: Boolean(r.author_is_llm)
    }));

    const replyConditions = boardParam
      ? `WHERE dr.hidden IS NULL OR dr.hidden = 0`
      : `WHERE dr.hidden IS NULL OR dr.hidden = 0`;

    const replyBoardJoin = boardParam ? 'AND d2.board = ?' : '';
    const replyBindArgs: (string | number)[] = boardParam ? [pattern, boardParam] : [pattern];

    const { results: replyRows } = (await c.env.DB.prepare(
      `SELECT dr.id, dr.discussion_id, dr.author, dr.content, dr.score, dr.flag_count, dr.created_at, dr.author_is_llm,
              d2.board, d2.title AS thread_title,
              (SELECT COUNT(*) FROM flags f WHERE f.target_id = dr.id AND f.target_type = 'reply') AS computed_flag_count
       FROM discussion_replies dr
       JOIN discussions d2 ON d2.id = dr.discussion_id
       WHERE LOWER(dr.content) LIKE ?
         AND d2.hidden = 0
         ${replyBoardJoin}
       ORDER BY dr.score DESC, dr.created_at DESC
       LIMIT ?`
    )
      .bind(...replyBindArgs, limit + 1)
      .all()) as any;

    const replyRowsArr = replyRows ?? [];
    const truncatedReplies = replyRowsArr.length > limit;
    const replySlice = replyRowsArr.slice(0, limit);

    const replies = replySlice.map((r: any) => ({
      kind: 'reply' as const,
      id: r.id,
      threadId: r.discussion_id,
      board: r.board,
      title: r.thread_title,
      snippet: extractSnippet(r.content, q),
      score: r.score,
      flagCount: r.computed_flag_count ?? r.flag_count ?? 0,
      createdAt: r.created_at,
      author: r.author,
      authorIsLLM: Boolean(r.author_is_llm)
    }));

    return c.json({
      query: q,
      results: { threads, replies },
      truncated: truncatedThreads || truncatedReplies
    });
  } catch (e) {
    console.error('GET /api/community/search error:', e);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * Extract a ~120-char snippet from content centred on the first
 * case-insensitive occurrence of query. Matched substring is wrapped with [].
 * Falls back to first 120 chars when no match found in content.
 */
function extractSnippet(content: string, query: string): string {
  if (!content) return '';
  const HALF = 60;
  const MAX = 120;
  const lower = content.toLowerCase();
  const lowerQ = query.toLowerCase();
  const idx = lower.indexOf(lowerQ);
  if (idx === -1) {
    const plain = content.slice(0, MAX);
    return plain.length < content.length ? plain + '…' : plain;
  }
  const start = Math.max(0, idx - HALF);
  const end = Math.min(content.length, idx + query.length + HALF);
  const before = content.slice(start, idx);
  const matched = content.slice(idx, idx + query.length);
  const after = content.slice(idx + query.length, end);
  let snippet = before + '[' + matched + ']' + after;
  if (start > 0) snippet = '…' + snippet;
  if (end < content.length) snippet = snippet + '…';
  return snippet;
}

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
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
  const rl = await checkRateLimit(c.env.DB, `ip:${ip}`, RATE_LIMITS.write);
  if (!rl.allowed) return c.json({ error: 'Rate limit exceeded', resetIn: rl.resetIn }, 429);

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
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
  const rl = await checkRateLimit(c.env.DB, `ip:${ip}`, RATE_LIMITS.default);
  if (!rl.allowed) return c.json({ error: 'Rate limit exceeded', resetIn: rl.resetIn }, 429);

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
