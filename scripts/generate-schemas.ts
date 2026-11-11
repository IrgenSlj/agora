// Writes schemas/*.json from the zod sources. CI fails when the committed
// files differ from what this produces (test/events-schema.test.ts).

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentEventJsonSchema } from '../src/events/schema.js';

const out = join(import.meta.dir, '..', 'schemas', 'agent-event.v1.json');
writeFileSync(out, `${JSON.stringify(agentEventJsonSchema(), null, 2)}\n`);
console.log(`wrote ${out}`);
