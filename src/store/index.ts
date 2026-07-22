import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';

/**
 * Default path for the Agora database.
 * Source: AGORA_BRIEF_v2.md §5.13
 */
const AGORA_DIR = join(homedir(), '.agora');
const DB_PATH = join(AGORA_DIR, 'agora.db');
const CAS_DIR = join(AGORA_DIR, 'cas');

/**
 * Ensure the Agora directory structure exists.
 */
function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

/**
 * Database manager for Agora's SQLite store.
 * Source: AGORA_BRIEF_v2.md §5.13
 */
export class AgoraStore {
  private db: Database.Database;

  constructor(dbPath: string = DB_PATH) {
    ensureDir(dirname(dbPath));
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initialize();
  }

  /**
   * Initialize database schema.
   */
  private initialize(): void {
    this.db.exec(`
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

      CREATE TABLE IF NOT EXISTS source_items (
        source TEXT NOT NULL,
        upstream_id TEXT NOT NULL,
        purl TEXT,
        item_sha256 TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (source, upstream_id),
        FOREIGN KEY (purl) REFERENCES artifacts(purl) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS manifests (
        purl TEXT NOT NULL,
        version TEXT NOT NULL,
        manifest_sha256 TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (purl, version)
      );

      CREATE TABLE IF NOT EXISTS observed_profiles (
        purl TEXT NOT NULL,
        version TEXT NOT NULL,
        vet_level TEXT NOT NULL,
        backend TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (purl, version)
      );

      CREATE TABLE IF NOT EXISTS attestations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        purl TEXT NOT NULL,
        version TEXT NOT NULL,
        predicate_type TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_attestations_purl ON attestations(purl);
      CREATE INDEX IF NOT EXISTS idx_attestations_predicate ON attestations(predicate_type);
      CREATE INDEX IF NOT EXISTS idx_source_items_purl ON source_items(purl);
    `);
  }

  /**
   * Store an artifact reference.
   */
  upsertArtifact(artifact: {
    purl: string;
    kind: string;
    display_name: string;
    publisher: { namespace: string; identity_verified: boolean };
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO artifacts (purl, kind, display_name, publisher_namespace, publisher_identity_verified)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(purl) DO UPDATE SET
        kind = excluded.kind,
        display_name = excluded.display_name,
        publisher_namespace = excluded.publisher_namespace,
        publisher_identity_verified = excluded.publisher_identity_verified,
        updated_at = datetime('now')
    `);
    stmt.run(
      artifact.purl,
      artifact.kind,
      artifact.display_name,
      artifact.publisher.namespace,
      artifact.publisher.identity_verified ? 1 : 0
    );
  }

  /**
   * Get an artifact by purl.
   */
  getArtifact(purl: string): {
    purl: string;
    kind: string;
    display_name: string;
    publisher_namespace: string;
    publisher_identity_verified: boolean;
  } | null {
    const stmt = this.db.prepare('SELECT * FROM artifacts WHERE purl = ?');
    const row = stmt.get(purl) as
      | {
          purl: string;
          kind: string;
          display_name: string;
          publisher_namespace: string;
          publisher_identity_verified: number;
        }
      | undefined;
    if (!row) return null;
    return {
      ...row,
      publisher_identity_verified: row.publisher_identity_verified === 1
    };
  }

  /**
   * Store a source reference for an artifact without changing first_seen on refresh.
   */
  upsertArtifactSource(source: {
    purl: string;
    adapter: string;
    upstream_id: string;
    url: string;
    first_seen: string;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO artifact_sources (purl, adapter, upstream_id, url, first_seen)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(purl, adapter) DO UPDATE SET
        upstream_id = excluded.upstream_id,
        url = excluded.url
    `);
    stmt.run(source.purl, source.adapter, source.upstream_id, source.url, source.first_seen);
  }

  /**
   * Get source references for an artifact.
   */
  getArtifactSources(purl: string): Array<{
    purl: string;
    adapter: string;
    upstream_id: string;
    url: string;
    first_seen: string;
  }> {
    const stmt = this.db.prepare(
      'SELECT purl, adapter, upstream_id, url, first_seen FROM artifact_sources WHERE purl = ? ORDER BY adapter'
    );
    return stmt.all(purl) as Array<{
      purl: string;
      adapter: string;
      upstream_id: string;
      url: string;
      first_seen: string;
    }>;
  }

  /**
   * Remove a source reference and prune the artifact if it no longer has sources.
   */
  deleteArtifactSource(purl: string, adapter: string): void {
    const deleteSource = this.db.prepare(
      'DELETE FROM artifact_sources WHERE purl = ? AND adapter = ?'
    );
    const deleteOrphan = this.db.prepare(`
      DELETE FROM artifacts
      WHERE purl = ?
        AND NOT EXISTS (SELECT 1 FROM artifact_sources WHERE purl = ?)
    `);
    const tx = this.db.transaction(() => {
      deleteSource.run(purl, adapter);
      deleteOrphan.run(purl, purl);
    });
    tx();
  }

