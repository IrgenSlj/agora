import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { hashDeclaredManifest, hashJson, hashText } from '../src/model/hash';
import type { DeclaredManifest } from '../src/model/manifest';
import { buildPurl, parsePurl, purlToRevocationPattern } from '../src/model/purl';
import { MODEL_SCHEMAS } from '../src/model/schema-registry';

const ROOT = join(import.meta.dirname, '..');

function sampleManifest(): DeclaredManifest {
  const manifest: DeclaredManifest = {
    purl: 'pkg:npm/agora-test-server@1.0.0',
    version: '1.0.0',
    transports: ['stdio'],
    auth_model: 'none',
    tools: [
      {
        name: 'echo',
        description_sha256: hashText('Echo text'),
        input_schema_sha256: hashJson({ type: 'object', properties: { text: { type: 'string' } } }),
        source: 'handshake'
      }
    ],
    declared_capabilities: {
      fs_read: false,
      fs_write: false,
      net_egress: [],
      exec: false,
      credentials: []
    },
    manifest_sha256: ''
  };
  return { ...manifest, manifest_sha256: hashDeclaredManifest(manifest) };
}

describe('model contracts', () => {
  test('generated JSON schemas are current with the schema registry', () => {
    for (const { name, schema } of MODEL_SCHEMAS) {
      const path = join(ROOT, 'schemas', `${name}.v1.json`);
      const generated = readFileSync(path, 'utf8');
      const expected = `${JSON.stringify(z.toJSONSchema(schema), null, 2)}\n`;
      expect(generated, `${name}.v1.json`).toBe(expected);
    }
  });

  test('JCS hashing is deterministic for object key order', () => {
    expect(hashJson({ b: 2, a: { d: 4, c: 3 } })).toBe(hashJson({ a: { c: 3, d: 4 }, b: 2 }));
    expect(hashJson({ values: [1, 2] })).not.toBe(hashJson({ values: [2, 1] }));
  });

  test('declared manifest hash excludes its own hash field', () => {
    const manifest = sampleManifest();
    expect(hashDeclaredManifest({ ...manifest, manifest_sha256: 'old' })).toBe(
      hashDeclaredManifest({ ...manifest, manifest_sha256: 'new' })
    );
  });

  test('purl helpers parse brief examples and strip versions for revocation patterns', () => {
    expect(parsePurl('pkg:npm/@org/server@1.2.3')).toMatchObject({
      type: 'npm',
      namespace: '@org',
      name: 'server',
      version: '1.2.3'
    });
    expect(parsePurl('pkg:github/owner/repo@3f9c2e1')).toMatchObject({
      type: 'github',
      namespace: 'owner',
      name: 'repo',
      version: '3f9c2e1'
    });
    expect(
      parsePurl(buildPurl({ type: 'npm', namespace: '@org', name: 'server', version: '1.2.3' }))
    ).toMatchObject({
      type: 'npm',
      namespace: '@org',
      name: 'server',
      version: '1.2.3'
    });
    expect(purlToRevocationPattern('pkg:npm/@org/server@1.2.3')).toBe('pkg:npm/%40org/server');
  });
});
