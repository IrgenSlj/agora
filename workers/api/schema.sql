CREATE TABLE IF NOT EXISTS artifacts (
  purl TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  display_name TEXT NOT NULL,
  publisher_namespace TEXT NOT NULL,
  publisher_identity_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS artifact_sources (
  purl TEXT NOT NULL,
  adapter TEXT NOT NULL,
  upstream_id TEXT NOT NULL,
  url TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  PRIMARY KEY (purl, adapter),
  FOREIGN KEY (purl) REFERENCES artifacts(purl) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_artifact_sources_purl ON artifact_sources(purl);
