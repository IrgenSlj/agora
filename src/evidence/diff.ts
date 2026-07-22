import {
  canonicalToolSchema,
  extractToolDescriptions,
  hashToolSchema,
  type ToolDescription,
  type ToolSchemaLike
} from './schemahash.js';

export interface ToolSchemaChange {
  name: string;
  before_description: string;
  after_description: string;
  before_sha256: string;
  after_sha256: string;
}

export interface ToolSchemaDrift {
  added: ToolDescription[];
  removed: ToolDescription[];
  changed: ToolSchemaChange[];
}

function byName<T extends { name: string }>(items: ReadonlyArray<T>): Map<string, T> {
  return new Map(items.map((item) => [item.name, item]));
}

export function diffToolSchemas(
  before: ReadonlyArray<ToolSchemaLike>,
  after: ReadonlyArray<ToolSchemaLike>
): ToolSchemaDrift {
  const beforeMap = byName(before);
  const afterMap = byName(after);
  const beforeDescriptions = byName(extractToolDescriptions(before));
  const afterDescriptions = byName(extractToolDescriptions(after));
  const added: ToolDescription[] = [];
  const removed: ToolDescription[] = [];
  const changed: ToolSchemaChange[] = [];

  for (const [name, tool] of afterMap) {
    const previous = beforeMap.get(name);
    if (!previous) {
      added.push(afterDescriptions.get(name) ?? canonicalToolSchema(tool));
      continue;
    }

    const beforeSha256 = hashToolSchema(previous);
    const afterSha256 = hashToolSchema(tool);
    if (beforeSha256 !== afterSha256) {
      changed.push({
        name,
        before_description: beforeDescriptions.get(name)?.description ?? '',
        after_description: afterDescriptions.get(name)?.description ?? '',
        before_sha256: beforeSha256,
        after_sha256: afterSha256
      });
    }
  }

  for (const [name, tool] of beforeMap) {
    if (!afterMap.has(name)) {
      removed.push(beforeDescriptions.get(name) ?? canonicalToolSchema(tool));
    }
  }

  return {
    added: added.sort((a, b) => a.name.localeCompare(b.name)),
    removed: removed.sort((a, b) => a.name.localeCompare(b.name)),
    changed: changed.sort((a, b) => a.name.localeCompare(b.name))
  };
}

export function hasToolSchemaDrift(diff: ToolSchemaDrift): boolean {
  return diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0;
}
