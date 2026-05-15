import { mascotFrame, movementBar, type Styler } from '../ui.js';

export type Verbosity = 'quiet' | 'medium' | 'verbose';

// ── Markdown → ANSI ─────────────────────────────────────────────────────────

/** Inline formatting: `code` and **bold**. Order matters — code first so its
 * contents don't get re-interpreted as bold. */
function formatInline(text: string, style: Styler): string {
  let out = text;
  out = out.replace(/`([^`\n]+)`/g, (_, t) => style.accent(t));
  out = out.replace(/\*\*([^*\n]+)\*\*/g, (_, t) => `\x1b[1m${t}\x1b[22m`);
  return out;
}

/** Render one markdown line as ANSI. Used by the chat renderer's line buffer.
 *  Lines inside a fenced code block bypass this entirely (caller's concern). */
export function renderMarkdownLine(line: string, style: Styler): string {
  if (line.startsWith('### ')) return style.accent(line.slice(4));
  if (line.startsWith('## ')) return style.accent(line.slice(3));
  if (line.startsWith('# ')) return style.accent(line.slice(2));

  const bullet = line.match(/^(\s*)([-*])\s+(.*)$/);
  if (bullet) {
    return bullet[1] + style.accent('·') + ' ' + formatInline(bullet[3], style);
  }

  const numbered = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
  if (numbered) {
    return numbered[1] + style.accent(numbered[2] + '.') + ' ' + formatInline(numbered[3], style);
  }

  return formatInline(line, style);
}

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
  let liveTimer: ReturnType<typeof setInterval> | null = null;
  // Markdown rendering needs whole lines + fenced-block state, so we buffer
  // until a newline arrives.
  let mdLineBuffer = '';
  let mdInCodeBlock = false;

  function thinkingMarker(): string {
    return movementBar('thinking', { trueColor });
  }

  function thinkingLive(tMs: number): string {
    const frame = mascotFrame(tMs);
    return `${thinkingMarker()} ${style.accent('thinking')} ${style.dim('· ' + formatDuration(tMs))}    ${style.accent(frame)}`;
  }

  function printThinkingLine(): void {
    if (verbosity === 'quiet') return;
    // Static one-liner — what tests and non-TTY callers see. No trailing newline
    // so the in-place finalizer can overwrite it.
    out.write(`${thinkingMarker()} ${style.accent('thinking')}${style.dim('…')}`);
    thinkingLinePrinted = true;

    // Live single-line state — only on a real TTY wide enough to show it.
    if (process.stdout.isTTY) {
      if ((process.stdout.columns ?? 80) < 50) return;
      out.write(`\r\x1b[K${thinkingLive(0)}`);

      liveTimer = setInterval(() => {
        const elapsed = Date.now() - (thinkingStart ?? Date.now());
        out.write(`\r\x1b[K${thinkingLive(elapsed)}`);
      }, 200);
    }
  }

  function stopLive(): void {
    if (liveTimer !== null) {
      clearInterval(liveTimer);
      liveTimer = null;
    }
  }

  function finalizeThinking(nowMs: number): void {
    if (thinkingFinalized || thinkingStart === null) return;
    thinkingFinalized = true;
    stopLive();
    const dur = formatDuration(nowMs - thinkingStart);
    if (!thinkingLinePrinted || verbosity === 'quiet') return;
    const finalLine = `${thinkingMarker()} ${style.accent('thinking')} ${style.dim('· ' + dur)}`;
    out.write(`\r\x1b[K${finalLine}\n`);
  }

  function printResponseHeader(): void {
    if (responseHeaderPrinted || verbosity === 'quiet') return;
    responseHeaderPrinted = true;
    out.write(`${movementBar('response', { trueColor })} ${style.accent('response')}\n\n`);
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

  function emitMdLine(line: string, withNewline: boolean): void {
    const trailing = withNewline ? '\n' : '';
    if (line.trim().startsWith('```')) {
      mdInCodeBlock = !mdInCodeBlock;
      out.write(style.dim(line) + trailing);
      return;
    }
    if (mdInCodeBlock) {
      out.write(line + trailing);
      return;
    }
    out.write(renderMarkdownLine(line, style) + trailing);
  }

  function handleText(ev: any): void {
    const text: string = ev.part?.text ?? '';
    if (!thinkingFinalized) finalizeThinking(Date.now());
    if (!firstTextSeen) {
      firstTextSeen = true;
      printResponseHeader();
    }
    assistantText += text;
    mdLineBuffer += text;
    let nl: number;
    while ((nl = mdLineBuffer.indexOf('\n')) !== -1) {
      const line = mdLineBuffer.slice(0, nl);
      mdLineBuffer = mdLineBuffer.slice(nl + 1);
      emitMdLine(line, true);
    }
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
      `${movementBar('tool', { trueColor })} ${style.accent('tool')} ${style.dim('· ' + callStr + ' · ' + dur + ' → ' + resultSummary)}\n`
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
      stopLive();
      if (!thinkingFinalized && thinkingStart !== null) {
        finalizeThinking(Date.now());
      }
      if (mdLineBuffer) {
        emitMdLine(mdLineBuffer, false);
        mdLineBuffer = '';
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
