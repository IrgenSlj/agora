import process from 'node:process';
import { appendHistory } from '../../history.js';
import {
  buildOpencodeRunArgs,
  normalizeOpencodeModel,
  spawnOpencode
} from '../../opencode-exec.js';
import { ExitCode } from '../exit-codes.js';
import {
  detectDataDir,
  extractSessionId,
  loadLastChatSession,
  persistChatSession,
  stringFlag,
  writeLine
} from '../helpers.js';
import type { CommandHandler } from './types.js';

export const FREE_MODELS = ['deepseek-v4-flash-free', 'minimax-m2.5-free', 'nemotron-3-super-free'];

export const commandChat: CommandHandler = async (parsed, io, style) => {
  const message = parsed.args.join(' ');
  const model = stringFlag(parsed, 'model', 'm') || FREE_MODELS[0];
  const continueMode = parsed.flags.continue === true;
  const explicitSession = stringFlag(parsed, 'session', 's');
  const rawJson = parsed.flags.json === true;

  if (!message) {
    // TUI mode — hand off to opencode with inherit stdio
    process.stderr.write(`Agora Chat (${model}) — press Ctrl+C to exit.\n`);

    let child: ReturnType<typeof spawnOpencode>;
    try {
      child = spawnOpencode(['--model', normalizeOpencodeModel(model)], {
        env: io.env as Record<string, string>,
        stdio: 'inherit'
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      writeLine(io.stderr, `Failed to run opencode: ${message}`);
      writeLine(io.stderr, 'Is opencode installed and in your PATH?');
      return ExitCode.USAGE;
    }
    return new Promise((resolve) => {
      child.on('close', (code) => resolve(code ?? 0));
      child.on('error', (err) => {
        writeLine(io.stderr, `Failed to run opencode: ${err.message}`);
        resolve(ExitCode.USAGE);
      });
    });
  }

  // One-shot mode — single message via opencode run
  return new Promise<number>((resolve) => {
    let sessionIdForRun: string | null = explicitSession ?? null;
    let continueSession = false;
    if (!sessionIdForRun && continueMode) {
      const dataDir = detectDataDir(parsed, io);
      const lastSession = loadLastChatSession(dataDir);
      if (lastSession) {
        sessionIdForRun = lastSession;
      } else {
        continueSession = true;
      }
    }
    const args = buildOpencodeRunArgs({
      model,
      prompt: message,
      sessionId: sessionIdForRun,
      continueSession
    });

    const stderrChunks: string[] = [];
    let sessionId: string | null = null;
    let wroteNewline = false;

    let child: ReturnType<typeof spawnOpencode>;
    try {
      child = spawnOpencode(args, {
        env: io.env as Record<string, string>,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      writeLine(io.stderr, `Failed to run opencode: ${message}`);
      writeLine(io.stderr, 'Is opencode installed and in your PATH?');
      resolve(ExitCode.USAGE);
      return;
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      for (const line of text.split('\n').filter(Boolean)) {
        if (!sessionId) sessionId = extractSessionId(line);

        if (rawJson) {
          process.stdout.write(line + '\n');
          continue;
        }

        try {
          const ev = JSON.parse(line);
          if (ev.type === 'text' && ev.part?.text) {
            process.stdout.write(ev.part.text);
            wroteNewline = false;
          }
          if (ev.type === 'step_finish') {
            const tokens = ev.part?.tokens;
            if (tokens && !rawJson) {
              const cost = typeof tokens.cost === 'number' ? ` · $${tokens.cost.toFixed(6)}` : '';
              process.stdout.write(`\n${style.dim(`[${tokens.output} tokens${cost}]`)}\n`);
              wroteNewline = true;
            }
          }
        } catch {
          /* skip malformed lines */
        }
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk.toString());
    });

    child.on('close', (code) => {
      if (!wroteNewline) process.stdout.write('\n');

      const dataDir = detectDataDir(parsed, io);
      appendHistory(dataDir, {
        type: 'chat',
        query: message,
        timestamp: new Date().toISOString(),
        model
      });

      if (sessionId) {
        persistChatSession(dataDir, sessionId);
        if (!rawJson) {
          process.stdout.write(
            style.dim(
              `Session: ${sessionId.slice(0, 24)}…  Continue: agora chat --session ${sessionId} "..."`
            ) + '\n'
          );
        }
      }

      if (code !== 0) {
        const errText = stderrChunks.join('');
        const modelError = errText.match(/Model not found:.*?Did you mean:\s*(.+?)\?/);
        if (modelError) {
          const suggestions = modelError[1];
          writeLine(io.stderr, `\nModel not available. Try: ${suggestions}`);
          writeLine(io.stderr, `Example: agora chat -m deepseek-v4-flash-free "your question"`);
        } else if (errText.includes('not found')) {
          writeLine(io.stderr, '\n' + errText.replace(/^.*?ERROR\s+/gm, '').trim());
        }
      }
      resolve(code ?? 0);
    });

    child.on('error', (err) => {
      writeLine(io.stderr, `Failed to run opencode: ${err.message}`);
      writeLine(io.stderr, 'Is opencode installed and in your PATH?');
      resolve(1);
    });
  });
};
