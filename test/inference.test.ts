import { describe, expect, test } from 'vitest';
import { buildClaudeRunArgs, createClaudeTranslator } from '../src/inference/claude';
import { PROVIDERS, selectProvider } from '../src/inference/index';
import { createOpencodeTranslator } from '../src/inference/opencode';

// Captured from a real `claude -p --output-format stream-json --verbose` run
// (2026-07-28, claude_code_version 2.1.220) rather than written from the docs,
// so a change in the real stream shape shows up here as a failure.
const REAL_INIT =
  '{"type":"system","subtype":"init","session_id":"5bfeb4f1","model":"claude-haiku-4-5-20251001","tools":["Bash"]}';
const REAL_THINKING =
  '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"reasoning here","signature":"abc"}]},"session_id":"5bfeb4f1"}';
const REAL_TEXT =
  '{"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]},"session_id":"5bfeb4f1"}';
const REAL_RATE_LIMIT =
  '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"},"session_id":"5bfeb4f1"}';
const REAL_RESULT =
  '{"type":"result","subtype":"success","total_cost_usd":0.0150939,"usage":{"input_tokens":10,"output_tokens":39},"result":"ok","session_id":"5bfeb4f1"}';

describe('claude arg building', () => {
  test('uses print + stream-json + verbose', () => {
    const args = buildClaudeRunArgs({ prompt: 'hi' });
    expect(args).toContain('--print');
    expect(args.join(' ')).toContain('--output-format stream-json');
    // Without --verbose the stream carries only the final result, so the
    // renderer would draw nothing until the very end.
    expect(args).toContain('--verbose');
    expect(args[args.length - 1]).toBe('hi');
  });

  test('defaults to an alias, never a pinned model id', () => {
    const args = buildClaudeRunArgs({ prompt: 'hi' });
    const model = args[args.indexOf('--model') + 1]!;
    expect(model).toBe('sonnet');
    // Pinned ids rot: OQ-1 recorded claude-opus-4-8 and it was stale within weeks.
    expect(model).not.toMatch(/^claude-/);
    expect(model).not.toMatch(/\d/);
  });

  test('resumes a specific session, or continues the last one', () => {
    expect(buildClaudeRunArgs({ prompt: 'x', sessionId: 'abc' }).join(' ')).toContain(
      '--resume abc'
    );
    expect(buildClaudeRunArgs({ prompt: 'x', continueSession: true })).toContain('--continue');
    // A specific session wins; sending both would be ambiguous.
    const both = buildClaudeRunArgs({ prompt: 'x', sessionId: 'abc', continueSession: true });
    expect(both).not.toContain('--continue');
  });

  test('never passes --bare, which would disable subscription auth', () => {
    // --bare forces ANTHROPIC_API_KEY only. The whole point of spawning the
    // binary is that OAuth/keychain are read, so the user needs no API key.
    expect(buildClaudeRunArgs({ prompt: 'x' })).not.toContain('--bare');
  });
});

