import { z } from 'zod';

/**
 * Transport type for MCP servers.
 * Source: AGORA_BRIEF_v2.md §5.2
 */
export const Transport = z.enum(['stdio', 'streamable-http']);
export type Transport = z.infer<typeof Transport>;

/**
 * Authentication model for an artifact.
 * Source: AGORA_BRIEF_v2.md §5.2
 */
export const AuthModel = z.enum(['none', 'static-key', 'oauth2.1', 'oidc', 'unknown']);
export type AuthModel = z.infer<typeof AuthModel>;

/**
 * Source of a declared capability — where the information came from.
 * Source: AGORA_BRIEF_v2.md §5.2
 */
export const ManifestSource = z.enum(['registry', 'handshake', 'inferred']);
export type ManifestSource = z.infer<typeof ManifestSource>;

/**
 * A tool declared by an artifact — from tools/list handshake or metadata.
 * Source: AGORA_BRIEF_v2.md §5.2
 */
export const DeclaredTool = z
  .object({
    name: z.string().describe('Tool name as reported by the artifact'),
    description_sha256: z.string().describe('SHA-256 hash of the raw description text'),
    input_schema_sha256: z.string().describe('JCS (RFC 8785) hash of the JSON schema for inputs'),
    annotations: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Optional annotations from the artifact'),
    source: ManifestSource.describe('Where this tool declaration came from')
  })
  .describe("A declared tool from the artifact's capability manifest");
export type DeclaredTool = z.infer<typeof DeclaredTool>;

/**
 * Declared capability buckets — coarse, policy-addressable capabilities.
 * Source: AGORA_BRIEF_v2.md §5.2
 */
export const DeclaredCapabilities = z
  .object({
    fs_read: z.boolean().describe('Can read files from the filesystem'),
    fs_write: z.boolean().describe('Can write files to the filesystem'),
    net_egress: z.array(z.string()).describe("Hostnames contacted, or ['*'] for any"),
    exec: z.boolean().describe('Spawns processes'),
    credentials: z.array(z.string()).describe('Environment variable names requested')
  })
  .describe('Coarse capability declarations for policy evaluation');
export type DeclaredCapabilities = z.infer<typeof DeclaredCapabilities>;

/**
 * DeclaredManifest — what the artifact claims about itself.
 * Built from three inputs: registry metadata, tools/list handshake, and LLM extraction.
 * Source: AGORA_BRIEF_v2.md §5.2
 */
export const DeclaredManifest = z
  .object({
    purl: z.string().describe('Package URL — matches the ArtifactRef'),
    version: z.string().describe('Semantic version'),
    transports: z.array(Transport).describe('Supported MCP transports'),
    auth_model: AuthModel.describe('How the artifact authenticates'),
    tools: z.array(DeclaredTool).describe('Tools declared by the artifact'),
    declared_capabilities: DeclaredCapabilities,
    manifest_sha256: z
      .string()
      .describe('JCS (RFC 8785) hash of everything above — the rug-pull tripwire')
  })
  .describe('What the artifact declares about itself (AGORA_BRIEF_v2.md §5.2)');
export type DeclaredManifest = z.infer<typeof DeclaredManifest>;
