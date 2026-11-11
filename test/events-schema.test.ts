import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { AgentEvent, agentEventJsonSchema, GENESIS } from '../src/events/schema';

const valid = {
  v: 1,
  session: 'abc-123',
  seq: 0,
  ts: '2026-11-11T08:00:00.000Z',
  host: 'claude-code',
  kind: 'file_read',
  subject: 'src/app.ts',
  decision: 'allowed',
  prev: GENESIS,
  hash: `sha256:${'a'.repeat(64)}`
};

describe('AgentEvent', () => {
  test('pins its keys, so a field that could carry content cannot appear unnoticed', () => {
    // AGENTS.md rule 6. Adding a field means changing this list on purpose.
    expect(Object.keys(AgentEvent.shape).sort()).toEqual(
      ['decision', 'hash', 'host', 'kind', 'prev', 'seq', 'session', 'subject', 'ts', 'v'].sort()
    );
  });

  test('rejects unknown fields', () => {
    expect(AgentEvent.safeParse({ ...valid, tool_input: { command: 'cat .env' } }).success).toBe(
      false
    );
  });

  test('rejects a multi-line or oversized subject', () => {
    expect(AgentEvent.safeParse({ ...valid, subject: 'line one\nline two' }).success).toBe(false);
    expect(AgentEvent.safeParse({ ...valid, subject: 'x'.repeat(257) }).success).toBe(false);
  });

  test('accepts a valid event', () => {
    expect(AgentEvent.safeParse(valid).success).toBe(true);
  });

  test('the committed JSON Schema matches the zod source', () => {
    const committed = JSON.parse(
      readFileSync(join(__dirname, '..', 'schemas', 'agent-event.v1.json'), 'utf8')
    );
    expect(committed, 'run `bun scripts/generate-schemas.ts`').toEqual(agentEventJsonSchema());
  });
});
