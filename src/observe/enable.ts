// `agora observe enable` / `disable` — switching observation on across hosts.
//
// Planning is separated from writing, the same way `agora plan` is separated
// from `agora apply`, because this rewrites the launch command of every MCP
// server the user depends on. They get to see the exact diff first.
//
// Writes go through the existing `ToolAdapter.writeServers`, which preserves
// every unrelated key and writes atomically. Nothing here touches a config
// file directly.

import { ALL_ADAPTERS } from '../stack/registry.js';
import type { AgentToolId, ConfiguredServer, StackEnv } from '../stack/types.js';
import { isWrapped, unobservableReason, unwrapCommand, wrapCommand } from './wrap.js';

export interface ObserveChange {
  name: string;
  tool: AgentToolId;
  configPath: string;
  scope: 'project' | 'user';
  before: string[];
  after: string[];
}

export interface ObserveSkip {
  name: string;
  tool: AgentToolId;
  reason: string;
}

export interface ObservePlan {
  changes: ObserveChange[];
  /** Servers deliberately not touched, each with a reason to show the user. */
  skipped: ObserveSkip[];
  /** Already in the requested state — reported so re-running reads as a no-op. */
  unchanged: string[];
}

/**
 * Works out what enabling or disabling observation would change.
 *
 * Pure with respect to the filesystem apart from reading configs, so the CLI
 * can render the same plan for `--dry-run` and for the confirmed run.
 */
export function planObserve(
  servers: readonly ConfiguredServer[],
  mode: 'enable' | 'disable'
): ObservePlan {
  const changes: ObserveChange[] = [];
  const skipped: ObserveSkip[] = [];
  const unchanged: string[] = [];

  for (const server of servers) {
    const wrapped = isWrapped(server.command);

    // Disabling only ever needs to touch what is currently wrapped, so the
    // "is this observable" question does not apply — a remote server is
    // already not wrapped and simply falls through to `unchanged`.
    // A manifest-sourced entry has no host config to rewrite: `agora.toml` is
    // declared intent, and the shim belongs in the launch command a host
    // actually spawns. Run `agora apply` first, then observe the real entries.
    if (server.tool === 'agora') {
      skipped.push({
        name: server.name,
        tool: 'opencode',
        reason: 'declared in agora.toml, not in a host config — run `agora apply` first'
      });
      continue;
    }

    if (mode === 'enable') {
      const reason = unobservableReason(server);
      if (reason) {
        skipped.push({ name: server.name, tool: server.tool as AgentToolId, reason });
        continue;
      }
    }

    if ((mode === 'enable' && wrapped) || (mode === 'disable' && !wrapped)) {
      unchanged.push(server.name);
      continue;
    }

    const before = server.command ?? [];
    const after = mode === 'enable' ? wrapCommand(before) : unwrapCommand(before);
    changes.push({
      name: server.name,
      tool: server.tool as AgentToolId,
      configPath: server.configPath,
      scope: server.scope,
      before,
      after
    });
  }

  return { changes, skipped, unchanged };
}

export interface ApplyObserveResult {
  written: { tool: AgentToolId; configPath: string; servers: string[] }[];
  failed: { tool: AgentToolId; configPath: string; error: string }[];
}

/**
 * Applies a plan through the host adapters.
 *
 * Grouped per config file so each host is written once. A host that fails is
 * recorded rather than thrown, so one unwritable config does not abandon the
 * others half-done — and the caller reports exactly which succeeded.
 */
export function applyObserve(
  plan: ObservePlan,
  servers: readonly ConfiguredServer[],
  env: StackEnv
): ApplyObserveResult {
  const written: ApplyObserveResult['written'] = [];
  const failed: ApplyObserveResult['failed'] = [];

  const byFile = new Map<string, ObserveChange[]>();
  for (const change of plan.changes) {
    byFile.set(change.configPath, [...(byFile.get(change.configPath) ?? []), change]);
  }

  for (const [configPath, fileChanges] of byFile) {
    const toolId = fileChanges[0]!.tool;
    const scope = fileChanges[0]!.scope;
    const adapter = ALL_ADAPTERS.find((a) => a.id === toolId);
    if (!adapter) {
      failed.push({ tool: toolId, configPath, error: 'no adapter for this host' });
      continue;
    }

    const location = adapter.writeLocation(env, scope);
    if (!location || location.path !== configPath) {
      failed.push({
        tool: toolId,
        configPath,
        error: `adapter cannot write ${scope} scope at this path`
      });
      continue;
    }

    // Carry each server's existing env and enabled flag through: writeServers
    // reconciles the entries it is given, and dropping those fields here would
    // silently strip a server's environment while "enabling observation".
    const desired = fileChanges.map((change) => {
      const original = servers.find((s) => s.name === change.name && s.configPath === configPath);
      return {
        name: change.name,
        command: change.after,
        ...(original?.env && Object.keys(original.env).length > 0 ? { env: original.env } : {}),
        ...(original?.enabled === false ? { enabled: false } : {})
      };
    });

    try {
      adapter.writeServers(location, desired, { prune: false });
      written.push({ tool: toolId, configPath, servers: fileChanges.map((c) => c.name) });
    } catch (error) {
      failed.push({
        tool: toolId,
        configPath,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return { written, failed };
}
