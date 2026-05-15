import { describe, expect, test } from 'bun:test';
import {
  createChatRenderer,
  formatDuration,
  formatToolHeader,
  summarizeToolResult,
  truncate
} from '../src/cli/chat-renderer';
import { createStyler } from '../src/ui';

// Plain (no color) styler for test assertions
const style = createStyler(false);
const baseOpts = { style, trueColor: false };

// ── Pure helpers ─────────────────────────────────────────────────────────────

describe('truncate', () => {
  test('short string unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  test('exact length unchanged', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  test('too long gets ellipsis', () => {
    const result = truncate('hello world', 8);
    expect(result.length).toBe(8);
    expect(result.endsWith('…')).toBe(true);
  });
});

describe('formatDuration', () => {
  test('under 1000ms shows ms', () => {
    expect(formatDuration(234)).toBe('234ms');
  });

  test('0ms shows 0ms', () => {
    expect(formatDuration(0)).toBe('0ms');
  });

  test('1000ms shows 1.0s', () => {
    expect(formatDuration(1000)).toBe('1.0s');
  });

  test('1800ms shows 1.8s', () => {
    expect(formatDuration(1800)).toBe('1.8s');
  });

  test('999ms stays ms', () => {
    expect(formatDuration(999)).toBe('999ms');
  });
});

describe('summarizeToolResult', () => {
  test('null state returns ok', () => {
    expect(summarizeToolResult(null)).toBe('ok');
  });

  test('error status returns error message', () => {
    expect(summarizeToolResult({ status: 'error', error: 'timeout' })).toBe('error: timeout');
  });

  test('array output returns n results', () => {
    expect(summarizeToolResult({ status: 'completed', output: [1, 2, 3] })).toBe('3 results');
  });

  test('object with results array returns n results', () => {
    expect(summarizeToolResult({ status: 'completed', output: { results: ['a', 'b'] } })).toBe(
      '2 results'
    );
  });

  test('completed with non-array output returns ok', () => {
    expect(summarizeToolResult({ status: 'completed', output: 'done' })).toBe('ok');
  });

  test('undefined output returns ok', () => {
    expect(summarizeToolResult({ status: 'completed' })).toBe('ok');
  });
});

describe('formatToolHeader', () => {
  test('extracts name, argSummary, resultSummary', () => {
    const part = {
      tool: 'agora_trending',
      callID: 'abc',
      state: {
        status: 'completed',
        input: { category: 'mcp', limit: 5 },
        output: [1, 2, 3, 4, 5],
        time: { start: 1000, end: 1234 }
      }
    };
    const result = formatToolHeader(part, 234);
    expect(result.name).toBe('agora_trending');
    expect(result.argSummary).toContain('category');
    expect(result.resultSummary).toBe('5 results');
  });

  test('missing state gives ok result', () => {
    const result = formatToolHeader({ tool: 'foo' }, 0);
    expect(result.name).toBe('foo');
    expect(result.argSummary).toBe('');
    expect(result.resultSummary).toBe('ok');
  });
});

// ── Renderer integration ─────────────────────────────────────────────────────

function makeOut() {
  const writes: string[] = [];
  return {
    out: {
      write: (s: string) => {
        writes.push(s);
        return 1;
      }
    },
    written: () => writes.join(''),
    writes
  };
}

const STEP_START = JSON.stringify({
  type: 'step_start',
  sessionID: 'sess-1',
  part: { type: 'step-start' }
});
const TEXT_1 = JSON.stringify({
  type: 'text',
  sessionID: 'sess-1',
  part: { type: 'text', text: 'Hello ', time: { start: 100, end: 110 } }
});
const TEXT_2 = JSON.stringify({
  type: 'text',
  sessionID: 'sess-1',
  part: { type: 'text', text: 'world', time: { start: 110, end: 120 } }
});
const STEP_FINISH = JSON.stringify({
  type: 'step_finish',
  sessionID: 'sess-1',
  part: { type: 'step-finish', tokens: { output: 12, total: 50 }, cost: 0.000123 }
});

