// `agora doctor`: what Agora can see and enforce on this machine, for this
// repository. Informational; it exits non-zero only when a configured server
// is revoked, because that is something the user must act on.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readCanaries } from '../../canary/canary.js';
import { OPENCODE_PLUGIN_FILE } from '../../compile/opencode.js';
import { POLICY_FILE } from '../../policy/engine.js';
import { repoRoot } from '../../receipt/git.js';
import { gitHooksInstalled } from '../../receipt/githooks.js';
import { checkRevocations, refreshFeed } from '../../revocation/client.js';
import { installedPurls } from '../../revocation/installed.js';
import { isBlockingMatch } from '../../revocation/match.js';
import { detectTools, readAllServers } from '../../stack/registry.js';
import { status } from '../components.js';
import { ExitCode } from '../exit-codes.js';
import { detectDataDir, writeJson, writeLine } from '../helpers.js';
import { cliTheme } from '../theme.js';
import { hookInstalled } from './hook.js';
import { usesOpenCode } from './plan.js';
import type { CommandHandler } from './types.js';

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
  const line = (ok: boolean | 'warn', text: string) =>
    writeLine(
      io.stdout,
      `  ${status(ok === true ? 'success' : ok === 'warn' ? 'warning' : 'info', text, theme)}`
    );

  writeLine(io.stdout, '');
  writeLine(io.stdout, theme.muted('Hosts'));
  for (const h of hosts) {
    const count = servers.filter((s) => s.tool === h.id).length;
    line(
      h.present,
      h.present
        ? `${h.name} · ${count} MCP server${count === 1 ? '' : 's'}`
        : theme.dim(`${h.name} · not found`)
    );
  }

  writeLine(io.stdout, '');
  writeLine(io.stdout, theme.muted('Enforcement'));
  line(
    hook ? true : 'warn',
    hook
      ? 'Claude Code hook installed in this repository'
      : 'Claude Code hook not installed · run `agora hook install`'
  );
  if (opencode)
    line(
      plugin ? true : 'warn',
      plugin
        ? 'OpenCode plugin installed in this repository'
        : 'OpenCode used here, plugin not installed · run `agora apply`'
    );
  line(
    policy ? true : 'warn',
    policy ? `${POLICY_FILE} found` : `no ${POLICY_FILE} · run \`agora learn --apply\``
  );

  if (root) {
    writeLine(io.stdout, '');
    writeLine(io.stdout, theme.muted('Receipts'));
    line(
      gitHooks ? true : 'warn',
      gitHooks
        ? 'written on every commit and sent on every push'
        : 'written only by hand · run `agora receipt install`'
    );
    line(
      signer === 'none' ? 'warn' : true,
      signer === 'none' ? 'unsigned (signer none) · run `agora signer init`' : `signed at ${signer}`
    );
    line(
      canary.file ? true : false,
      canary.file
        ? `canary planted: ${canary.file}${canary.tool ? ' and the decoy tool' : ''}`
        : theme.dim('no canary · `agora canary install` plants one')
    );
  }

  writeLine(io.stdout, '');
  writeLine(io.stdout, theme.muted('Revocations'));
  if (revoked.size) {
    for (const r of revoked.values()) {
      writeLine(
        io.stdout,
        `  ${status('error', `${r.server} (${r.tool}) is revoked: ${r.id} · ${r.reason}`, theme)}`
      );
    }
  } else {
    line(
      true,
      `no configured server is on the revocation list (${addressed.addressable.length} checked)`
    );
  }
  if (addressed.unaddressable.length) {
    line(
      'warn',
      `${addressed.unaddressable.length} server(s) not checkable: remote or not launched from npm`
    );
  }
  if (revocations.stale) line('warn', 'the cached revocation list is more than a week old');
  writeLine(io.stdout, '');

  return revoked.size ? ExitCode.POLICY_FORBID : ExitCode.OK;
};
