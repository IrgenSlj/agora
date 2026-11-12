// agora.cedar → OpenCode.
//
// OpenCode has no command hooks; it loads plugins from `.opencode/plugins/`
// (https://opencode.ai/docs/plugins/, read 2026-11-12). Agora's plugin forwards
// every tool call to `agora hook check` before it runs and to `agora hook
// record` after, so one policy is evaluated by one engine for both hosts.
// Throwing from `tool.execute.before` blocks the call, and OpenCode shows the
// message to the agent; checked against a live OpenCode 1.19.3 session.
//
// No allow rules are compiled: OpenCode allows every action by default
// (https://opencode.ai/docs/permissions/, read 2026-11-12), so there are no
// prompts for a permit to remove. Every rule is enforced by the plugin.

export const OPENCODE_PLUGIN_FILE = '.opencode/plugins/agora.js';

/** What the plugin cannot see in OpenCode, so no policy can be enforced on it there. */
export const OPENCODE_GAPS = [
  'files read or written by shell commands (cat, sed, redirects): only the program name is checked',
  'network connections made by shell commands: connect rules govern webfetch only',
  'MCP tools are seen as plain tool names (`<server>_<tool>`), so the revocation list does not apply to them',
  'approval prompts are not recorded, so OpenCode sessions do not count toward fewer approvals',
  'sessions are closed only when OpenCode deletes them; an open log cannot detect truncation'
];

export interface OpenCodeCompilation {
  plugin: { path: string; source: string };
  hookOnly: { policy: string; why: string }[];
  notEnforced: string[];
}

export function compileOpenCode(policies: Record<string, unknown>): OpenCodeCompilation {
  return {
    plugin: { path: OPENCODE_PLUGIN_FILE, source: OPENCODE_PLUGIN },
    hookOnly: Object.keys(policies).map((policy) => ({
      policy,
      why: 'enforced by the plugin; OpenCode allows by default, so no allow rule is needed'
    })),
    notEnforced: OPENCODE_GAPS
  };
}

// The plugin, as written into the repository. Plain JavaScript with no
// imports beyond Node built-ins, so it runs in OpenCode's Bun without
// installing anything. It sends only the argument keys Agora reads, and it
// fails open: if `agora` is missing, slow or broken, the call proceeds.
export const OPENCODE_PLUGIN = `// Written by \`agora apply\`. Agora checks each OpenCode tool call against
// agora.cedar before it runs and records it after. It only ever blocks; it
// never grants. If agora is missing or fails, the call proceeds.
import { spawn } from 'node:child_process';

const KEYS = ['filePath', 'path', 'command', 'url'];
const pick = (args) => {
  const out = {};
  for (const k of KEYS) if (typeof args?.[k] === 'string') out[k] = args[k];
  return out;
};

function agora(sub, payload) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn('agora', ['hook', sub], { stdio: ['pipe', 'pipe', 'ignore'] });
    } catch {
      return resolve('');
    }
    const timer = setTimeout(() => { child.kill(); resolve(''); }, 10000);
    child.on('error', () => { clearTimeout(timer); resolve(''); });
    child.stdout.on('data', (d) => { out += d; });
    child.on('close', () => { clearTimeout(timer); resolve(out); });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}

export const AgoraPlugin = async ({ directory }) => {
  const base = (sessionID) => ({ host: 'opencode', session_id: sessionID, cwd: directory });
  return {
    'tool.execute.before': async (input, output) => {
      const out = await agora('check', {
        ...base(input.sessionID),
        hook_event_name: 'PreToolUse',
        tool_name: input.tool,
        tool_input: pick(output.args)
      });
      let reason;
      try {
        const d = JSON.parse(out).hookSpecificOutput;
        if (d?.permissionDecision === 'deny') reason = String(d.permissionDecisionReason);
      } catch {}
      if (reason) throw new Error(reason);
    },
    'tool.execute.after': async (input) => {
      await agora('record', {
        ...base(input.sessionID),
        hook_event_name: 'PostToolUse',
        tool_name: input.tool,
        tool_input: pick(input.args)
      });
    },
    event: async ({ event }) => {
      const id = event?.properties?.sessionID ?? event?.properties?.info?.id;
      if (typeof id !== 'string') return;
      if (event.type === 'session.created')
        await agora('record', { ...base(id), hook_event_name: 'SessionStart', source: 'startup' });
      if (event.type === 'session.deleted')
        await agora('record', { ...base(id), hook_event_name: 'SessionEnd', reason: 'deleted' });
    }
  };
};
`;
