import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { COMMANDS } from './commands-meta.js';
import { runInteractiveMenu } from './menu.js';
import { FREE_MODELS } from './app.js';
import { detectAgoraDataDir, loadAgoraState, resolveSavedItems } from '../state.js';
import {
  appendTranscript,
  loadSessionMeta,
  readTranscript,
  recentBashContext,
  writeSessionMeta,
} from '../transcript.js';
import { gradientText, renderBanner, supportsTrueColor, type Styler } from '../ui.js';
import { createChatRenderer, type Verbosity } from './chat-renderer.js';
import { readLine } from './prompter.js';
import { completeShellLine, ghostFromHistory } from './completions.js';
import { getMarketplaceItems } from '../marketplace.js';
import type { CliIo } from './app.js';

const SHELL_BUILTINS = new Set(['cd', 'export', 'alias', 'source', 'unset', 'umask', 'exec']);
const MAX_BASH_BUFFER = 16 * 1024;

// ── Input classification ────────────────────────────────────────────────────

export type Dispatch =
  | { kind: 'noop' }
  | { kind: 'meta'; sub: 'help' | 'quit' | 'exit' | 'clear' | 'transcript' | 'menu' | 'verbose' | 'quiet' | 'medium' | 'last' | 'again' | 'dry-run'; args?: string }
  | { kind: 'bash'; cmd: string }
  | { kind: 'chat'; msg: string };

const QUESTION_STARTERS = new Set([
  'what', 'why', 'how', 'which', 'when', 'where', 'who', 'whose',
  'should', 'shall', 'can', 'could', 'would', 'will', 'do', 'does', 'did',
  'is', 'are', 'am', 'was', 'were',
  'tell', 'explain', 'describe', 'help', 'hi', 'hello', 'hey', 'thanks',
]);

export function looksLikeQuestion(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  if (trimmed.endsWith('?')) return true;

  const words = trimmed.split(/\s+/);
  const firstWord = words[0].toLowerCase();

  if (QUESTION_STARTERS.has(firstWord)) return true;

  if (trimmed[0] === trimmed[0].toUpperCase() && trimmed[0] !== trimmed[0].toLowerCase() && words.length >= 3) {
    return true;
  }

  return false;
}

export function classifyInput(
  line: string,
  isExecutable: (name: string) => boolean
): Dispatch {
  const trimmed = line.trim();
  if (!trimmed) return { kind: 'noop' };

  if (trimmed === '/help') return { kind: 'meta', sub: 'help' };
  if (trimmed === '/quit') return { kind: 'meta', sub: 'quit' };
  if (trimmed === '/exit') return { kind: 'meta', sub: 'exit' };
  if (trimmed === '/clear') return { kind: 'meta', sub: 'clear' };
  if (trimmed === '/transcript') return { kind: 'meta', sub: 'transcript' };
  if (trimmed === '/menu') return { kind: 'meta', sub: 'menu' };
  if (trimmed === '/verbose') return { kind: 'meta', sub: 'verbose' };
  if (trimmed === '/quiet') return { kind: 'meta', sub: 'quiet' };
  if (trimmed === '/medium') return { kind: 'meta', sub: 'medium' };
  if (trimmed === '/last') return { kind: 'meta', sub: 'last' };
  if (trimmed === '/again') return { kind: 'meta', sub: 'again' };
  if (trimmed.startsWith('/? ')) return { kind: 'meta', sub: 'dry-run', args: trimmed.slice(3).trim() };

  if (trimmed.startsWith('!')) return { kind: 'bash', cmd: trimmed.slice(1).trim() };
  if (trimmed.startsWith('?')) return { kind: 'chat', msg: trimmed.slice(1).trim() };

  if (looksLikeQuestion(trimmed)) return { kind: 'chat', msg: trimmed };

  const firstToken = trimmed.split(/\s+/)[0];
  if (SHELL_BUILTINS.has(firstToken) || isExecutable(firstToken)) {
    return { kind: 'bash', cmd: trimmed };
  }

  return { kind: 'chat', msg: trimmed };
}

// ── Executable check ────────────────────────────────────────────────────────

