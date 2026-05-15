import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { COMMANDS } from './commands-meta.js';
import { runInteractiveMenu } from './menu.js';
import { FREE_MODELS } from './app.js';
import { detectAgoraDataDir } from '../state.js';
import {
  appendTranscript,
  loadSessionMeta,
  readTranscript,
  recentBashContext,
  writeSessionMeta,
} from '../transcript.js';
import { gradientText, renderBanner, supportsTrueColor, type Styler } from '../ui.js';
import { createChatRenderer, type Verbosity } from './chat-renderer.js';
import type { CliIo } from './app.js';

const SHELL_BUILTINS = new Set(['cd', 'export', 'alias', 'source', 'unset', 'umask', 'exec']);
const MAX_BASH_BUFFER = 16 * 1024;

// ── Input classification ────────────────────────────────────────────────────

export type Dispatch =
  | { kind: 'noop' }
  | { kind: 'meta'; sub: 'help' | 'quit' | 'exit' | 'clear' | 'transcript' | 'menu' | 'verbose' | 'quiet' | 'medium' }
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

  // Rule 1: trailing ?
  if (trimmed.endsWith('?')) return true;

  const words = trimmed.split(/\s+/);
  const firstWord = words[0].toLowerCase();

  // Rule 2: known question-starter word
  if (QUESTION_STARTERS.has(firstWord)) return true;

  // Rule 3: first char uppercase AND 3+ words
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
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  let firstTurn = meta.turnCount === 0;
  let exitCode = 0;
  let verbosity: Verbosity = 'medium';

  // SIGINT routing: while a child is running, the per-child handler aborts
  // it; while idle in the readline prompt, SIGINT closes the shell. Without
  // this gate, both fire on a single Ctrl-C and a long-running `npm install`
  // would exit the entire shell when the user just meant to abort the cmd.
  let childActive = false;
  let sigintReceived = false;
  const sigintHandler = () => {
    if (childActive) return;
    sigintReceived = true;
    process.stdout.write('\n');
    rl.close();
  };
  process.on('SIGINT', sigintHandler);

  const prompt = style.accent('agora') + style.dim(' › ');

  try {
    for (;;) {
      if (sigintReceived) break;

      let line: string;
      try {
        const answer = await rl.question(prompt);
        line = answer;
      } catch {
        // EOF (Ctrl-D)
        process.stdout.write('\n');
        break;
      }

      if (sigintReceived) break;

      const dispatch = classifyInput(line, isExecutable);

      if (dispatch.kind === 'noop') continue;

      if (dispatch.kind === 'meta') {
        if (dispatch.sub === 'quit' || dispatch.sub === 'exit') break;

        if (dispatch.sub === 'clear') {
          process.stdout.write('\x1b[2J\x1b[H');
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

        continue;
      }

      if (dispatch.kind === 'bash') {
        const cmd = dispatch.cmd;

        // Handle cd specially
        const cdMatch = cmd.match(/^cd(?:\s+(.+))?$/);
        if (cdMatch) {
          const target = cdMatch[1]?.trim() ?? homedir();
          const resolved = resolve(currentCwd, expandHome(target));
          currentCwd = resolved;
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
          continue;
        }

        let buffer = '';
        let done = false;
        let childExitCode = 0;

        let childRef: ReturnType<typeof spawn> | null = null;
        const abortChild = () => {
          if (childRef) childRef.kill('SIGINT');
        };
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

          child.on('close', (code) => {
            childExitCode = code ?? 0;
            done = true;
            res();
          });

          child.on('error', (err) => {
            process.stderr.write(`Error: ${err.message}\n`);
            done = true;
            res();
          });
        });

        process.removeListener('SIGINT', abortChild);
        childActive = false;
        if (!done) childExitCode = 1;

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
        continue;
      }

      if (dispatch.kind === 'chat') {
        const userMsg = dispatch.msg;
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
        if (meta.sessionId) args.push('--session', meta.sessionId);
        args.push(fullPrompt);

        const renderer = createChatRenderer({
          verbosity,
          style,
          trueColor,
          out: process.stdout,
        });

        let chatChildRef: ReturnType<typeof spawn> | null = null;
        const abortChat = () => {
          if (chatChildRef) chatChildRef.kill('SIGINT');
        };
        process.on('SIGINT', abortChat);
        childActive = true;

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

          child.stderr?.on('data', (_chunk: Buffer) => {
            // swallow stderr; errors surface via exit code
          });

          child.on('close', () => res());
          child.on('error', (err) => {
            process.stderr.write(`Failed to run opencode: ${err.message}\n`);
            res();
          });
        });

        process.removeListener('SIGINT', abortChat);
        childActive = false;

        renderer.finalize();

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

        meta.turnCount += 1;
        meta.lastUsedAt = new Date().toISOString();
        writeSessionMeta(dataDir, cwd0, meta);

        if (firstTurn) {
          firstTurn = false;
          process.stdout.write(style.dim('Tip: type `/help` to see all agora commands.') + '\n');
        }
      }
    }
  } finally {
    process.removeListener('SIGINT', sigintHandler);
    rl.close();
  }

  return exitCode;
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
