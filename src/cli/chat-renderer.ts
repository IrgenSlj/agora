import { gradientBar, sampleGradient, BANNER_GRADIENT, colorize, type Styler } from '../ui.js';

export type Verbosity = 'quiet' | 'medium' | 'verbose';

export interface ChatRenderer {
  handleLine(line: string): void;
  finalize(): void;
  getAssistantText(): string;
  getSessionId(): string | null;
  getTotalCost(): number;
  hasReceivedText(): boolean;
}

export interface ChatRendererOptions {
  verbosity: Verbosity;
  style: Styler;
  trueColor: boolean;
  out: { write(s: string): unknown };
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function summarizeToolResult(state: any): string {
  if (!state) return 'ok';
  if (state.status === 'error') {
    const msg = typeof state.error === 'string' ? state.error : 'unknown error';
    return `error: ${truncate(msg, 40)}`;
  }
  const out = state.output;
  if (out === undefined || out === null) return 'ok';
  if (Array.isArray(out)) return `${out.length} results`;
  if (typeof out === 'object' && out !== null) {
    const arr = out.results ?? out.items ?? out.data;
    if (Array.isArray(arr)) return `${arr.length} results`;
  }
  return 'ok';
}

export function formatToolHeader(
  part: any,
  _durationMs: number
): { name: string; argSummary: string; resultSummary: string } {
  const name: string = typeof part.tool === 'string' ? part.tool : '(unknown)';
  const state = part.state ?? {};
  const input = state.input ?? {};

  const argEntries = Object.entries(input as Record<string, unknown>);
  let argSummary = argEntries.map(([k, v]) => `${k}=${truncate(JSON.stringify(v), 20)}`).join(', ');
  argSummary = truncate(argSummary, 60);

  const resultSummary = summarizeToolResult(state);

  return { name, argSummary, resultSummary };
}

export function createChatRenderer(opts: ChatRendererOptions): ChatRenderer {
  const { verbosity, style, trueColor, out } = opts;

  let thinkingStart: number | null = null;
  let thinkingLinePrinted = false;
  let thinkingFinalized = false;
  let firstTextSeen = false;
  let responseHeaderPrinted = false;
  let totalTokens = 0;
  let totalCost = 0;
  let assistantText = '';
  let sessionId: string | null = null;
  let turnStart: number = Date.now();
  const seenToolCallIds = new Set<string>();
  let pulseInterval: ReturnType<typeof setInterval> | null = null;
  let pulseStep = 0;
  const pulseStops = [0.0, 0.25, 0.5, 0.75, 1.0];

  function bar(seed: string): string {
    if (verbosity === 'quiet') return '';
    return gradientBar(seed, { trueColor });
  }

  function pulsedBar(): string {
    const t = pulseStops[pulseStep % pulseStops.length];
    const rgb = sampleGradient(BANNER_GRADIENT, t);
    return colorize('▍', rgb, trueColor);
  }

  function printThinkingLine(): void {
    if (verbosity === 'quiet') return;
    out.write(`${bar('thinking')} ${style.accent('thinking')}${style.dim('…')}`);
    thinkingLinePrinted = true;

    // Pulse only when writing to a real TTY
    if (process.stdout.isTTY) {
      pulseInterval = setInterval(() => {
        pulseStep += 1;
        out.write(`\r\x1b[K${pulsedBar()} ${style.accent('thinking')}${style.dim('…')}`);
      }, 180);
    }
  }

  function stopPulse(): void {
    if (pulseInterval !== null) {
      clearInterval(pulseInterval);
      pulseInterval = null;
    }
  }

  function finalizeThinking(nowMs: number): void {
    if (thinkingFinalized || thinkingStart === null) return;
    thinkingFinalized = true;
    stopPulse();
    const dur = formatDuration(nowMs - thinkingStart);
    if (thinkingLinePrinted && verbosity !== 'quiet') {
      // Overwrite the thinking line in place
      out.write(
        `\r\x1b[K${bar('thinking')} ${style.accent('thinking')} ${style.dim('· ' + dur)}\n`
      );
    }
  }

  function printResponseHeader(): void {
    if (responseHeaderPrinted || verbosity === 'quiet') return;
    responseHeaderPrinted = true;
    out.write(`${bar('response')} ${style.accent('response')}\n\n`);
  }

  function handleStepStart(_ev: any): void {
    if (thinkingStart === null) {
      thinkingStart = Date.now();
      turnStart = thinkingStart;
    }
    if (verbosity !== 'quiet' && !thinkingLinePrinted) {
      printThinkingLine();
    }
  }

  function handleText(ev: any): void {
    const text: string = ev.part?.text ?? '';
    if (!thinkingFinalized) finalizeThinking(Date.now());
    if (!firstTextSeen) {
      firstTextSeen = true;
      printResponseHeader();
    }
    assistantText += text;
    out.write(text);
  }

  function handleToolUse(ev: any): void {
    const part = ev.part ?? {};
    const callId: string = part.callID ?? '';
    const state = part.state ?? {};

    // Only print when terminal status is reached; skip if already printed for this callId
    const status: string = state.status ?? '';
    if (status !== 'completed' && status !== 'error') return;
    if (callId && seenToolCallIds.has(callId)) return;
    if (callId) seenToolCallIds.add(callId);

    if (!thinkingFinalized) finalizeThinking(Date.now());

    if (verbosity === 'quiet') return;

    // Tool durations come from opencode's own clock (start/end inside the
    // same event), so they're safe to subtract. Don't mix in our wall clock.
    const durationMs: number =
      typeof state.time?.start === 'number' && typeof state.time?.end === 'number'
        ? state.time.end - state.time.start
        : 0;

    const { name, argSummary, resultSummary } = formatToolHeader(part, durationMs);
    const dur = formatDuration(durationMs);
    const callStr = argSummary ? `${name}(${argSummary})` : name;
    out.write(
      `${bar('tool')} ${style.accent('tool')} ${style.dim('· ' + callStr + ' · ' + dur + ' → ' + resultSummary)}\n`
    );

    if (verbosity === 'verbose') {
      const inputJson = JSON.stringify(state.input ?? {}, null, 2);
      for (const l of inputJson.split('\n')) {
        out.write(style.dim('   ' + l) + '\n');
      }
      const resultStr = truncate(
        typeof state.output === 'string' ? state.output : JSON.stringify(state.output ?? null),
        800
      );
      out.write(style.dim(`   result: ${resultSummary} — ${resultStr}`) + '\n');
    }
  }

  function handleStepFinish(ev: any): void {
    const tokens = ev.part?.tokens ?? {};
    const output: number = typeof tokens.output === 'number' ? tokens.output : 0;
    const total: number = typeof tokens.total === 'number' ? tokens.total : output;
    totalTokens += total > 0 ? total : output;
    const cost: number = typeof ev.part?.cost === 'number' ? ev.part.cost : 0;
    totalCost += cost;
  }

  return {
    handleLine(line: string): void {
      if (!line.trim()) return;
      let ev: any;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }

      if (!sessionId && typeof ev.sessionID === 'string') {
        sessionId = ev.sessionID;
      }

      const type: string = ev.type ?? '';
      if (type === 'step_start') handleStepStart(ev);
      else if (type === 'text') handleText(ev);
      else if (type === 'tool_use') handleToolUse(ev);
      else if (type === 'step_finish') handleStepFinish(ev);
    },

    getTotalCost(): number {
      return totalCost;
    },

    finalize(): void {
      stopPulse();
      if (!thinkingFinalized && thinkingStart !== null) {
        finalizeThinking(Date.now());
      }
      if (verbosity !== 'quiet') {
        const parts = [formatDuration(Date.now() - turnStart)];
        // Token + cost only if a step_finish actually reported them; otherwise
        // we'd print "0 tokens · $0.000000" which is misleading.
        if (totalTokens > 0) parts.push(`${totalTokens} tokens`);
        if (totalCost > 0) parts.push(`$${totalCost.toFixed(6)}`);
        out.write(`\n${style.dim('─── ' + parts.join(' · '))}\n`);
      }
      out.write('\n');
    },

    getAssistantText(): string {
      return assistantText;
    },

    getSessionId(): string | null {
      return sessionId;
    },

    hasReceivedText(): boolean {
      return firstTextSeen;
    }
  };
}
