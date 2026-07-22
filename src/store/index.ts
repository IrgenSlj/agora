import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { createHash } from 'crypto';

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
function ensureAgoraDir(): void {
  if (!existsSync(AGORA_DIR)) {
    mkdirSync(AGORA_DIR, { recursive: true });
  }
  if (!existsSync(CAS_DIR)) {
    mkdirSync(CAS_DIR, { recursive: true });
  }
}

/**
 * Database manager for Agora's SQLite store.
 * Source: AGORA_BRIEF_v2.md §5.13
 */
export class AgoraStore {
  private db: Database.Database;

  constructor(dbPath: string = DB_PATH) {
    ensureAgoraDir();
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
    ensureAgoraDir();
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

// Export singleton instances for convenience
export const store = new AgoraStore();
export const cas = new CASCache();
