import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

let _pkgVersion: string | undefined;
function getPkgVersion(): string {
  if (_pkgVersion !== undefined) return _pkgVersion;
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
    ) as { version?: string };
    _pkgVersion = pkg.version ?? '0';
  } catch {
    _pkgVersion = '0';
  }
  return _pkgVersion;
}

export interface McpTool {
  name: string;
  description?: string;
}

export interface McpProbeResult {
  ok: boolean;
  serverInfo?: { name?: string; version?: string };
  capabilities?: unknown;
  tools?: McpTool[];
  error?: string;
  stderr?: string;
  exitCode?: number | null;
  durationMs?: number;
}

const STDERR_CAP = 4000;

function appendStderr(buf: string, chunk: string): string {
  const combined = buf + chunk;
  if (combined.length <= STDERR_CAP) return combined;
  // Keep the tail
  return combined.slice(combined.length - STDERR_CAP);
}

function stderrSnippet(buf: string): string {
  const trimmed = buf.trimEnd();
  if (!trimmed) return '';
  // Last ~200 chars, collapsed to a single line
  const tail = trimmed.length > 200 ? trimmed.slice(trimmed.length - 200) : trimmed;
  return tail.replace(/\r?\n/g, ' ').trim();
}

export async function probeMcpServer(
  command: string[],
  opts?: {
    env?: Record<string, string | undefined>;
    cwd?: string;
    timeoutMs?: number;
  }
): Promise<McpProbeResult> {
  const timeoutMs = opts?.timeoutMs ?? 15000;
  const startMs = Date.now();

  const mergedEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) mergedEnv[k] = v;
  }
  if (opts?.env) {
    for (const [k, v] of Object.entries(opts.env)) {
      if (v !== undefined) mergedEnv[k] = v;
    }
  }

  return new Promise<McpProbeResult>((resolveOuter) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let currentStage = 'initialize';

    const child = spawn(command[0]!, command.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      env: mergedEnv,
      cwd: opts?.cwd
    });

    // Pending RPC handlers keyed by message id
    const pending = new Map<number, (msg: unknown) => void>();
    // Partial line buffer for stdout
    let lineBuffer = '';
    // Bounded stderr capture (tail up to STDERR_CAP chars)
    let stderrBuf = '';

    function durationMs(): number {
      return Date.now() - startMs;
    }

    function cleanup(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      try {
        child.kill('SIGTERM');
        // Give it a short grace period then SIGKILL
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // already dead
          }
        }, 300);
      } catch {
        // already dead
      }
    }

    function resolve(result: McpProbeResult): void {
      if (settled) return;
      settled = true;
      cleanup();
      const capturedStderr = stderrBuf.trimEnd();
      const withStderr: McpProbeResult = {
        ...result,
        durationMs: durationMs(),
        ...(capturedStderr ? { stderr: capturedStderr } : {})
      };
      resolveOuter(withStderr);
    }

    // Capture stderr (bounded)
    child.stderr!.on('data', (chunk: Buffer) => {
      stderrBuf = appendStderr(stderrBuf, chunk.toString('utf8'));
    });

    // Set overall timeout
    timer = setTimeout(() => {
      const snippet = stderrSnippet(stderrBuf);
      const base = `timed out waiting for ${currentStage}`;
      resolve({ ok: false, error: snippet ? `${base} — stderr: ${snippet}` : base });
    }, timeoutMs);

    child.on('error', (err) => {
      const snippet = stderrSnippet(stderrBuf);
      resolve({ ok: false, error: snippet ? `${err.message} — stderr: ${snippet}` : err.message });
    });

    child.on('close', (code) => {
      if (!settled) {
        const snippet = stderrSnippet(stderrBuf);
        const base = 'server exited';
        resolve({
          ok: false,
          error: snippet ? `${base} — stderr: ${snippet}` : base,
          exitCode: code
        });
      }
    });

    // Parse stdout as newline-delimited JSON
    child.stdout!.on('data', (chunk: Buffer) => {
      lineBuffer += chunk.toString('utf8');
      const lines = lineBuffer.split('\n');
      // Keep the last (potentially incomplete) segment
      lineBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let msg: unknown;
        try {
          msg = JSON.parse(trimmed);
        } catch {
          // Not JSON (e.g. server debug output) — ignore
          continue;
        }
        if (typeof msg !== 'object' || msg === null) continue;
        const record = msg as Record<string, unknown>;
        const id = record.id;
        if (typeof id === 'number' && pending.has(id)) {
          const handler = pending.get(id)!;
          pending.delete(id);
          handler(msg);
        }
      }
    });

    function writeMsg(msg: unknown): void {
      const line = JSON.stringify(msg) + '\n';
      child.stdin!.write(line);
    }

    // ── Handshake ────────────────────────────────────────────────────────────

    function awaitResponse(id: number): Promise<Record<string, unknown>> {
      return new Promise((res) => {
        pending.set(id, (msg) => res(msg as Record<string, unknown>));
      });
    }

    async function handshake(): Promise<void> {
      // 1. Send initialize
      currentStage = 'initialize';
      writeMsg({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'agora', version: getPkgVersion() }
        }
      });

      const initResp = await awaitResponse(1);

      if (settled) return;

      if (initResp.error) {
        const rpcErr = initResp.error as { message?: string } | string;
        const errMsg =
          typeof rpcErr === 'object' && rpcErr !== null
            ? (rpcErr.message ?? JSON.stringify(rpcErr))
            : String(rpcErr);
        resolve({ ok: false, error: errMsg });
        return;
      }

      const result = (initResp.result ?? {}) as Record<string, unknown>;
      const serverInfo = result.serverInfo as { name?: string; version?: string } | undefined;
      const capabilities = result.capabilities;

      // 2. Send initialized notification (no id)
      currentStage = 'initialized notification';
      writeMsg({ jsonrpc: '2.0', method: 'notifications/initialized' });

      // 3. Request tools/list
      currentStage = 'tools/list';
      writeMsg({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });

      const toolsResp = await awaitResponse(2);

      if (settled) return;

      if (toolsResp.error) {
        // Initialize succeeded; tools/list failed — server is still usable
        const rpcErr = toolsResp.error as { message?: string } | string;
        const errMsg =
          typeof rpcErr === 'object' && rpcErr !== null
            ? (rpcErr.message ?? JSON.stringify(rpcErr))
            : String(rpcErr);
        resolve({ ok: true, serverInfo, capabilities, tools: [], error: errMsg });
        return;
      }

      const toolsResult = (toolsResp.result ?? {}) as { tools?: unknown[] };
      const rawTools = Array.isArray(toolsResult.tools) ? toolsResult.tools : [];
      const tools: McpTool[] = rawTools.map((t) => {
        const tool = t as { name?: string; description?: string };
        return {
          name: typeof tool.name === 'string' ? tool.name : '(unknown)',
          ...(typeof tool.description === 'string' ? { description: tool.description } : {})
        };
      });

      resolve({ ok: true, serverInfo, capabilities, tools });
    }

    // Start handshake; any thrown error becomes a failure
    handshake().catch((err: unknown) => {
      if (!settled) {
        resolve({
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    });
  });
}
