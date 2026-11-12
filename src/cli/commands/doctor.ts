// `agora doctor`: what Agora can see and enforce on this machine, for this
// repository. Informational; it exits non-zero only when a configured server
// is revoked, because that is something the user must act on.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readCanaries } from '../../canary/canary.js';
import { OPENCODE_PLUGIN_FILE } from '../../compile/opencode.js';
import { listSessions } from '../../log/store.js';
import { verifySession } from '../../log/verify.js';
import { POLICY_FILE } from '../../policy/engine.js';
import { repoRoot } from '../../receipt/git.js';
import { gitHooksInstalled } from '../../receipt/githooks.js';
import { checkRevocations, refreshFeed } from '../../revocation/client.js';
import { installedPurls } from '../../revocation/installed.js';
import { isBlockingMatch } from '../../revocation/match.js';
import { detectTools, readAllServers } from '../../stack/registry.js';
import { type HealthTone, headerLine, row, rule, section, status, tally } from '../components.js';
import { ExitCode } from '../exit-codes.js';
import { detectDataDir, writeJson, writeLine } from '../helpers.js';
import { cliTheme } from '../theme.js';
import { hookInstalled } from './hook.js';
import { usesOpenCode } from './plan.js';
import type { CommandHandler } from './types.js';

function ago(iso: string): string {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

export const commandDoctor: CommandHandler = async (parsed, io, style) => {
  const cwd = io.cwd ?? process.cwd();
  const env = { cwd, home: io.env?.HOME, env: io.env };
  const dataDir = detectDataDir(parsed, io);

  const hosts = detectTools(env).map((t) => ({
    id: t.adapter.id,
    name: t.adapter.displayName,
    present: t.present
  }));
  // The same file can be read as both the user and the project config when the
  // repository is the home directory, so count each (host, file, name) once.
  const seen = new Set<string>();
  const servers = readAllServers(env).filter((s) => {
    const key = `${s.tool}\0${s.configPath}\0${s.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const hook = hookInstalled(cwd);
  const policy = existsSync(join(cwd, POLICY_FILE));
  const root = repoRoot(cwd);
  const opencode = root ? usesOpenCode(root) : false;
  const plugin = root ? existsSync(join(root, OPENCODE_PLUGIN_FILE)) : false;
  const gitHooks = root ? gitHooksInstalled(root) : false;
  const canary = root ? readCanaries(root) : {};
  const sessions = listSessions(dataDir);
  const latest = sessions[0];
  const latestOk = latest ? verifySession(dataDir, latest.session).ok : true;
  const { signerAvailable } = await import('../../signer/client.js');
  const signer = await signerAvailable(io.env ?? {});

  // Refreshing is opportunistic and never fails the report; the lookup is offline.
  await refreshFeed({ dataDir, fetcher: io.fetcher }).catch(() => undefined);
  const addressed = installedPurls(servers);
  const revocations = checkRevocations(dataDir, [
    ...new Set(addressed.addressable.map((a) => a.purl))
  ]);
  const revoked = new Map<string, { server: string; tool: string; id: string; reason: string }>();
  for (const a of addressed.addressable) {
    for (const m of revocations.matches) {
      if (m.purl !== a.purl || !isBlockingMatch(m)) continue;
      const r = {
        server: a.server.name,
        tool: a.server.tool,
        id: m.entry.id,
        reason: m.entry.reason
      };
      revoked.set(`${r.server}\0${r.tool}\0${r.id}`, r);
    }
  }

  if (parsed.flags.json) {
    writeJson(io.stdout, {
      hosts,
      servers: servers.map((s) => ({
        name: s.name,
        host: s.tool,
        scope: s.scope,
        transport: s.transport,
        enabled: s.enabled
      })),
      hook: { claudeCode: hook, opencode: opencode ? plugin : null },
      policy: { path: POLICY_FILE, present: policy },
      receipts: root ? { git_hooks: gitHooks, signer } : null,
      log: { sessions: sessions.length, latest_intact: latest ? latestOk : null },
      canary: root ? { file: canary.file ?? null, tool: Boolean(canary.tool) } : null,
      revocations: {
        feedVersion: revocations.feedVersion,
        stale: revocations.stale,
        revoked: [...revoked.values()],
        unchecked: addressed.unaddressable.map((s) => s.name)
      }
    });
    return revoked.size ? ExitCode.POLICY_FORBID : ExitCode.OK;
  }

  const theme = cliTheme(style, io);
  type Check = { tone: HealthTone; label: string; middle: string; right: string; fix?: string };
  const checks: Check[] = [];
  const out = (c: Check) => {
    checks.push(c);
    writeLine(io.stdout, row(c.tone, c.label, c.middle, c.right, theme));
  };
  const home = io.env?.HOME;
  const dot = theme.glyph('leader');
  const where = root ?? cwd;
  const shown = home && where.startsWith(home) ? `~${where.slice(home.length)}` : where;

  writeLine(io.stdout, '');
  writeLine(io.stdout, headerLine('doctor', shown, theme));
  writeLine(io.stdout, '');

  writeLine(io.stdout, section('Hosts', theme, 'enforcement'));
  // Claude Code is listed even when not found here: its hook lives in the repository.
  for (const h of hosts.filter((x) => x.present || x.id === 'claude-code')) {
    const n = servers.filter((s) => s.tool === h.id).length;
    const mcp = `${n} MCP server${n === 1 ? '' : 's'}`;
    if (h.id === 'claude-code')
      out(
        hook
          ? {
              tone: 'success',
              label: h.id,
              middle: `hook installed ${dot} ${mcp}`,
              right: 'enforced'
            }
          : {
              tone: 'warning',
              label: h.id,
              middle: 'hook not installed',
              right: 'not enforced',
              fix: 'agora hook install'
            }
      );
    else if (h.id === 'opencode')
      out(
        plugin
          ? {
              tone: 'success',
              label: h.id,
              middle: `plugin installed ${dot} ${mcp}`,
              right: 'enforced'
            }
          : {
              tone: 'warning',
              label: h.id,
              middle: opencode ? 'plugin not installed' : 'no plugin in this repository',
              right: 'not enforced',
              ...(opencode ? { fix: 'agora apply' } : {})
            }
      );
    else
      out({
        tone: 'warning',
        label: h.id,
        middle: `no adapter ${dot} ${mcp}`,
        right: 'not enforced'
      });
  }
  if (!hosts.some((x) => x.present))
    out({ tone: 'unknown', label: 'hosts', middle: 'no agent host found', right: 'unknown' });

  writeLine(io.stdout, '');
  writeLine(io.stdout, section('Policy', theme));
  out(
    policy
      ? { tone: 'success', label: POLICY_FILE, middle: 'present', right: 'found' }
      : {
          tone: 'warning',
          label: POLICY_FILE,
          middle: 'none here; baseline rules only',
          right: 'not written',
          fix: 'agora learn --apply'
        }
  );

  writeLine(io.stdout, '');
  writeLine(io.stdout, section('Log', theme));
  if (latest) {
    out({
      tone: 'success',
      label: 'sessions',
      middle: `${sessions.length} recorded`,
      right: `last ${ago(latest.modified)}`
    });
    out(
      latestOk
        ? {
            tone: 'success',
            label: 'hash chain',
            middle: `${latest.events} entries`,
            right: 'intact'
          }
        : {
            tone: 'error',
            label: 'hash chain',
            middle: 'latest session does not verify',
            right: 'broken',
            fix: 'agora log verify'
          }
    );
  } else out({ tone: 'unknown', label: 'sessions', middle: 'none recorded yet', right: 'unknown' });

  if (root) {
    writeLine(io.stdout, '');
    writeLine(io.stdout, section('Receipts', theme));
    out(
      gitHooks
        ? {
            tone: 'success',
            label: 'git hooks',
            middle: 'every commit, every push',
            right: 'automatic'
          }
        : {
            tone: 'warning',
            label: 'git hooks',
            middle: 'receipts written by hand',
            right: 'not installed',
            fix: 'agora receipt install'
          }
    );
    out(
      signer === 'none'
        ? {
            tone: 'warning',
            label: 'signer',
            middle: `${theme.glyph('unsigned')} unsigned`,
            right: 'none',
            fix: 'agora signer init'
          }
        : {
            tone: 'success',
            label: 'signer',
            middle: `${theme.glyph('signed')} signed`,
            right: signer
          }
    );
    out(
      canary.file
        ? {
            tone: 'success',
            label: 'canary',
            middle: `${canary.file}${canary.tool ? ' + decoy tool' : ''}`,
            right: 'planted'
          }
        : { tone: 'info', label: 'canary', middle: '`agora canary install`', right: 'none' }
    );
  }

  writeLine(io.stdout, '');
  writeLine(io.stdout, section('Revocations', theme));
  out({
    tone: revocations.stale ? 'warning' : 'success',
    label: 'list',
    middle: `version ${revocations.feedVersion ?? 'bundled'}`,
    right: revocations.stale ? 'over a week old' : 'current'
  });
  for (const r of revoked.values())
    out({
      tone: 'error',
      label: r.server,
      middle: `${r.server} (${r.tool}) is revoked: ${r.id}`,
      right: 'revoked',
      fix: 'remove or upgrade it in the host config'
    });
  if (!revoked.size)
    out({
      tone: 'success',
      label: 'servers',
      middle: `${addressed.addressable.length} checked`,
      right: 'clear'
    });
  if (addressed.unaddressable.length)
    out({
      tone: 'unknown',
      label: 'not checkable',
      middle: `${addressed.unaddressable.length} remote or not from npm`,
      right: 'unknown'
    });

  const count = (t: HealthTone) => checks.filter((c) => c.tone === t).length;
  writeLine(io.stdout, '');
  writeLine(io.stdout, rule(theme));
  writeLine(
    io.stdout,
    tally(
      [
        [count('success'), 'pass'],
        [count('warning'), 'warn'],
        [count('error'), 'fail'],
        [count('unknown'), 'unknown']
      ],
      theme
    )
  );
  const failed = checks.find((c) => c.tone === 'error');
  const next = failed ?? checks.find((c) => c.fix);
  if (failed) writeLine(io.stdout, `  ${status('error', `not ready  ${failed.middle}`, theme)}`);
  if (next?.fix) writeLine(io.stdout, `    ${theme.muted(failed ? 'fix' : 'next')}  ${next.fix}`);
  writeLine(io.stdout, '');

  return revoked.size ? ExitCode.POLICY_FORBID : ExitCode.OK;
};
