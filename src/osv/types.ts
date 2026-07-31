// The subset of the OSV schema Agora reads.
//
// https://ossf.github.io/osv-schema/ — captured from live responses on
// 2026-07-31 rather than transcribed from the spec, because the spec permits
// far more than any one database emits and guessing at optional fields is how
// a mapper silently starts producing empty ranges.

/** A version range. OSV events are ordered and sparse; only some keys appear. */
export interface OsvEvent {
  introduced?: string;
  fixed?: string;
  last_affected?: string;
  limit?: string;
}

export interface OsvRange {
  type: 'SEMVER' | 'ECOSYSTEM' | 'GIT' | string;
  events: OsvEvent[];
}

export interface OsvAffected {
  package?: { name?: string; ecosystem?: string; purl?: string };
  ranges?: OsvRange[];
  versions?: string[] | null;
}

export interface OsvVulnerability {
  id: string;
  summary?: string;
  details?: string;
  modified?: string;
  published?: string;
  withdrawn?: string;
  affected?: OsvAffected[];
  references?: { type?: string; url?: string }[];
  severity?: { type?: string; score?: string }[];
  /**
   * Where GitHub's own severity label lives. The top-level `severity` array
   * carries a raw CVSS vector, which is precise but useless without a parser;
   * `database_specific.severity` is the human label OSV surfaces in its UI.
   */
  database_specific?: {
    severity?: string;
    cwe_ids?: string[];
    [key: string]: unknown;
  };
}

export interface OsvQueryResponse {
  vulns?: OsvVulnerability[];
}

export interface OsvBatchResponse {
  /** Positionally aligned with the queries sent — never keyed by package. */
  results?: { vulns?: Pick<OsvVulnerability, 'id' | 'modified'>[] }[];
}