function makeExecutableChecker(pathEnv: string | undefined): (name: string) => boolean {
  const cache = new Map<string, boolean>();
  const dirs = (pathEnv ?? '').split(':').filter(Boolean);

  return function isExecutable(name: string): boolean {
    if (cache.has(name)) return cache.get(name)!;
    for (const dir of dirs) {
      const full = join(dir, name);
      try {
        if (existsSync(full)) {
          const st = statSync(full);
          if (st.isFile() && (st.mode & 0o111) !== 0) {
            cache.set(name, true);
            return true;
          }
        }
      } catch {
        // skip
      }
    }
    cache.set(name, false);
    return false;
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

function tailBuffer(buf: string, maxBytes: number): string {
  if (buf.length <= maxBytes) return buf;
  return buf.slice(buf.length - maxBytes);
}

function formatTranscriptEntry(
  entry: { ts: string; kind: string; input?: string; output?: string; exitCode?: number }
): string {
  const time = entry.ts.slice(0, 19);
  const prefix = `[${time}] [${entry.kind}]`;
  const input = entry.input ? ` $ ${entry.input}` : '';
  const output = entry.output ? `\n  ${entry.output.split('\n').slice(0, 5).join('\n  ')}` : '';
  return `${prefix}${input}${output}`;
}

/** Shorten a path for display: replace HOME with ~, truncate if > 30 chars. */
function shortCwd(p: string): string {
  const home = homedir();
  const withTilde = p.startsWith(home) ? '~' + p.slice(home.length) : p;
  if (withTilde.length <= 30) return withTilde;
  const parts = withTilde.split(sep).filter(Boolean);
  if (parts.length <= 2) return withTilde;
  return '…' + sep + parts.slice(-2).join(sep);
}

/** Check whether opencode is reachable on PATH. */
function checkOpencodeAvailable(): boolean {
  try {
    execSync('which opencode', { stdio: 'pipe', timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

/** Extract the first ```bash / ```sh / ```shell block from markdown text. */
function extractFirstBashBlock(text: string): string | null {
  const match = text.match(/```(?:bash|sh|shell)\n([\s\S]*?)```/);
  return match ? match[1].trim() : null;
}

/** Read a single keypress in raw mode without the full prompter. */
async function readOneKey(): Promise<string> {
  return new Promise<string>((resolve) => {
    const stdin = process.stdin;
    const wasRaw = (stdin as any).isRaw ?? false;
    if ((stdin as any).setRawMode) (stdin as any).setRawMode(true);
    stdin.resume();
    function onData(buf: Buffer) {
      stdin.removeListener('data', onData);
      if ((stdin as any).setRawMode) (stdin as any).setRawMode(wasRaw);
      resolve(buf.toString()[0] ?? '');
    }
    stdin.on('data', onData);
  });
}

/** Copy text to clipboard using pbcopy (macOS) or xclip (Linux). */
function copyToClipboard(text: string): void {
  try {
    const cmd = process.platform === 'darwin' ? 'pbcopy' : 'xclip -selection clipboard';
    execSync(cmd, { input: text, stdio: ['pipe', 'ignore', 'ignore'], timeout: 3000 });
  } catch {
    // fall back silently
  }
}

// ── Main shell loop ─────────────────────────────────────────────────────────

export async function runShell(io: CliIo, style: Styler): Promise<number> {
  const env = io.env ?? {};
  const trueColor = supportsTrueColor(env);

  const banner = renderBanner({ color: true, trueColor });
  const motto = 'Agora Hub and marketplace — type a command, /help, or ask a question.';
  const mottoLine = gradientText(motto, { trueColor });
  const slashLine = style.dim(
    '/help · /menu · /transcript · /verbose · /medium · /quiet · /clear · /quit'
  );
  process.stdout.write(`\n${banner}\n\n${mottoLine}\n\n${slashLine}\n\n`);

  const opencodeAvailable = checkOpencodeAvailable();
  if (!opencodeAvailable) {
    process.stdout.write(
      style.dim('Note: opencode not found on PATH. Chat will be unavailable until installed.') + '\n\n'
    );
  }

  const dataDir = detectAgoraDataDir({ cwd: io.cwd, env: io.env });
  const cwd0 = io.cwd ?? process.cwd();
  let currentCwd = cwd0;

  let meta = loadSessionMeta(dataDir, cwd0);
  if (meta) {
    process.stdout.write(
      style.dim(
        `Resumed ${meta.turnCount} turns from ${meta.lastUsedAt.slice(0, 19)} · session ${(meta.sessionId ?? '').slice(0, 8)}…`
      ) + '\n\n'
    );
  } else {
    meta = {
      sessionId: null,
      cwd: cwd0,
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
      turnCount: 0,
    };
    writeSessionMeta(dataDir, cwd0, meta);
  }

  const isExecutable = makeExecutableChecker(env.PATH);

  let firstTurn = meta.turnCount === 0;
  let exitCode = 0;
  let verbosity: Verbosity = 'medium';
  let childActive = false;
  let totalCost = 0;

  // B.1 — separator state
  let printedAnyTurn = false;

  // B.2 — sticky context state
  let lastContextSnapshot: { model: string; verbosity: string; cwd: string; turnCount: number } | null = null;

  // Lazy caches for completion ids
  let cachedMarketplaceIds: string[] | null = null;
  let cachedSavedIds: string[] | null = null;

  function getMarketplaceIds(): string[] {
    if (!cachedMarketplaceIds) {
      cachedMarketplaceIds = getMarketplaceItems().map((item) => item.id);
    }
    return cachedMarketplaceIds;
  }

  function getSavedIds(): string[] {
    if (!cachedSavedIds) {
      const state = loadAgoraState(dataDir);
      cachedSavedIds = resolveSavedItems(state).map((e) => e.saved.id);
    }
    return cachedSavedIds;
  }

  const slashCommands = [
    '/help', '/menu', '/transcript', '/verbose', '/medium', '/quiet',
    '/clear', '/quit', '/exit', '/last', '/again',
  ];

  const completionContext = {
    slashCommands,
    agoraCommands: COMMANDS.map((c) => c.name),
    marketplaceIds: getMarketplaceIds,
    savedIds: getSavedIds,
    listDir: (p: string) => {
      try { return readdirSync(p); } catch { return []; }
    },
    cwd: currentCwd,
  };

  // In-memory history for prompter (not persisted — transcript covers that)
  const history: string[] = [];

  // Amber chevron when opencode unavailable, accent otherwise
  const accentChevron = opencodeAvailable
    ? style.accent('›')
    : '\x1b[38;5;214m›\x1b[0m';

  // B.3 — static portion of the prompt (no chevron); suffix added dynamically
  function buildPromptBase(): string {
    return style.accent('agora') + ' ' + style.dim(shortCwd(currentCwd)) + ' ';
  }

  function buildPromptSuffix(line: string): string {
    const d = classifyInput(line, isExecutable);
    const hint = d.kind === 'bash' ? style.accent('$') : d.kind === 'chat' ? style.accent('?') : '';
    return hint + accentChevron + ' ';
  }

  function buildContextLine(): string {
    const model = FREE_MODELS[0];
    const costStr = totalCost > 0 ? `$${totalCost.toFixed(4)}` : '$0';
    const turns = meta?.turnCount ?? 0;
    const cwd = shortCwd(currentCwd);
    return style.dim(`[opencode/${model} · ${verbosity} · ${turns} turns · ${costStr} · ${cwd}]`);
  }

  // B.1 — thin dim horizontal rule between turns
  function printSeparator(): void {
    if (!printedAnyTurn) return;
    const width = process.stdout.columns ?? 80;
    process.stdout.write('\n' + style.dim('─'.repeat(width)) + '\n\n');
  }

  // B.2 — print context line only when it changed or every 10 turns
  function maybePrintContextLine(): void {
    const model = FREE_MODELS[0];
    const turns = meta?.turnCount ?? 0;
    const cwd = shortCwd(currentCwd);
    const snap = { model, verbosity, cwd, turnCount: turns };
    const shouldPrint =
      lastContextSnapshot === null ||
      snap.model !== lastContextSnapshot.model ||
      snap.verbosity !== lastContextSnapshot.verbosity ||
      snap.cwd !== lastContextSnapshot.cwd ||
      turns % 10 === 0;
    if (shouldPrint) {
      process.stdout.write(buildContextLine() + '\n');
      lastContextSnapshot = snap;
    }
  }

  const sigintHandler = () => {
    if (childActive) return;
    // Ctrl-C while idle: the prompter handles abort; SIGINT from outside is rare
    process.stdout.write('\n');
    process.exit(0);
  };
  process.on('SIGINT', sigintHandler);

  try {
    for (;;) {
      // Update completionContext.cwd on each iteration in case cd changed it
      completionContext.cwd = currentCwd;

      // B.1 — separator after each completed turn
      printSeparator();

      // B.2 — sticky context line
      maybePrintContextLine();

      const result = await readLine({
        prompt: buildPromptBase(),
        promptSuffix: buildPromptSuffix,
        history,
        completer: (line, cursor) => completeShellLine(line, cursor, completionContext),
        ghostSuggester: (line, hist) => ghostFromHistory(line, hist),
      });

      if (result.kind === 'eof') {
        process.stdout.write('\n');
        break;
      }

      if (result.kind === 'abort') {
        // Ctrl-C in prompter: clear input and continue
        process.stdout.write('\n');
        continue;
      }

      const line = result.value;
      if (!line.trim()) continue;

      // Add to history
      if (history[history.length - 1] !== line) {
        history.push(line);
      }

      const dispatch = classifyInput(line, isExecutable);

      if (dispatch.kind === 'noop') continue;

      if (dispatch.kind === 'meta') {
        if (dispatch.sub === 'quit' || dispatch.sub === 'exit') break;

        if (dispatch.sub === 'clear') {
          process.stdout.write('\x1b[2J\x1b[H');
          // B.1: do NOT print separator after clear
          printedAnyTurn = false;
          continue;
        }

        if (dispatch.sub === 'help') {
          printHelp(style);
          continue;
        }

        if (dispatch.sub === 'transcript') {
          const entries = readTranscript(dataDir, cwd0, { tail: 20 });
          if (entries.length === 0) {
            process.stdout.write(style.dim('No transcript entries yet.') + '\n');
          } else {
            for (const e of entries) {
              process.stdout.write(formatTranscriptEntry(e) + '\n');
            }
          }
          continue;
        }

        if (dispatch.sub === 'menu') {
          await runInteractiveMenu(io, style);
          continue;
        }

        if (dispatch.sub === 'verbose' || dispatch.sub === 'quiet' || dispatch.sub === 'medium') {
          verbosity = dispatch.sub;
          process.stdout.write(style.dim(`Verbosity: ${verbosity}`) + '\n');
          continue;
        }

        if (dispatch.sub === 'last') {
          const entries = readTranscript(dataDir, cwd0);
          const lastBash = [...entries].reverse().find((e) => e.kind === 'bash' && e.input);
          if (!lastBash || !lastBash.input) {
            process.stdout.write(style.dim('No previous bash command in this session.') + '\n');
            continue;
          }
          // Re-dispatch as bash
          history.push(lastBash.input);
          const bashDispatch: Dispatch = { kind: 'bash', cmd: lastBash.input };
          await runBash(bashDispatch.cmd);
          continue;
        }

        if (dispatch.sub === 'again') {
          const entries = readTranscript(dataDir, cwd0);
          const lastChat = [...entries].reverse().find((e) => e.kind === 'chat-user' && e.input);
          if (!lastChat || !lastChat.input) {
            process.stdout.write(style.dim('No previous chat message in this session.') + '\n');
            continue;
          }
          await runChat(lastChat.input);
          continue;
        }

        if (dispatch.sub === 'dry-run' && dispatch.args) {
          const args = dispatch.args.split(/\s+/).filter(Boolean);
          process.stdout.write(style.dim(`╤ dry-run · agora ${args.join(' ')}`) + '\n');
          try {
            const out = execSync(`agora ${args.join(' ')}`, { timeout: 15000, encoding: 'utf8' });
            process.stdout.write(out + '\n');
          } catch (e: any) {
            process.stdout.write((e.stdout ?? '') + (e.stderr ?? '') + '\n');
          }
          printedAnyTurn = true;
          continue;
        }

        printedAnyTurn = true;
        continue;
      }

      if (dispatch.kind === 'bash') {
        await runBash(dispatch.cmd);
        printedAnyTurn = true;
        continue;
      }

      if (dispatch.kind === 'chat') {
        if (!opencodeAvailable) {
          process.stdout.write(
            style.dim('opencode is not available on PATH. Install it to use chat.') + '\n'
          );
          printedAnyTurn = true;
          continue;
        }
        await runChat(dispatch.msg);
        printedAnyTurn = true;
      }
    }
  } finally {
    process.removeListener('SIGINT', sigintHandler);
  }

  return exitCode;

  // ── Bash runner ─────────────────────────────────────────────────────────

  async function runBash(cmd: string): Promise<void> {
    const cdMatch = cmd.match(/^cd(?:\s+(.+))?$/);
    if (cdMatch) {
      const target = cdMatch[1]?.trim() ?? homedir();
      const resolved = resolve(currentCwd, expandHome(target));
      currentCwd = resolved;
      completionContext.cwd = resolved;
      process.stdout.write(style.dim(`→ ${resolved}`) + '\n');
      appendTranscript(dataDir, cwd0, {
        ts: new Date().toISOString(),
        kind: 'bash',
        input: cmd,
        output: `→ ${resolved}`,
      });
      if (firstTurn) {
        firstTurn = false;
        process.stdout.write(style.dim('Tip: type `/help` to see all agora commands.') + '\n');
      }
      return;
    }

    let buffer = '';
    let done = false;
    let childExitCode = 0;
    let childRef: ReturnType<typeof spawn> | null = null;

    const abortChild = () => { if (childRef) childRef.kill('SIGINT'); };
    process.on('SIGINT', abortChild);
    childActive = true;

    await new Promise<void>((res) => {
      const child = spawn(cmd, {
        shell: true,
        cwd: currentCwd,
        env: env as Record<string, string>,
        stdio: ['inherit', 'pipe', 'pipe'],
      });
      childRef = child;

      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        process.stdout.write(text);
        buffer = tailBuffer(buffer + text, MAX_BASH_BUFFER);
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        process.stderr.write(text);
        buffer = tailBuffer(buffer + text, MAX_BASH_BUFFER);
      });

      child.on('close', (code) => { childExitCode = code ?? 0; done = true; res(); });
      child.on('error', (err) => {
        process.stderr.write(`Error: ${err.message}\n`);
        done = true;
        res();
      });
    });

    process.removeListener('SIGINT', abortChild);
    childActive = false;
    if (!done) childExitCode = 1;

    // B.4 — show non-zero exit code
    if (childExitCode !== 0) {
      process.stdout.write(style.dim(`· exit ${childExitCode}`) + '\n');
    }

    appendTranscript(dataDir, cwd0, {
      ts: new Date().toISOString(),
      kind: 'bash',
      input: cmd,
      output: buffer,
      exitCode: childExitCode,
    });

    if (firstTurn) {
      firstTurn = false;
      process.stdout.write(style.dim('Tip: type `/help` to see all agora commands.') + '\n');
    }
  }

  // ── Chat runner ──────────────────────────────────────────────────────────

  async function runChat(userMsg: string): Promise<void> {
    const bashCtx = recentBashContext(dataDir, cwd0, { commands: 3, lines: 20 });

    const systemLine =
      'You are running inside the Agora shell, a marketplace TUI for OpenCode. ' +
      'Prefer using the agora_* MCP tools when the user asks marketplace questions. ' +
      'Be concise; output flows directly to a terminal.';

    let fullPrompt = `<system>\n${systemLine}`;
    if (bashCtx) fullPrompt += `\n${bashCtx}`;
    fullPrompt += `\n<user>\n${userMsg}`;

    const modelArg = FREE_MODELS[0].includes('/')
      ? FREE_MODELS[0]
      : `opencode/${FREE_MODELS[0]}`;

    const args = ['run', '--format', 'json', '--model', modelArg];
    if (meta!.sessionId) args.push('--session', meta!.sessionId);
    args.push(fullPrompt);

    const renderer = createChatRenderer({
      verbosity,
      style,
      trueColor,
      out: process.stdout,
    });

    let chatChildRef: ReturnType<typeof spawn> | null = null;
    const abortChat = () => { if (chatChildRef) chatChildRef.kill('SIGINT'); };
    process.on('SIGINT', abortChat);
    childActive = true;

    // B.4 — accumulate last 4 KB of stderr for failure diagnosis
    let errBuffer = '';
    let chatExitCode = 0;
    let spawnError: Error | null = null;

    await new Promise<void>((res) => {
      const child = spawn('opencode', args, {
        env: env as Record<string, string>,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
      chatChildRef = child;

      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        for (const rawLine of text.split('\n').filter(Boolean)) {
          renderer.handleLine(rawLine);
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        errBuffer = tailBuffer(errBuffer + chunk.toString(), 4096);
      });
      child.on('close', (code) => { chatExitCode = code ?? 0; res(); });
      child.on('error', (err) => {
        spawnError = err;
        res();
      });
    });

    process.removeListener('SIGINT', abortChat);
    childActive = false;

    renderer.finalize();
    totalCost += renderer.getTotalCost();

    // B.4 — detect and report chat failures
    const chatFailed = spawnError !== null || (chatExitCode !== 0 && !renderer.hasReceivedText());
    if (chatFailed) {
      let reason: string;
      if (spawnError) {
        reason = 'opencode binary not found';
      } else if (errBuffer.includes('Model not found')) {
        reason = '/model to pick another model (or check OPENCODE_MODEL)';
      } else {
        reason = 'chat failed; see /transcript for details';
      }
      process.stdout.write('\x1b[31m▍\x1b[0m' + style.dim(` failed · ${reason}`) + '\n');
    }

    const renderedSessionId = renderer.getSessionId();
    if (!meta!.sessionId && renderedSessionId) {
      meta!.sessionId = renderedSessionId;
      writeSessionMeta(dataDir, cwd0, meta!);
    }

    const assistantBuffer = renderer.getAssistantText();
    appendTranscript(dataDir, cwd0, {
      ts: new Date().toISOString(),
      kind: 'chat-user',
      input: userMsg,
    });
    appendTranscript(dataDir, cwd0, {
      ts: new Date().toISOString(),
      kind: 'chat-assistant',
      output: assistantBuffer,
    });

    meta!.turnCount += 1;
    meta!.lastUsedAt = new Date().toISOString();
    writeSessionMeta(dataDir, cwd0, meta!);

    if (firstTurn) {
      firstTurn = false;
      process.stdout.write(style.dim('Tip: type `/help` to see all agora commands.') + '\n');
    }

    // Code-block hotkeys
    await handleCodeBlock(assistantBuffer);
  }

  // ── Code-block hotkeys ───────────────────────────────────────────────────

  async function handleCodeBlock(text: string): Promise<void> {
    const block = extractFirstBashBlock(text);
    if (!block) return;

    process.stdout.write(
      style.dim('Code block: ') +
      style.accent('(r)un · (c)opy · (e)dit · (s)kip') +
      ' '
    );

    const key = await readOneKey();
    process.stdout.write('\n');

    if (key === 'r') {
      await runBash(block);
      appendTranscript(dataDir, cwd0, {
        ts: new Date().toISOString(),
        kind: 'bash',
        input: block,
        output: '',
      });
    } else if (key === 'c') {
      copyToClipboard(block);
      process.stdout.write(style.dim('Copied to clipboard.') + '\n');
    } else if (key === 'e') {
      const tmpDir = mkdtempSync(join(tmpdir(), 'agora-'));
      const tmpFile = join(tmpDir, 'block.sh');
      writeFileSync(tmpFile, block, 'utf8');
      const editor = process.env.EDITOR ?? 'vi';
      await new Promise<void>((res) => {
        const child = spawn(editor, [tmpFile], { stdio: 'inherit', shell: false });
        child.on('close', () => res());
        child.on('error', () => res());
      });
      // After editor, offer run/skip
      process.stdout.write(style.dim('(r)un · (s)kip '));
      const key2 = await readOneKey();
      process.stdout.write('\n');
      if (key2 === 'r') {
        const { readFileSync } = await import('node:fs');
        const edited = readFileSync(tmpFile, 'utf8').trim();
        await runBash(edited);
      }
    }
    // s or other: skip silently
  }
}

function printHelp(style: Styler): void {
  const lines: string[] = [
    style.accent('Agora Shell — help'),
    '',
    style.dim('Dispatch rules:'),
    '  <command>     first word on PATH → run as bash',
    '  <anything>    else → send to AI chat',
    '  !<cmd>        force bash (e.g. !ls -la)',
    '  ?<msg>        force chat (e.g. ?what is MCP)',
    '  /menu         open command browser',
    '  /transcript   print last 20 transcript entries',
    '  /clear        clear screen',
    '  /help         this help',
    '  /quit         exit shell',
    '  /last         re-run most recent bash command',
    '  /again        re-send most recent chat message',
    '  /? <cmd>      dry-run an agora command (e.g. /? install mcp-github)',
    '',
    style.dim('Verbosity:'),
    '  /verbose  /medium  /quiet',
    '',
    style.dim('Agora commands:'),
  ];

  const groups = ['Marketplace', 'Setup', 'Library', 'Learn', 'Community'] as const;
  for (const g of groups) {
    const cmds = COMMANDS.filter((c) => c.group === g);
    lines.push(`  ${style.dim(g)}`);
    for (const c of cmds) {
      lines.push(`    ${style.accent(c.name.padEnd(14))}  ${c.summary}`);
    }
  }

  process.stdout.write(lines.join('\n') + '\n\n');
}
