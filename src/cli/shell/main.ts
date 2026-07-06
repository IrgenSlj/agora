import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getMarketplaceItems } from '../../marketplace.js';
import { buildOpencodeRunArgs, spawnOpencode } from '../../opencode-exec.js';
import { detectAgoraDataDir, loadAgoraState, resolveSavedItems } from '../../state.js';
import {
  appendTranscript,
  listSessions,
  loadSessionMeta,
  readTranscript,
  recentBashContext,
  searchTranscripts,
  writeSessionMeta
} from '../../transcript.js';
import { gradientText, renderBanner, type Styler, supportsTrueColor } from '../../ui.js';
import { AGORA_VERSION } from '../app.js';
import { createChatRenderer, type Verbosity } from '../chat-renderer.js';
import { FREE_MODELS } from '../commands/chat.js';
import { COMMANDS } from '../commands-meta.js';
import { completeShellLine, ghostFromHistory } from '../completions.js';
import type { CliIo } from '../flags.js';
import { runInteractiveMenu } from '../menu.js';
import { readLine } from '../prompter.js';
import { runTui } from '../tui.js';
import {
  checkOpencodeAvailable,
  copyToClipboard,
  expandHome,
  extractFirstBashBlock,
  MAX_BASH_BUFFER,
  makeExecutableChecker,
  readOneKey,
  shortCwd,
  tailBuffer
} from './bash.js';
import { appendShellHistory, loadShellHistory } from './history.js';
import { classifyInput } from './input.js';
import type { Dispatch } from './types.js';

