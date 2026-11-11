// `agora doctor`: what Agora can see and enforce on this machine, for this
// repository. Informational; it exits non-zero only when a configured server
// is revoked, because that is something the user must act on.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { checkRevocations, refreshFeed } from '../../revocation/client.js';
import { installedPurls } from '../../revocation/installed.js';
import { isBlockingMatch } from '../../revocation/match.js';
import { detectTools, readAllServers } from '../../stack/registry.js';
import { status } from '../components.js';
import { ExitCode } from '../exit-codes.js';
import { detectDataDir, writeJson, writeLine } from '../helpers.js';
import { cliTheme } from '../theme.js';
import { hookInstalled } from './hook.js';
import type { CommandHandler } from './types.js';

export const POLICY_FILE = 'agora.cedar';

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
      hook: { claudeCode: hook },
      policy: { path: POLICY_FILE, present: policy },
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
  line(
    policy ? true : 'warn',
    policy ? `${POLICY_FILE} found` : `no ${POLICY_FILE} · run \`agora policy init\``
  );

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
