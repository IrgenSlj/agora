import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { MODEL_SCHEMAS } from '../src/model/schema-registry.js';

const SCHEMAS_DIR = join(import.meta.dirname, '..', 'schemas');
mkdirSync(SCHEMAS_DIR, { recursive: true });

function exportSchema(name: string, schema: z.ZodType) {
  const jsonSchema = z.toJSONSchema(schema);
  const path = join(SCHEMAS_DIR, `${name}.v1.json`);
  writeFileSync(path, `${JSON.stringify(jsonSchema, null, 2)}\n`);
  console.log(`Generated ${path}`);
}

for (const { name, schema } of MODEL_SCHEMAS) {
  exportSchema(name, schema);
}

console.log('All schemas generated successfully.');
