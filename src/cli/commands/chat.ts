import process from 'node:process';
import { spawn } from 'node:child_process';
import { appendHistory } from '../../history.js';
import {
  stringFlag,
  writeLine,
  detectDataDir,
  loadLastChatSession,
  extractSessionId,
  persistChatSession
} from '../helpers.js';
import type { CommandHandler } from './types.js';

export const FREE_MODELS = ['deepseek-v4-flash-free', 'minimax-m2.5-free', 'nemotron-3-super-free'];

export const commandChat: CommandHandler = async (parsed, io, _style) => {
  const message = parsed.args.join(' ');
  const model = stringFlag(parsed, 'model', 'm') || FREE_MODELS[0];
  const continueMode = parsed.flags.continue === true;
  const explicitSession = stringFlag(parsed, 'session', 's');
  const rawJson = parsed.flags.json === true;
  const modelArg = model.includes('/') ? model : `opencode/${model}`;

  if (!message) {
    // TUI mode — hand off to opencode with inherit stdio
    process.stderr.write(`Agora Chat (${model}) — press Ctrl+C to exit.\n`);

    const child = spawn('opencode', ['--model', modelArg], {
      env: io.env as Record<string, string>,
      stdio: 'inherit',
      shell: false
    });
    return new Promise((resolve) => {
      child.on('close', (code) => resolve(code ?? 0));
      child.on('error', (err) => {
        writeLine(io.stderr, `Failed to run opencode: ${err.message}`);
        resolve(1);
      });
    });
  }

  // One-shot mode — single message via opencode run
  return new Promise<number>((resolve) => {
    const args = ['run', '--format', 'json'];
    args.push('--model', modelArg);

    if (explicitSession) {
      args.push('--session', explicitSession);
    } else if (continueMode) {
      const dataDir = detectDataDir(parsed, io);
      const lastSession = loadLastChatSession(dataDir);
      if (lastSession) {
        args.push('--session', lastSession);
      } else {
        args.push('--continue');
      }
    }

    args.push(message);

    const stderrChunks: string[] = [];
    let sessionId: string | null = null;
    let wroteNewline = false;

    const child = spawn('opencode', args, {
      env: io.env as Record<string, string>,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false
    });

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
              process.stdout.write(`\n\x1b[2m[${tokens.output} tokens${cost}]\x1b[0m\n`);
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
          process.stdout.write(`\x1b[2mSession: ${sessionId.slice(0, 24)}…  `);
          process.stdout.write(`Continue: agora chat --session ${sessionId} "..."\x1b[0m\n`);
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
