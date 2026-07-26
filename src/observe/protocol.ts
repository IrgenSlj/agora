// Reads MCP's JSON-RPC frames out of a byte stream, without owning it.
//
// MCP over stdio is newline-delimited JSON. This module buffers a copy of the
// bytes and emits whole frames as it recognises them — it is deliberately a
// *reader*, never a transformer: `run.ts` has already forwarded those bytes
// before the tee ever sees them.
//
// Why parse the protocol at all when a sandbox would parse syscalls: this is
// the layer where intent lives. A syscall trace says a file was opened; the
// protocol says which tool the agent invoked, with what arguments, and what
// came back. It also makes tool-schema drift observable *continuously* in real
// use, rather than only at probe time.

/** A recognised JSON-RPC message. `raw` is capped; frames can be large. */
export interface Frame {
  method?: string;
  id?: string | number;
  /** Present on requests. Never persisted verbatim — see session.ts. */
  params?: unknown;
  /** Present on responses. */
  result?: unknown;
  error?: unknown;
}

/** Beyond this a single line is assumed to be data, not a frame, and dropped. */
const MAX_FRAME_BYTES = 1_000_000;

/** Beyond this the buffer is reset — a stream with no newlines is not MCP. */
const MAX_BUFFER_BYTES = 4_000_000;

/**
 * Returns a function you feed chunks to. It calls `onFrame` for each complete
 * JSON-RPC message it recognises.
 *
 * Every failure mode here is silent by design: unparseable input simply is not
 * a frame, and an observation layer that threw would take down the server it
 * is watching.
 */
export function createFrameTee(onFrame: (frame: Frame) => void): (chunk: Buffer) => void {
  let buffer = '';

  return (chunk: Buffer) => {
    try {
      buffer += chunk.toString('utf8');

      // A stream this large with no newline is not newline-delimited JSON.
      // Drop it rather than growing without bound.
      if (buffer.length > MAX_BUFFER_BYTES) {
        buffer = '';
        return;
      }

      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);

        if (line && line.length <= MAX_FRAME_BYTES && line.startsWith('{')) {
          try {
            const parsed = JSON.parse(line) as Frame;
            if (parsed && typeof parsed === 'object') onFrame(parsed);
          } catch {
            // Not JSON, or partial. Not our problem — the real stream already
            // went through untouched.
          }
        }

        newline = buffer.indexOf('\n');
      }
    } catch {
      /* never let observation raise into the data path */
    }
  };
}

/** Tool names from a `tools/list` response, for drift detection. */
export function toolNamesFromResult(result: unknown): string[] {
  if (typeof result !== 'object' || result === null) return [];
  const tools = (result as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) return [];
  return tools
    .map((t) => (typeof t === 'object' && t !== null ? (t as { name?: unknown }).name : undefined))
    .filter((n): n is string => typeof n === 'string');
}

/** The tool a `tools/call` request targets. */
export function calledToolName(frame: Frame): string | undefined {
  if (frame.method !== 'tools/call') return undefined;
  const params = frame.params;
  if (typeof params !== 'object' || params === null) return undefined;
  const name = (params as { name?: unknown }).name;
  return typeof name === 'string' ? name : undefined;
}