const TOOL_USE = JSON.stringify({
  type: 'tool_use',
  sessionID: 'sess-1',
  part: {
    type: 'tool',
    tool: 'agora_trending',
    callID: 'call-1',
    state: {
      status: 'completed',
      input: { category: 'mcp', limit: 5 },
      output: [1, 2, 3, 4, 5],
      time: { start: 200, end: 434 }
    }
  }
});

describe('createChatRenderer — medium mode', () => {
  test('accumulates assistant text', () => {
    const { out } = makeOut();
    const r = createChatRenderer({ ...baseOpts, verbosity: 'medium', out });
    r.handleLine(STEP_START);
    r.handleLine(TEXT_1);
    r.handleLine(TEXT_2);
    r.handleLine(STEP_FINISH);
    r.finalize();
    expect(r.getAssistantText()).toBe('Hello world');
  });

  test('captures session id', () => {
    const { out } = makeOut();
    const r = createChatRenderer({ ...baseOpts, verbosity: 'medium', out });
    r.handleLine(STEP_START);
    r.handleLine(TEXT_1);
    r.handleLine(STEP_FINISH);
    r.finalize();
    expect(r.getSessionId()).toBe('sess-1');
  });

  test('writes thinking and response headers in output', () => {
    const { out, written } = makeOut();
    const r = createChatRenderer({ ...baseOpts, verbosity: 'medium', out });
    r.handleLine(STEP_START);
    r.handleLine(TEXT_1);
    r.handleLine(TEXT_2);
    r.handleLine(STEP_FINISH);
    r.finalize();
    const output = written();
    expect(output).toContain('thinking');
    expect(output).toContain('response');
    expect(output).toContain('Hello world');
  });

  test('writes tool header on tool_use event', () => {
    const { out, written } = makeOut();
    const r = createChatRenderer({ ...baseOpts, verbosity: 'medium', out });
    r.handleLine(STEP_START);
    r.handleLine(TOOL_USE);
    r.handleLine(TEXT_1);
    r.handleLine(STEP_FINISH);
    r.finalize();
    const output = written();
    expect(output).toContain('tool');
    expect(output).toContain('agora_trending');
  });

  test('does not duplicate tool header for same callID', () => {
    const { out, written } = makeOut();
    const r = createChatRenderer({ ...baseOpts, verbosity: 'medium', out });
    r.handleLine(STEP_START);
    r.handleLine(TOOL_USE);
    r.handleLine(TOOL_USE); // duplicate event
    r.handleLine(TEXT_1);
    r.handleLine(STEP_FINISH);
    r.finalize();
    const output = written();
    const count = (output.match(/agora_trending/g) ?? []).length;
    expect(count).toBe(1);
  });

  test('writes footer with token count', () => {
    const { out, written } = makeOut();
    const r = createChatRenderer({ ...baseOpts, verbosity: 'medium', out });
    r.handleLine(STEP_START);
    r.handleLine(TEXT_1);
    r.handleLine(STEP_FINISH);
    r.finalize();
    const output = written();
    expect(output).toContain('50 tokens');
  });

  test('ignores malformed JSON lines', () => {
    const { out } = makeOut();
    const r = createChatRenderer({ ...baseOpts, verbosity: 'medium', out });
    expect(() => r.handleLine('not json {')).not.toThrow();
    expect(() => r.handleLine('')).not.toThrow();
  });
});