  /**
   * Index one full source item payload stored in CAS.
   */
  upsertSourceItem(item: {
    source: string;
    upstream_id: string;
    purl?: string;
    item_sha256: string;
    fetched_at: string;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO source_items (source, upstream_id, purl, item_sha256, fetched_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(source, upstream_id) DO UPDATE SET
        purl = excluded.purl,
        item_sha256 = excluded.item_sha256,
        fetched_at = excluded.fetched_at,
        updated_at = datetime('now')
    `);
    stmt.run(item.source, item.upstream_id, item.purl ?? null, item.item_sha256, item.fetched_at);
  }

  /**
   * Remove one source item index entry.
   */
  deleteSourceItem(source: string, upstreamId: string): void {
    const stmt = this.db.prepare('DELETE FROM source_items WHERE source = ? AND upstream_id = ?');
    stmt.run(source, upstreamId);
  }

  /**
   * List source item CAS references for a source.
   */
  listSourceItems(source: string): Array<{
    source: string;
    upstream_id: string;
    purl: string | null;
    item_sha256: string;
    fetched_at: string;
  }> {
    const stmt = this.db.prepare(`
      SELECT source, upstream_id, purl, item_sha256, fetched_at
      FROM source_items
      WHERE source = ?
      ORDER BY upstream_id
    `);
    return stmt.all(source) as Array<{
      source: string;
      upstream_id: string;
      purl: string | null;
      item_sha256: string;
      fetched_at: string;
    }>;
  }

  /**
   * Store a declared manifest.
   */
  upsertManifest(purl: string, version: string, manifestSha256: string, data: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO manifests (purl, version, manifest_sha256, data)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(purl, version) DO UPDATE SET
        manifest_sha256 = excluded.manifest_sha256,
        data = excluded.data
    `);
    stmt.run(purl, version, manifestSha256, data);
  }

  /**
   * Get a manifest by purl and version.
   */
  getManifest(purl: string, version: string): { manifest_sha256: string; data: string } | null {
    const stmt = this.db.prepare(
      'SELECT manifest_sha256, data FROM manifests WHERE purl = ? AND version = ?'
    );
    const row = stmt.get(purl, version) as { manifest_sha256: string; data: string } | undefined;
    return row || null;
  }

  /**
   * Store an observed profile.
   */
  upsertObservedProfile(
    purl: string,
    version: string,
    vetLevel: string,
    backend: string,
    data: string
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO observed_profiles (purl, version, vet_level, backend, data)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(purl, version) DO UPDATE SET
        vet_level = excluded.vet_level,
        backend = excluded.backend,
        data = excluded.data
    `);
    stmt.run(purl, version, vetLevel, backend, data);
  }

  /**
   * Get an observed profile by purl and version.
   */
  getObservedProfile(purl: string, version: string): string | null {
    const stmt = this.db.prepare(
      'SELECT data FROM observed_profiles WHERE purl = ? AND version = ?'
    );
    const row = stmt.get(purl, version) as { data: string } | undefined;
    return row?.data || null;
  }

  /**
   * Store an attestation.
   */
  addAttestation(purl: string, version: string, predicateType: string, data: string): number {
    const stmt = this.db.prepare(`
      INSERT INTO attestations (purl, version, predicate_type, data)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(purl, version, predicateType, data);
    return Number(result.lastInsertRowid);
  }

  /**
   * Get attestations for an artifact.
   */
  getAttestations(purl: string): Array<{
    id: number;
    version: string;
    predicate_type: string;
    data: string;
  }> {
    const stmt = this.db.prepare(
      'SELECT id, version, predicate_type, data FROM attestations WHERE purl = ?'
    );
    return stmt.all(purl) as Array<{
      id: number;
      version: string;
      predicate_type: string;
      data: string;
    }>;
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }
}

/**
 * CAS (Content-Addressable Storage) blob cache.
 * Source: AGORA_BRIEF_v2.md §5.13
 */
export class CASCache {
  private casDir: string;

  constructor(casDir: string = CAS_DIR) {
    ensureDir(casDir);
    this.casDir = casDir;
  }

  /**
   * Compute SHA-256 hash of content.
   */
  static sha256(content: Buffer | string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Store a blob in the CAS.
   * Returns the SHA-256 hash.
   */
  put(content: Buffer | string): string {
    const hash = CASCache.sha256(content);
    const blobPath = join(this.casDir, hash);
    if (!existsSync(blobPath)) {
      writeFileSync(blobPath, content);
    }
    return hash;
  }

  /**
   * Retrieve a blob from the CAS by its hash.
   * Returns null if not found.
   */
  get(hash: string): Buffer | null {
    const blobPath = join(this.casDir, hash);
    if (!existsSync(blobPath)) {
      return null;
    }
    return readFileSync(blobPath);
  }

  /**
   * Check if a blob exists in the CAS.
   */
  has(hash: string): boolean {
    const blobPath = join(this.casDir, hash);
    return existsSync(blobPath);
  }

  /**
   * Get the path to a blob in the CAS.
   */
  path(hash: string): string {
    return join(this.casDir, hash);
  }
}

let defaultStoreInstance: AgoraStore | undefined;
let defaultCasInstance: CASCache | undefined;

export function getDefaultStore(): AgoraStore {
  defaultStoreInstance ??= new AgoraStore();
  return defaultStoreInstance;
}

export function getDefaultCas(): CASCache {
  defaultCasInstance ??= new CASCache();
  return defaultCasInstance;
}

// Lazy compatibility exports. Importing src/store must not create ~/.agora.
export const store = new Proxy({} as AgoraStore, {
  get(_target, property, receiver) {
    const target = getDefaultStore();
    const value = Reflect.get(target, property, receiver);
    return typeof value === 'function' ? value.bind(target) : value;
  }
});

export const cas = new Proxy({} as CASCache, {
  get(_target, property, receiver) {
    const target = getDefaultCas();
    const value = Reflect.get(target, property, receiver);
    return typeof value === 'function' ? value.bind(target) : value;
  }
});
