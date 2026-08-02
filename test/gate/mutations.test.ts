import { describe, expect, test } from 'vitest';
import { ACTIVE_CLI_ENTRYPOINTS } from '../../src/cli/app';
import {
  CLI_MUTATION_INVENTORY,
  MCP_MUTATION_INVENTORY,
  PLUGIN_MUTATION_INVENTORY,
  validateMutationInventory
} from '../../src/gate/mutations';
import { createAgoraTools } from '../../src/plugin/tools';

describe('mutation inventory completeness', () => {
  test('classifies every active CLI entry point, including compatibility aliases', () => {
    expect(Object.keys(CLI_MUTATION_INVENTORY).sort()).toEqual(ACTIVE_CLI_ENTRYPOINTS);
  });

  test('classifies every plugin tool', () => {
    expect(Object.keys(createAgoraTools()).sort()).toEqual(
      Object.keys(PLUGIN_MUTATION_INVENTORY).sort()
    );
  });

  test('all declarations are internally consistent', () => {
    expect(validateMutationInventory(CLI_MUTATION_INVENTORY)).toEqual([]);
    expect(validateMutationInventory(MCP_MUTATION_INVENTORY)).toEqual([]);
    expect(validateMutationInventory(PLUGIN_MUTATION_INVENTORY)).toEqual([]);
  });

  test('known trust-controlled gaps stay explicit until they are migrated', () => {
    const cliGaps = Object.entries(CLI_MUTATION_INVENTORY)
      .filter(([, entry]) => entry.requiresGate && entry.coverage !== 'present')
      .map(([name]) => name)
      .sort();
    expect(cliGaps).toEqual([
      'apply',
      'approve',
      'doctor',
      'integrate',
      'sync',
      'unquarantine',
      'update'
    ]);

    expect(CLI_MUTATION_INVENTORY.acquire).toMatchObject({
      requiresGate: true,
      coverage: 'present'
    });
    expect(MCP_MUTATION_INVENTORY.agora_acquire).toMatchObject({
      effects: ['install-intent'],
      coverage: 'request-only',
      consent: 'agent-callable'
    });
    // The plugin's config repair used to be the one agent-callable host-config
    // write left in the product. It no longer mutates anything.
    expect(PLUGIN_MUTATION_INVENTORY.agora_config).toMatchObject({
      mode: 'none',
      effects: [],
      requiresGate: false
    });
    for (const [name, declaration] of Object.entries(PLUGIN_MUTATION_INVENTORY)) {
      expect(
        { name, writesHostConfig: declaration.effects.includes('host-config') },
        `plugin tool ${name} must not be able to write host config`
      ).toEqual({ name, writesHostConfig: false });
    }
  });
});