describe('createChatRenderer — quiet mode', () => {
  test('no headers in output, only text', () => {
    const { out, written } = makeOut();
    const r = createChatRenderer({ ...baseOpts, verbosity: 'quiet', out });
    r.handleLine(STEP_START);
    r.handleLine(TEXT_1);
    r.handleLine(TEXT_2);
    r.handleLine(STEP_FINISH);
    r.finalize();
    const output = written();
    expect(output).not.toContain('thinking');
    expect(output).not.toContain('response');
    expect(output).not.toContain('tokens');
    expect(output).toContain('Hello world');
  });

  test('still captures assistant text', () => {
    const { out } = makeOut();
    const r = createChatRenderer({ ...baseOpts, verbosity: 'quiet', out });
    r.handleLine(STEP_START);
    r.handleLine(TEXT_1);
    r.handleLine(TEXT_2);
    r.handleLine(STEP_FINISH);
    r.finalize();
    expect(r.getAssistantText()).toBe('Hello world');
  });
});

describe('createChatRenderer — getTotalCost', () => {
  test('returns 0 when no step_finish received', () => {
    const { out } = makeOut();
    const r = createChatRenderer({ ...baseOpts, verbosity: 'medium', out });
    r.handleLine(STEP_START);
    r.handleLine(TEXT_1);
    r.finalize();
    expect(r.getTotalCost()).toBe(0);
  });

  test('returns cost from step_finish event', () => {
    const { out } = makeOut();
    const r = createChatRenderer({ ...baseOpts, verbosity: 'medium', out });
    r.handleLine(STEP_START);
    r.handleLine(TEXT_1);
    r.handleLine(STEP_FINISH); // cost: 0.000123
    r.finalize();
    expect(r.getTotalCost()).toBeCloseTo(0.000123, 8);
  });

  test('accumulates cost across multiple step_finish events', () => {
    const { out } = makeOut();
    const r = createChatRenderer({ ...baseOpts, verbosity: 'medium', out });
    r.handleLine(STEP_START);
    r.handleLine(TEXT_1);
    r.handleLine(STEP_FINISH); // 0.000123
    r.handleLine(STEP_FINISH); // another 0.000123
    r.finalize();
    expect(r.getTotalCost()).toBeCloseTo(0.000246, 7);
  });
});

describe('createChatRenderer — verbose mode', () => {
  test('includes tool args dump', () => {
    const { out, written } = makeOut();
    const r = createChatRenderer({ ...baseOpts, verbosity: 'verbose', out });
    r.handleLine(STEP_START);
    r.handleLine(TOOL_USE);
    r.handleLine(TEXT_1);
    r.handleLine(STEP_FINISH);
    r.finalize();
    const output = written();
    expect(output).toContain('category');
  });
});

describe('createChatRenderer — hasReceivedText', () => {
  test('false initially before any events', () => {
    const { out } = makeOut();
    const r = createChatRenderer({ ...baseOpts, verbosity: 'medium', out });
    expect(r.hasReceivedText()).toBe(false);
  });

  test('false after step_start only', () => {
    const { out } = makeOut();
    const r = createChatRenderer({ ...baseOpts, verbosity: 'medium', out });
    r.handleLine(STEP_START);
    expect(r.hasReceivedText()).toBe(false);
  });

  test('true after first text event', () => {
    const { out } = makeOut();
    const r = createChatRenderer({ ...baseOpts, verbosity: 'medium', out });
    r.handleLine(STEP_START);
    r.handleLine(TEXT_1);
    expect(r.hasReceivedText()).toBe(true);
  });

  test('true after multiple text events', () => {
    const { out } = makeOut();
    const r = createChatRenderer({ ...baseOpts, verbosity: 'medium', out });
    r.handleLine(STEP_START);
    r.handleLine(TEXT_1);
    r.handleLine(TEXT_2);
    r.handleLine(STEP_FINISH);
    r.finalize();
    expect(r.hasReceivedText()).toBe(true);
  });

  test('false after tool_use only (no text)', () => {
    const { out } = makeOut();
    const r = createChatRenderer({ ...baseOpts, verbosity: 'medium', out });
    r.handleLine(STEP_START);
    r.handleLine(TOOL_USE);
    r.handleLine(STEP_FINISH);
    r.finalize();
    expect(r.hasReceivedText()).toBe(false);
  });
});
