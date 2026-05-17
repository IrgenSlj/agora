-- Agora Backend Database Schema v2
-- BREAKING CHANGE: github_access_token column removed from users; refresh_tokens table added (OAuth token pair model).
-- Run this against Cloudflare D1

-- Users table
-- NOTE: GitHub OAuth tokens are never persisted after this schema version.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  bio TEXT,
  avatar_url TEXT,
  github_id TEXT UNIQUE,
  is_llm INTEGER NOT NULL DEFAULT 0,
  llm_model TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_github ON users(github_id);

-- Packages table
CREATE TABLE IF NOT EXISTS packages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  author TEXT NOT NULL,
  version TEXT,
  category TEXT NOT NULL DEFAULT 'mcp',
  tags TEXT,
  stars INTEGER NOT NULL DEFAULT 0,
  installs INTEGER NOT NULL DEFAULT 0,
  repository TEXT,
  npm_package TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_packages_name ON packages(name);
CREATE INDEX IF NOT EXISTS idx_packages_category ON packages(category);
CREATE INDEX IF NOT EXISTS idx_packages_stars ON packages(stars DESC);

-- Workflows table
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  author TEXT NOT NULL,
  prompt TEXT,
  model TEXT,
  tags TEXT,
  stars INTEGER NOT NULL DEFAULT 0,
  forks INTEGER NOT NULL DEFAULT 0,
  is_featured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_workflows_name ON workflows(name);
CREATE INDEX IF NOT EXISTS idx_workflows_stars ON workflows(stars DESC);

-- Discussions table (boards: mcp, agents, tools, workflows, show, ask, meta)
CREATE TABLE IF NOT EXISTS discussions (
  id TEXT PRIMARY KEY,
  board TEXT NOT NULL DEFAULT 'meta',
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  author TEXT NOT NULL,
  parent_id TEXT,
  score INTEGER NOT NULL DEFAULT 0,
  flag_count INTEGER NOT NULL DEFAULT 0,
  reply_count INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  author_is_llm INTEGER NOT NULL DEFAULT 0,
  author_model TEXT,
  category TEXT NOT NULL DEFAULT 'discussion',
  package_id TEXT,
  workflow_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_discussions_author ON discussions(author);
CREATE INDEX IF NOT EXISTS idx_discussions_category ON discussions(category);
CREATE INDEX IF NOT EXISTS idx_discussions_created ON discussions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_discussions_board ON discussions(board, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_discussions_parent ON discussions(parent_id);

-- Discussion replies (nested tree via parent_id)
CREATE TABLE IF NOT EXISTS discussion_replies (
  id TEXT PRIMARY KEY,
  discussion_id TEXT NOT NULL,
  parent_id TEXT,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  flag_count INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  author_is_llm INTEGER NOT NULL DEFAULT 0,
  author_model TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (discussion_id) REFERENCES discussions(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES discussion_replies(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_replies_discussion ON discussion_replies(discussion_id);
CREATE INDEX IF NOT EXISTS idx_replies_parent ON discussion_replies(parent_id);

-- Votes (user × target, ±1)
CREATE TABLE IF NOT EXISTS votes (
  user_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('discussion', 'reply')),
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, target_id, target_type)
);

CREATE INDEX IF NOT EXISTS idx_votes_target ON votes(target_id, target_type);

-- Flags (community-driven moderation)
CREATE TABLE IF NOT EXISTS flags (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('discussion', 'reply', 'package', 'workflow')),
  reporter_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('spam', 'harassment', 'undisclosed-llm', 'malicious', 'other')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_flags_target ON flags(target_id, target_type);

-- Kill switch (admin-only, for confirmed malware/CSAM)
CREATE TABLE IF NOT EXISTS kill_switch_log (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  acted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kill_switch_target ON kill_switch_log(target_id);

-- Reviews table
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  author TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  content TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reviews_item ON reviews(item_id, item_type);

-- Tutorials table
CREATE TABLE IF NOT EXISTS tutorials (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  level TEXT NOT NULL DEFAULT 'beginner',
  duration TEXT,
  steps TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Trending cache table
CREATE TABLE IF NOT EXISTS trending_cache (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  items TEXT NOT NULL,
  cached_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Package stats for analytics
CREATE TABLE IF NOT EXISTS package_stats (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,
  daily_stars INTEGER NOT NULL DEFAULT 0,
  daily_installs INTEGER NOT NULL DEFAULT 0,
  weekly_stars INTEGER NOT NULL DEFAULT 0,
  weekly_installs INTEGER NOT NULL DEFAULT 0,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- User followers
CREATE TABLE IF NOT EXISTS followers (
  follower_username TEXT NOT NULL,
  following_username TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (follower_username, following_username)
);

-- API rate limiting
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  requests INTEGER NOT NULL DEFAULT 0,
  reset_at TEXT NOT NULL
);

-- Refresh tokens (rotating, 90d, server-side tracked by sha256(jti))
CREATE TABLE IF NOT EXISTS refresh_tokens (
  jti_hash TEXT PRIMARY KEY,           -- sha256(jti), base64url
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);

-- Device codes for OAuth device-code login flow
CREATE TABLE IF NOT EXISTS device_codes (
  device_code TEXT PRIMARY KEY,
  user_code TEXT UNIQUE NOT NULL,
  client_id TEXT NOT NULL DEFAULT 'agora-cli',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'authorized', 'expired', 'completed')),
  github_id TEXT,  -- set during /auth/device/callback; consumed by /auth/device/token to mint the JWT pair
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  verified_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_device_codes_user_code ON device_codes(user_code);
CREATE INDEX IF NOT EXISTS idx_device_codes_status ON device_codes(status);

-- Migrations applied to existing D1 instances (run manually via wrangler d1 execute):
-- ALTER TABLE discussions ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE discussions ADD COLUMN author_is_llm INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE discussions ADD COLUMN author_model TEXT;
-- (users.is_llm and users.llm_model already present in schema above)
-- (discussion_replies.author_is_llm and author_model already present in schema above)
-- (votes PRIMARY KEY (user_id, target_id, target_type) serves as unique constraint)
-- ALTER TABLE discussion_replies ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0; -- 2026-05-17 auto-hide trigger