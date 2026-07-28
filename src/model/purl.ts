import { PackageURL } from 'packageurl-js';

/**
 * Parse a purl string into its components.
 * Source: AGORA_BRIEF_v2.md §5.1 (D16)
 */
export function parsePurl(purl: string): {
  type: string;
  namespace?: string;
  name: string;
  version?: string;
  qualifiers?: Record<string, string>;
  subpath?: string;
} {
  const parsed = PackageURL.fromString(purl);
  return {
    type: parsed.type,
    namespace: parsed.namespace || undefined,
    name: parsed.name,
    version: parsed.version || undefined,
    qualifiers: parsed.qualifiers || undefined,
    subpath: parsed.subpath || undefined
  };
}

/**
 * Build a purl string from components.
 * Source: AGORA_BRIEF_v2.md §5.1 (D16)
 */
export function buildPurl(components: {
  type: string;
  namespace?: string;
  name: string;
  version?: string;
  qualifiers?: Record<string, string>;
  subpath?: string;
}): string {
  const purl = new PackageURL(
    components.type,
    components.namespace || null,
    components.name,
    components.version || null,
    components.qualifiers || null,
    components.subpath || null
  );
  return purl.toString();
}

/**
 * Validate a purl string.
 * Returns true if valid, false otherwise.
 */
export function isValidPurl(purl: string): boolean {
  try {
    PackageURL.fromString(purl);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a purl pattern for revocation matching.
 * Matches all versions unless a specific version is provided.
 */
export function purlToRevocationPattern(purl: string): string {
  const parsed = parsePurl(purl);
  // Rebuild without version
  return buildPurl({
    type: parsed.type,
    namespace: parsed.namespace,
    name: parsed.name
  });
}