export async function runShell(io: CliIo, style: Styler): Promise<number> {
  const env = io.env ?? {};
  const trueColor = supportsTrueColor(env);

  function printHome(): void {
    const banner = renderBanner({ color: true, trueColor });
    const motto = 'The system manager for your agentic stack - type a command, bash or chat:';
    const mottoLine = gradientText(motto, { trueColor });
    const model = FREE_MODELS[0];
    const infoLine = style.dim(
      `v${AGORA_VERSION} · ${model} · /abc · /help · /menu · /search · /quit`
    );
    const slashLine = style.orange('/home · /catalog · /news · /settings');
    process.stdout.write(`\n${banner}\n\n${mottoLine}\n\n${infoLine}\n${slashLine}\n\n`);
  }

  printHome();

  const opencodeAvailable = checkOpencodeAvailable(env);
  if (!opencodeAvailable) {
    process.stdout.write(
      style.dim('Note: opencode not found on PATH. Chat will be unavailable until installed.') +
        '\n\n'
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
      turnCount: 0
    };
    writeSessionMeta(dataDir, cwd0, meta);
  }

  const isExecutable = makeExecutableChecker(env.PATH);

  let firstTurn = meta.turnCount === 0;
  const exitCode = 0;
  let verbosity: Verbosity = 'medium';
  let childActive = false;
  let totalCost = 0;
  const trackedEnv = new Map<string, string>();
  let jobCounter = 0;
  const jobs: Map<number, { pid: number; cmd: string; status: 'running' | 'stopped' }> = new Map();

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

  const agoraSlashCommands = COMMANDS.map((c) => '/' + c.name);
  const slashCommands = [
    '/tui',
    '/home',
    '/catalog',
    '/news',
    '/settings',
    '/abc',
    '/help',
    '/menu',
    '/transcript',
    '/verbose',
    '/medium',
    '/quiet',
    '/clear',
    '/quit',
    '/exit',
    '/last',
    '/again',
    '/env',
    '/jobs',
    '/fg',
    '/bg',
    '/sessions',
    '/recall',
    ...agoraSlashCommands
  ];

  const seen = new Set<string>();
  const deduped = slashCommands.filter((c) => {
    if (seen.has(c)) return false;
    seen.add(c);
    return true;
  });
  const finalSlashCommands = deduped;

  const completionContext = {
    slashCommands: finalSlashCommands,
    marketplaceIds: getMarketplaceIds,
    savedIds: getSavedIds,
    listDir: (p: string) => {
      try {
        return readdirSync(p);
      } catch {
        return [];
      }
    },
    cwd: currentCwd
  };

  const history: string[] = loadShellHistory(dataDir);

  const tips = [
    'type /abc for a quick letter-shortcut reference (/a /b /c ...)',
    'type /help to see all slash commands',
    'type /menu to browse the command catalog',
    'type ?<msg> to force AI chat',
    'type !<cmd> to force bash',
    'type /clear to reset and see the home banner',
    'type /transcript to see your last 20 commands',
    'type /last to re-run the last bash command',
    'type /again to re-send the last chat message',
    'type /? <agora_cmd> to dry-run an agora command',
    'type ?how do I use MCP? to ask about the catalog',
    'type /verbose for detailed AI responses',
    'type /quiet for minimal AI responses',
    'type /env to view tracked env vars, /env FOO=val to set one',
    'press Tab to auto-complete commands and paths',
    'press Ctrl-R to reverse-search your history',
    'press Ctrl-L to clear the screen',
    'press Esc to dismiss ghost suggestions',
    'run `agora search --table` for a table view',
    'run `agora search --sort stars` to sort by stars',
    'run `agora search --sort name --order asc` for alphabetical',
    'run `agora completions bash | source /dev/stdin` for bash completions',
    'run `agora completions zsh > /usr/local/share/zsh/site-functions/_agora` for zsh completions',
    'run `agora completions fish > ~/.config/fish/completions/agora.fish` for fish completions',
    'type /home to open the TUI Home page',
    'type /catalog to open the TUI Search page',
    'type /settings to open the TUI Settings page',
    'run `agora save <id>` to bookmark a package',
    'run `agora saved` to see your saved items',
    'run `agora auth login --api-url <url>` to enable live catalog search',
    'run `agora config doctor` to check your OpenCode config',
    'type VAR=val command to set env vars in bash',
    'pipe output with | or redirect with > as normal in bash',
    'append & to run a command in the background',
    'type /jobs to see background jobs, /fg to bring one forward',
    'type /bg to resume a stopped job in the background',
    'run `agora shell` anywhere to re-enter this interactive mode'
  ];
  const accentChevron = opencodeAvailable ? style.accent('›') : style.orange('›');

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
    const turnCount = meta?.turnCount ?? 0;
    const tip = tips[turnCount % tips.length];
    const parts = [`model: ${model}`, `${turnCount} turns`];
    if (totalCost > 0) parts.push(`$${totalCost.toFixed(6)}`);
    parts.push(tip);
    return style.dim(parts.join(' · '));
  }

  const sigintHandler = () => {
    if (childActive) return;
  };
  process.on('SIGINT', sigintHandler);

  try {
    for (;;) {
      completionContext.cwd = currentCwd;

      const result = await readLine({
        prompt: buildPromptBase(),
        promptSuffix: buildPromptSuffix,
        history,
        completer: (line, cursor) => completeShellLine(line, cursor, completionContext),
        ghostSuggester: (line, hist) => ghostFromHistory(line, hist),
        footer: () => buildContextLine()
      });

      if (result.kind === 'eof') {
        process.stdout.write('\n');
        break;
      }

      if (result.kind === 'abort') {
        process.stdout.write('\n');
        continue;
      }

      const line = result.value;
      if (!line.trim()) continue;

      if (history[history.length - 1] !== line) {
        history.push(line);
        appendShellHistory(dataDir, line);
      }

      const dispatch = classifyInput(line, isExecutable);

      if (dispatch.kind === 'noop') continue;

      if (dispatch.kind === 'meta') {
        if (dispatch.sub === 'quit' || dispatch.sub === 'exit') break;

        if (dispatch.sub === 'clear') {
          process.stdout.write('\x1b[2J\x1b[H');
          printHome();
          continue;
        }

        if (dispatch.sub === 'abc') {
          printLetterHelp(style);
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

        if (dispatch.sub === 'terminal') {
          process.stdout.write(style.dim('Entering subshell. Type exit or Ctrl-D to return.\n'));
          const child = spawn(process.env.SHELL || 'bash', [], {
            stdio: 'inherit',
            cwd: currentCwd,
            env: env as Record<string, string>
          });
          await new Promise<void>((res) => child.on('exit', () => res()));
          process.stdout.write('\n');
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
          continue;
        }

        if (dispatch.sub === 'jobs') {
          if (jobs.size === 0) {
            process.stdout.write(
              style.dim('No background jobs. Append & to run a command in the background.') + '\n'
            );
          } else {
            process.stdout.write(style.accent('Background jobs') + '\n');
            for (const [id, job] of jobs) {
              const status = job.status === 'running' ? style.dim('running') : style.dim('stopped');
              process.stdout.write(`  [${id}] ${status}  ${job.cmd}\n`);
            }
          }
          continue;
        }

        if (dispatch.sub === 'fg') {
          if (jobs.size === 0) {
            process.stdout.write(
              style.dim('No background jobs. Append & to run a command in the background.') + '\n'
            );
            continue;
          }
          const arg = dispatch.args || '';
          if (arg && Number.isNaN(parseInt(arg, 10))) {
            process.stdout.write(style.dim(`Invalid job id: ${arg}`) + '\n');
            continue;
          }
          const targetId = arg ? parseInt(arg, 10) : Math.max(...Array.from(jobs.keys()));
          const job = jobs.get(targetId);
          if (!job) {
            process.stdout.write(style.dim(`Job ${targetId} not found.`) + '\n');
            continue;
          }
          try {
            process.kill(job.pid, 0);
            process.stdout.write(style.dim(`Foreground: ${job.cmd}`) + '\n');
            await new Promise<void>((resolve) => {
              const check = setInterval(() => {
                try {
                  process.kill(job.pid, 0);
                } catch {
                  clearInterval(check);
                  jobs.delete(targetId);
                  resolve();
                }
              }, 200);
            });
          } catch {
            jobs.delete(targetId);
            process.stdout.write(style.dim(`Job ${targetId} has finished.`) + '\n');
          }
          continue;
        }

        if (dispatch.sub === 'sessions') {
          const sessions = listSessions(dataDir);
          if (sessions.length === 0) {
            process.stdout.write(style.dim('No sessions recorded yet.') + '\n');
          } else {
            process.stdout.write(style.accent('Recent sessions') + '\n');
            for (const s of sessions) {
              const activity = s.lastActivity.slice(0, 19);
              const turns = s.turnCount + (s.turnCount === 1 ? ' turn' : ' turns');
              process.stdout.write(
                '  ' +
                  style.dim(activity) +
                  '  ' +
                  style.accent(shortCwd(s.cwd)) +
                  '  ' +
                  style.dim(turns) +
                  '\n'
              );
            }
          }
          continue;
        }

        if (dispatch.sub === 'recall') {
          const query = dispatch.args ?? '';
          if (!query) {
            process.stdout.write(style.dim('Usage: /recall <query>') + '\n');
            continue;
          }
          const matches = searchTranscripts(dataDir, query);
          if (matches.length === 0) {
            process.stdout.write(style.dim('no matches') + '\n');
          } else {
            for (const m of matches) {
              process.stdout.write(
                style.dim(shortCwd(m.cwd) + '  ' + m.timestamp.slice(0, 19)) + '\n'
              );
              process.stdout.write('  ' + m.snippet + '\n');
            }
          }
          continue;
        }

        if (dispatch.sub === 'bg') {
          if (jobs.size === 0) {
            process.stdout.write(
              style.dim('No background jobs. Append & to run a command in the background.') + '\n'
            );
            continue;
          }
          const arg = dispatch.args || '';
          if (arg && Number.isNaN(parseInt(arg, 10))) {
            process.stdout.write(style.dim(`Invalid job id: ${arg}`) + '\n');
            continue;
          }
          const targetId = arg ? parseInt(arg, 10) : Math.max(...Array.from(jobs.keys()));
          const job = jobs.get(targetId);
          if (!job) {
            process.stdout.write(style.dim(`Job ${targetId} not found.`) + '\n');
            continue;
          }
          try {
            process.kill(job.pid, 0);
            job.status = 'running';
            process.stdout.write(style.dim(`[${targetId}] ${job.cmd} (background)`) + '\n');
          } catch {
            jobs.delete(targetId);
            process.stdout.write(style.dim(`Job ${targetId} has finished.`) + '\n');
          }
          continue;
        }

        if (dispatch.sub === 'env') {
          const arg = dispatch.args || '';
          if (!arg) {
            if (trackedEnv.size === 0) {
              process.stdout.write(
                style.dim('No tracked environment variables. Use /env VAR=value to set one.') + '\n'
              );
            } else {
              process.stdout.write(style.accent('Tracked environment') + '\n');
              for (const [k, v] of [...trackedEnv.entries()].sort()) {
                process.stdout.write(`  ${k}=${v}\n`);
              }
            }
          } else if (arg.includes('=')) {
            const eqIdx = arg.indexOf('=');
            const key = arg.slice(0, eqIdx).trim();
            const val = arg.slice(eqIdx + 1).trim();
            trackedEnv.set(key, val);
            process.stdout.write(style.dim(`${key}=${val} (tracked)`) + '\n');
          } else {
            const val = trackedEnv.get(arg);
            if (val === undefined) {
              process.stdout.write(style.dim(`${arg} is not tracked.`) + '\n');
            } else {
              process.stdout.write(`${arg}=${val}\n`);
            }
          }
          continue;
        }

        continue;
      }

      if (dispatch.kind === 'tui') {
        await runTui(io, { initial: dispatch.page ?? 'home' });
        continue;
      }

      if (dispatch.kind === 'bash') {
        const bashLine = dispatch.cmd;
        const exportMatch = bashLine.match(/^export\s+([A-Za-z_][A-Za-z0-9_]*)=(.+)$/);
        if (exportMatch) {
          trackedEnv.set(exportMatch[1], exportMatch[2].trim());
        } else {
          const prefixMatch = bashLine.match(/^([A-Za-z_][A-Za-z0-9_]*)=(\S+)\s+/);
          if (prefixMatch) {
            trackedEnv.set(prefixMatch[1], prefixMatch[2].trim());
          }
        }

        const bgMatch = bashLine.match(/^(.*?)\s*&$/);
        if (bgMatch) {
          const actualCmd = bgMatch[1].trim();
          if (actualCmd) {
            jobCounter++;
            const jobId = jobCounter;
            const child = spawn(actualCmd, {
              shell: true,
              cwd: currentCwd,
              env: env as Record<string, string>,
              stdio: ['ignore', 'pipe', 'pipe']
            });
            jobs.set(jobId, { pid: child.pid ?? 0, cmd: actualCmd, status: 'running' });
            process.stdout.write(
              style.dim(`[${jobId}] ${actualCmd} (background, pid ${child.pid ?? '?'})`) + '\n'
            );
            child.stdout?.on('data', (chunk: Buffer) => {
              const text = chunk.toString();
              const lines = text.split('\n').filter(Boolean);
              for (const l of lines)
                process.stdout.write(style.dim(`[${jobId}] ${l.trimRight()} |> `));
            });
            child.on('close', (code) => {
              jobs.delete(jobId);
              process.stdout.write(style.dim(`[${jobId}] finished (exit ${code ?? 0})`) + '\n');
            });
            continue;
          }
        }
        await runBash(dispatch.cmd);
        continue;
      }

      if (dispatch.kind === 'chat') {
        if (!opencodeAvailable) {
          process.stdout.write(
            style.dim('opencode is not available on PATH. Install it to use chat.') + '\n'
          );
          continue;
        }
        await runChat(dispatch.msg);
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
      if (!existsSync(resolved)) {
        process.stdout.write(`cd: no such file or directory: ${target}\n`);
        appendTranscript(dataDir, cwd0, {
          ts: new Date().toISOString(),
          kind: 'bash',
          input: cmd,
          output: `cd: no such file or directory: ${target}`,
          exitCode: 1
        });
        return;
      }
      if (!statSync(resolved).isDirectory()) {
        process.stdout.write(`cd: not a directory: ${target}\n`);
        appendTranscript(dataDir, cwd0, {
          ts: new Date().toISOString(),
          kind: 'bash',
          input: cmd,
          output: `cd: not a directory: ${target}`,
          exitCode: 1
        });
        return;
      }
      currentCwd = resolved;
      completionContext.cwd = resolved;
      process.stdout.write(style.dim(`→ ${resolved}`) + '\n');
      appendTranscript(dataDir, cwd0, {
        ts: new Date().toISOString(),
        kind: 'bash',
        input: cmd,
        output: `→ ${resolved}`
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
        stdio: ['inherit', 'pipe', 'pipe']
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

    if (childExitCode !== 0) {
      process.stdout.write(style.dim(`· exit ${childExitCode}`) + '\n');
    }

    appendTranscript(dataDir, cwd0, {
      ts: new Date().toISOString(),
      kind: 'bash',
      input: cmd,
      output: buffer,
      exitCode: childExitCode
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
      'You are running inside the Agora shell, a system-manager TUI for OpenCode. ' +
      'Prefer using the agora_* MCP tools when the user asks catalog questions. ' +
      'Be concise; output flows directly to a terminal.';

    let fullPrompt = `<system>\n${systemLine}`;
    if (bashCtx) fullPrompt += `\n${bashCtx}`;
    fullPrompt += `\n<user>\n${userMsg}`;

    const args = buildOpencodeRunArgs({
      model: FREE_MODELS[0],
      prompt: fullPrompt,
      sessionId: meta!.sessionId
    });

    const renderer = createChatRenderer({
      verbosity,
      style,
      trueColor,
      out: process.stdout
    });

    let chatChildRef: ReturnType<typeof spawn> | null = null;
    const abortChat = () => {
      if (chatChildRef) chatChildRef.kill('SIGINT');
    };
    process.on('SIGINT', abortChat);
    childActive = true;

    let errBuffer = '';
    let chatExitCode = 0;
    let spawnError: Error | null = null;

    await new Promise<void>((res) => {
      let child: ReturnType<typeof spawnOpencode>;
      try {
        child = spawnOpencode(args, {
          env: env as Record<string, string>,
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } catch (err) {
        spawnError = err instanceof Error ? err : new Error(String(err));
        res();
        return;
      }
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
      child.on('close', (code) => {
        chatExitCode = code ?? 0;
        res();
      });
      child.on('error', (err) => {
        spawnError = err;
        res();
      });
    });

    process.removeListener('SIGINT', abortChat);
    childActive = false;

    renderer.finalize();
    totalCost += renderer.getTotalCost();

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
      input: userMsg
    });
    appendTranscript(dataDir, cwd0, {
      ts: new Date().toISOString(),
      kind: 'chat-assistant',
      output: assistantBuffer
    });

    meta!.turnCount += 1;
    meta!.lastUsedAt = new Date().toISOString();
    writeSessionMeta(dataDir, cwd0, meta!);

    if (firstTurn) {
      firstTurn = false;
      process.stdout.write(style.dim('Tip: type `/help` to see all agora commands.') + '\n');
    }

    await handleCodeBlock(assistantBuffer);
  }

  // ── Code-block hotkeys ───────────────────────────────────────────────────

  async function handleCodeBlock(text: string): Promise<void> {
    const block = extractFirstBashBlock(text);
    if (!block) return;

    process.stdout.write(
      style.dim('Code block: ') + style.accent('(r)un · (c)opy · (e)dit · (s)kip') + ' '
    );

    const key = await readOneKey();
    process.stdout.write('\n');

    if (key === 'r') {
      await runBash(block);
      appendTranscript(dataDir, cwd0, {
        ts: new Date().toISOString(),
        kind: 'bash',
        input: block,
        output: ''
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
      process.stdout.write(style.dim('(r)un · (s)kip '));
      const key2 = await readOneKey();
      process.stdout.write('\n');
      if (key2 === 'r') {
        const { readFileSync } = await import('node:fs');
        const edited = readFileSync(tmpFile, 'utf8').trim();
        await runBash(edited);
      }
    }
  }
}

// ── Transcript formatting helper (used by runShell, not a closure) ───────────

function formatTranscriptEntry(entry: {
  ts: string;
  kind: string;
  input?: string;
  output?: string;
  exitCode?: number;
}): string {
  const time = entry.ts.slice(0, 19);
  const prefix = `[${time}] [${entry.kind}]`;
  const input = entry.input ? ` $ ${entry.input}` : '';
  const output = entry.output ? `\n  ${entry.output.split('\n').slice(0, 5).join('\n  ')}` : '';
  return `${prefix}${input}${output}`;
}

// ── Help output ─────────────────────────────────────────────────────────────

function printLetterHelp(style: Styler): void {
  const lines: string[] = [
    style.accent('Agora Shell — letter shortcuts'),
    '',
    '  /a  again     /b  browse    /d  doctor    /e  env',
    '  /f  fg        /g  search    /h  home       /i  init     /j  jobs',
    '  /k  search    /l  last      /m  catalog     /n  news     /o  browse',
    '  /p  preferences /q  quit   /s  settings /t  terminal',
    '  /u  use       /v  verbose   /w  watch     /x  export   /y  history',
    '  /z  doctor --fix',
    '',
    'Shortcuts are exact matches only (no arguments).',
    'Type /help for full command reference, /abc to show this again.'
  ];
  process.stdout.write(lines.join('\n') + '\n\n');
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
    '  /tui          open the full-screen TUI on Home',
    '  /home /catalog /comm /news /settings  open the TUI on that page',
    '  /menu         open the command-browser menu',
    '  /transcript   print last 20 transcript entries',
    '  /clear        clear screen',
    '  /help         this help',
    '  /quit         exit shell',
    '  /last         re-run most recent bash command',
    '  /again        re-send most recent chat message',
    '  /? <cmd>      dry-run an agora command (e.g. /? install mcp-github)',
    '  /abc          show letter-shortcut reference (/a /b /c ...)',
    '  /jobs         list background jobs',
    '  /fg [N]       bring job N (or last) to foreground',
    '  /bg [N]       resume job N (or last) in background',
    '  /sessions     list all recorded shell sessions (cwd, turns, last activity)',
    '  /recall <q>   search across all session transcripts for <q>',
    '',
    style.dim('Verbosity:'),
    '  /verbose  /medium  /quiet',
    '',
    style.dim('Free AI models:'),
    ...FREE_MODELS.map((m) => `  ${m}`),
    '',
    style.dim('Agora commands (also available as /slash shortcuts):')
  ];

  const groups = ['Catalog', 'Setup', 'Library', 'Learn', 'Community'] as const;
  for (const g of groups) {
    const cmds = COMMANDS.filter((c) => c.group === g);
    lines.push(`  ${style.dim(g)}`);
    for (const c of cmds) {
      lines.push(`    ${style.accent(c.name.padEnd(14))}  ${c.summary}`);
    }
  }

  lines.push(
    '',
    style.dim(
      `agora v${AGORA_VERSION} · run \`agora help <command>\` or \`/<command> --help\` for details`
    )
  );

  process.stdout.write(lines.join('\n') + '\n\n');
}
