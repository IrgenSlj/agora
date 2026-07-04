import { loadAgoraState, getAuthState } from '../../state.js';
import { loadPreferences } from '../../preferences.js';
import { writeLine, writeJson, detectDataDir } from '../helpers.js';
import type { CommandHandler } from './types.js';

interface WelcomeStep {
  title: string;
  commands: string[];
  effect: string;
}

function buildSteps(signedIn: boolean, username: string): WelcomeStep[] {
  const signInStep: WelcomeStep = signedIn
    ? {
        title: `Signed in as ${username}`,
        commands: ['agora bookmarks', 'agora saved'],
        effect: 'view your saved items and bookmarks'
      }
    : {
        title: 'Sign in (optional)',
        commands: ['agora auth login --api-url https://api.agora.example'],
        effect: 'unlocks bookmarks across devices'
      };

  return [
    signInStep,
    {
      title: 'Browse the marketplace',
      commands: ['agora marketplace', 'agora search <query>', 'agora today'],
      effect: 'discover MCP servers, agents, and workflow templates'
    },
    {
      title: 'Read the news',
      commands: ['agora news', 'agora news --source hn --limit 10'],
      effect: 'ranked feed from HN, GitHub, and arXiv'
    },
    {
      title: 'Set up shell completions',
      commands: ['agora completions bash', 'agora completions zsh', 'agora completions fish'],
      effect: 'tab-complete commands, flags, and marketplace IDs'
    },
    {
      title: 'Start an MCP project of your own',
      commands: ['agora init --template node-mcp', 'agora init --template python-mcp'],
      effect: 'scaffold a complete MCP server project in the current directory'
    }
  ];
}

export const commandWelcome: CommandHandler = async (parsed, io, style) => {
  const dataDir = detectDataDir(parsed, io);
  const state = loadAgoraState(dataDir);
  const auth = getAuthState(state);
  const signedIn = Boolean(auth);
  const prefs = loadPreferences(dataDir);
  const username = prefs.username || 'you';
  const steps = buildSteps(signedIn, username);

  if (parsed.flags.json) {
    writeJson(io.stdout, {
      signedIn,
      username: signedIn ? username : undefined,
      steps
    });
    return 0;
  }

  writeLine(io.stdout, style.bold('Welcome to agora'));
  writeLine(io.stdout, style.dim('────────────────'));
  writeLine(io.stdout, 'agora is a terminal-native marketplace for MCP servers, agents,');
  writeLine(io.stdout, 'and workflows.');
  writeLine(io.stdout, '');

  steps.forEach((step, i) => {
    writeLine(io.stdout, `${i + 1}. ${style.bold(step.title)}`);
    for (const cmd of step.commands) {
      writeLine(io.stdout, '   ' + style.accent(cmd));
    }
    writeLine(io.stdout, '   ' + style.dim('▸ ' + step.effect));
    writeLine(io.stdout, '');
  });

  return 0;
};
