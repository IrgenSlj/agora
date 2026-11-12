import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parse } from 'yaml';

// action.yml is what `uses: IrgenSlj/agora@v0` runs; nothing else exercises it
// before a release, so a broken edit would only show on consumers' pull requests.
describe('action.yml', () => {
  const action = parse(readFileSync(join(__dirname, '..', 'action.yml'), 'utf8'));

  test('parses, with every input wired into the step', () => {
    expect(Object.keys(action.inputs)).toEqual([
      'version',
      'fail-on-unknown',
      'require-signer',
      'working-directory'
    ]);
    const step = action.runs.steps[0];
    expect(action.runs.using).toBe('composite');
    expect(step.shell).toBe('bash');
    expect(step['working-directory']).toBe('${{ inputs.working-directory }}');
    expect(step.env.AGORA_REQUIRE_SIGNER).toBe('${{ inputs.require-signer }}');
    expect(step.run).toContain('ci --json-file');
  });
});
