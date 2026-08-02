import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createAgoraRuntimeTools } from '../src/plugin/runtime-tools';

// `agora_config` was the last agent-callable host-config write in the product:
// a model could rewrite the file that decides which MCP servers run on the
// machine, with no human anywhere in the loop. It reports; it does not write.

let dir: string;
let configPath: string;
let previousConfigEnv: string | undefined;

const NEEDS_REPAIR = JSON.stringify(
  { plugin: ['agora-hub/plugin', 'agora-hub/plugin'], mcp: { stale: {} } },
  null,
  2
);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agora-plugin-config-'));
  configPath = join(dir, 'opencode.json');
  writeFileSync(configPath, NEEDS_REPAIR, 'utf8');
  previousConfigEnv = process.env.OPENCODE_CONFIG;
  process.env.OPENCODE_CONFIG = configPath;
});
afterEach(() => {
  if (previousConfigEnv === undefined) delete process.env.OPENCODE_CONFIG;
  else process.env.OPENCODE_CONFIG = previousConfigEnv;
  rmSync(dir, { recursive: true, force: true });
});

async function runConfigTool(args: Record<string, unknown>): Promise<string> {
  const tools = createAgoraRuntimeTools();
  const configTool = tools.agora_config as unknown as {
    execute: (a: Record<string, unknown>) => Promise<string>;
  };
  return configTool.execute(args);
}

describe('the plugin config tool', () => {
  test('fix: true reports the repairs and changes nothing on disk', async () => {
    const before = readFileSync(configPath, 'utf8');

    const output = await runConfigTool({ fix: true, configPath });

    expect(output).toContain('Repairs needed');
    expect(output).toContain('duplicate plugins');
    expect(output).toContain('Not applied');
    expect(output).toContain('agent callers cannot authorize');
    // The useful half survives: the human is told the exact command to run.
    expect(output).toContain('agora config doctor --fix');
    expect(readFileSync(configPath, 'utf8')).toBe(before);
  });

  test('the read-only report still works', async () => {
    const output = await runConfigTool({ configPath });

    expect(output).toContain('Config Health Report');
    expect(readFileSync(configPath, 'utf8')).toBe(NEEDS_REPAIR);
  });
});
