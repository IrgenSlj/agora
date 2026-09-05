import { writeJson, writeLine } from '../helpers.js';
import type { CommandHandler } from './types.js';

interface WelcomeStep {
  title: string;
  commands: string[];
  effect: string;
}

/**
 * The guided tour follows the trust plane's own order — see what you already
 * run, find something new, gate it on the way in, then make the whole stack
 * reproducible. No accounts, so there is no sign-in step.
 */
function buildSteps(): WelcomeStep[] {
  return [
    {
      title: 'Audit what you already run',
      commands: ['agora doctor', 'agora installed'],
      effect: 'one table of every MCP server across all your hosts, plus drift'
    },
    {
      title: 'Search across every registry at once',
      commands: ['agora search postgres', 'agora search --kind agent-skill review'],
      effect: 'multi-source catalog search, deduped by purl, with honest per-source status'
    },
    {
      title: 'Acquire through the gate',
      commands: ['agora scan mcp-postgres', 'agora acquire mcp-postgres'],
      effect: 'resolve, check for known red flags, then write host config — or refuse'
    },
    {
      title: 'Make your stack reproducible',
      commands: ['agora freeze --write', 'agora plan', 'agora apply'],
      effect: 'capture agora.toml, diff it against reality, reconcile surgically'
    },
    {
      title: 'Put Agora inside your agents',
      commands: ['agora integrate --all'],
      effect: 'install Agora into every detected host, using its own stack machinery'
    },
    {
      title: 'Set up shell completions',
      commands: ['agora completions bash', 'agora completions zsh', 'agora completions fish'],
      effect: 'tab-complete commands, flags, and catalog item IDs'
    }
  ];
}

export const commandWelcome: CommandHandler = async (parsed, io, style) => {
  const steps = buildSteps();

  if (parsed.flags.json) {
    writeJson(io.stdout, { steps });
    return 0;
  }

  writeLine(io.stdout, style.bold('Welcome to agora'));
  writeLine(io.stdout, style.dim('────────────────'));
  writeLine(io.stdout, 'agora catches the tool that changed after you trusted it — verify');
  writeLine(io.stdout, 'provenance, pin what you approved, and enforce policy on every host.');
  writeLine(io.stdout, '');

  steps.forEach((step, i) => {
    writeLine(io.stdout, `${i + 1}. ${style.bold(step.title)}`);
    for (const cmd of step.commands) {
      writeLine(io.stdout, `   ${style.accent(cmd)}`);
    }
    writeLine(io.stdout, `   ${style.dim(`▸ ${step.effect}`)}`);
    writeLine(io.stdout, '');
  });

  return 0;
};
