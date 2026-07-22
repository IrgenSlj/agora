import { createHash } from 'node:crypto';
import canonicalize from 'canonicalize';
import type { DeclaredManifest } from './manifest.js';

export function canonicalJson(value: unknown): string {
  const canonical = canonicalize(value);
  if (typeof canonical !== 'string') {
    throw new Error('Value cannot be canonicalized as JSON');
  }
  return canonical;
}

export function sha256Hex(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashJson(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export function hashText(value: string): string {
  return sha256Hex(value);
}

export function hashDeclaredManifest(manifest: DeclaredManifest): string {
  const { manifest_sha256: _manifestSha256, ...hashable } = manifest;
  return hashJson(hashable);
}