describe('claude stream translation', () => {
  test('init becomes step_start and carries the session id', () => {
    const t = createClaudeTranslator();
    const [ev] = t(REAL_INIT) as { type: string; sessionID: string }[];
    expect(ev!.type).toBe('step_start');
    expect(ev!.sessionID).toBe('5bfeb4f1');
  });

  test('assistant text becomes a text event in the renderer shape', () => {
    const t = createClaudeTranslator();
    t(REAL_INIT);
    const [ev] = t(REAL_TEXT) as { type: string; part: { text: string } }[];
    expect(ev!.type).toBe('text');
    expect(ev!.part.text).toBe('ok');
  });

  test('thinking blocks are dropped', () => {
    const t = createClaudeTranslator();
    // The renderer draws its own thinking indicator; echoing raw reasoning
    // would bury the answer it precedes.
    expect(t(REAL_THINKING)).toEqual([]);
  });

  test('result becomes step_finish with tokens and cost', () => {
    const t = createClaudeTranslator();
    const [ev] = t(REAL_RESULT) as {
      type: string;
      part: { tokens: { output: number; total: number }; cost: number };
    }[];
    expect(ev!.type).toBe('step_finish');
    expect(ev!.part.tokens.output).toBe(39);
    expect(ev!.part.tokens.total).toBe(49);
    expect(ev!.part.cost).toBeCloseTo(0.0150939);
  });

  test('unknown event types are ignored, not crashed on', () => {
    const t = createClaudeTranslator();
    expect(t(REAL_RATE_LIMIT)).toEqual([]);
    expect(t('{"type":"something_added_next_year"}')).toEqual([]);
  });

  test('non-JSON and empty lines are survivable', () => {
    const t = createClaudeTranslator();
    expect(t('not json at all')).toEqual([]);
    expect(t('')).toEqual([]);
    expect(t('   ')).toEqual([]);
  });

  test('a tool call is emitted only once its result arrives, paired with it', () => {
    const t = createClaudeTranslator();
    t(REAL_INIT);

    // Claude reports the call and the result in separate messages. The
    // renderer only prints tools that reached a terminal status, so emitting
    // on the call alone would print nothing at all.
    expect(
      t(
        '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu_1","name":"Bash","input":{"command":"ls"}}]},"session_id":"5bfeb4f1"}'
      )
    ).toEqual([]);

    const events = t(
      '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu_1","content":"file.txt"}]},"session_id":"5bfeb4f1"}'
    ) as {
      type: string;
      part: { callID: string; tool: string; state: { status: string; output: unknown } };
    }[];

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('tool_use');
    expect(events[0]!.part.callID).toBe('tu_1');
    expect(events[0]!.part.tool).toBe('Bash');
    expect(events[0]!.part.state.status).toBe('completed');
    expect(events[0]!.part.state.output).toBe('file.txt');
  });

  test('a failed tool result reports error status', () => {
    const t = createClaudeTranslator();
    t(
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu_2","name":"Bash","input":{}}]}}'
    );
    const [ev] = t(
      '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu_2","content":"boom","is_error":true}]}}'
    ) as { part: { state: { status: string } } }[];
    expect(ev!.part.state.status).toBe('error');
  });

  test('an orphan tool result does not throw', () => {
    const t = createClaudeTranslator();
    const events = t(
      '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"never-seen","content":"x"}]}}'
    ) as { part: { tool: string } }[];
    expect(events).toHaveLength(1);
    expect(events[0]!.part.tool).toBe('tool');
  });
});

describe('opencode stream translation', () => {
  test('passes its own events through unchanged', () => {
    const t = createOpencodeTranslator();
    const line = '{"type":"text","part":{"text":"hello"},"sessionID":"s1"}';
    expect(t(line)).toEqual([{ type: 'text', part: { text: 'hello' }, sessionID: 's1' }]);
  });

  test('survives garbage', () => {
    const t = createOpencodeTranslator();
    expect(t('garbage')).toEqual([]);
    expect(t('')).toEqual([]);
  });
});

describe('provider selection', () => {
  const yes = { PATH: '' };

  test('the free provider is listed first so it wins by default', () => {
    // Selection order is the guard against silently spending a user's Claude
    // quota just because the binary happens to be installed.
    expect(PROVIDERS[0]!.id).toBe('opencode');
    expect(PROVIDERS[0]!.free).toBe(true);
    expect(PROVIDERS.find((p) => p.id === 'claude')!.free).toBe(false);
  });

  test('an unknown explicit provider is reported, not silently ignored', () => {
    const { provider, problem } = selectProvider({ env: yes, preferred: 'gpt' });
    expect(provider).toBeNull();
    expect(problem).toContain('Unknown inference provider');
    expect(problem).toContain('opencode');
  });

  test('an explicit but missing provider reports how to install it', () => {
    const { provider, problem } = selectProvider({
      env: { PATH: '/nonexistent' },
      preferred: 'claude'
    });
    expect(provider).toBeNull();
    // Never silently substitute — answering with a different model than the
    // one asked for is its own kind of dishonesty.
    expect(problem).toContain('Claude Code');
    expect(problem).toContain('claude.com');
  });

  test('AGORA_INFERENCE selects a provider', () => {
    const { problem } = selectProvider({
      env: { PATH: '/nonexistent', AGORA_INFERENCE: 'claude' }
    });
    expect(problem).toContain('Claude Code');
  });

  test('with nothing installed, the problem names every option', () => {
    const { provider, problem } = selectProvider({ env: { PATH: '/nonexistent' } });
    expect(provider).toBeNull();
    expect(problem).toContain('opencode.ai');
    expect(problem).toContain('claude-code');
  });
});
