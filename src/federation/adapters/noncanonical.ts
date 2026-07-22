import type { FederationEnv } from '../types.js';

type NonCanonicalSourceId = 'smithery' | 'huggingface';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

function truthy(value: string | undefined): boolean {
  return TRUE_VALUES.has((value ?? '').trim().toLowerCase());
}

function listIncludes(value: string | undefined, source: NonCanonicalSourceId): boolean {
  return (value ?? '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .includes(source);
}

export function isNonCanonicalSourceEnabled(
  env: FederationEnv,
  source: NonCanonicalSourceId,
  sourceFlag: string
): boolean {
  const record = env.env ?? {};
  if (record.AGORA_OFFLINE === '1') return false;
  return (
    truthy(record.AGORA_ENABLE_NONCANONICAL_SOURCES) ||
    truthy(record[sourceFlag]) ||
    listIncludes(record.AGORA_NONCANONICAL_SOURCES, source)
  );
}
