import type { Page, PageAction, PageContext } from './types.js';
import { vlen, rail, noRail, sep, frame, padRight, truncate } from './helpers.js';
import { readAllServers, groupServersByName, detectTools } from '../../stack/registry.js';
import { checkStack } from '../../stack/doctor.js';
import { readCapabilityCache } from '../../stack/capability-cache.js';
import { detectAgoraDataDir } from '../../state.js';
import type { StackHealth, ServerHealth } from '../../stack/doctor.js';
import type { ServerCapabilities } from '../../stack/capability-cache.js';
import type { ConfiguredServer, StackEnv } from '../../stack/types.js';

interface StackEntry {
  name: string;
  instances: ConfiguredServer[];
}

interface StackState {
  servers: StackEntry[];
  health: StackHealth | null;
  caps: Map<string, ServerCapabilities>;
  selected: number;
  mode: 'list' | 'detail';
  probing: boolean;
  loaded: boolean;
  error?: string;
}

const state: StackState = {
  servers: [],
  health: null,
  caps: new Map(),
  selected: 0,
  mode: 'list',
  probing: false,
  loaded: false,
  error: undefined
};

function buildStackEnv(ctx: PageContext): StackEnv {
  return {
    cwd: ctx.io.cwd,
    home: ctx.io.env?.HOME,
    env: ctx.io.env as Record<string, string | undefined> | undefined
  };
}

function getDataDir(ctx: PageContext): string {
  return detectAgoraDataDir({ env: ctx.io.env as Record<string, string | undefined> | undefined });
}

async function loadStack(ctx: PageContext): Promise<void> {
  state.error = undefined;
  try {
    const env = buildStackEnv(ctx);
    const allServers = readAllServers(env);
    const grouped = groupServersByName(allServers);
    const entries: StackEntry[] = [];
    for (const [name, instances] of grouped) {
      entries.push({ name, instances });
    }
    state.servers = entries;

    // Static checks only — no probe on mount
    const health = await checkStack(allServers, { ...env, probe: false });
    state.health = health;

    // Load capability cache
    const dataDir = getDataDir(ctx);
    const capList = readCapabilityCache(dataDir);
    const capsMap = new Map<string, ServerCapabilities>();
    for (const cap of capList) {
      capsMap.set(cap.name, cap);
    }
    state.caps = capsMap;

    state.loaded = true;
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
    state.loaded = true;
  }
}

function healthGlyph(status: 'ok' | 'warn' | 'error', style: PageContext['style']): string {
  if (status === 'ok') return style.accent('✓');
  if (status === 'warn') return style.orange('⚠');
  return style.bold('✗');
}

function checkGlyph(ok: boolean, level: 'warn' | 'error', style: PageContext['style']): string {
  if (ok) return style.accent('✓');
  if (level === 'warn') return style.orange('⚠');
  return style.bold('✗');
}

export const stackPage: Page = {
  id: 'stack',
  title: 'STACK',
  navLabel: 'Stack',
  navIcon: 'X',
  hotkeys: [
    { key: 'j/k', label: 'nav' },
    { key: 'Enter', label: 'details' },
    { key: 'p', label: 'probe' },
    { key: 'r', label: 'refresh' },
    { key: 'Esc', label: 'back' }
  ],

  async mount(ctx: PageContext): Promise<void> {
    state.mode = 'list';
    state.selected = 0;
    state.loaded = false;
    await loadStack(ctx);
  },

  render(ctx: PageContext): string {
    const { style, width, height } = ctx;
    const lines: string[] = [];

    // ── Header ────────────────────────────────────────────────────────────────
    const totalServers = state.servers.length;
    const totalTools = state.servers.reduce((n, e) => n + e.instances.length, 0);
    const summary =
      totalServers === 0
        ? style.dim('no servers configured')
        : style.dim(
            totalServers +
              (totalServers === 1 ? ' server' : ' servers') +
              ' · ' +
              totalTools +
              (totalTools === 1 ? ' instance' : ' instances')
          );
    const health = state.health;
    const healthSummary = health
      ? '   ' +
        style.accent('ok: ' + health.summary.ok) +
        style.dim('  ·  ') +
        style.orange('warn: ' + health.summary.warn) +
        style.dim('  ·  ') +
        style.dim('error: ' + health.summary.error)
      : '';
    lines.push(' ' + style.bold(style.accent('STACK')) + '   ' + summary + healthSummary);
    lines.push(' ' + sep('', width - 2, style));

    // ── Error state ────────────────────────────────────────────────────────────
    if (state.error) {
      lines.push('');
      lines.push('   ' + style.bold('Error loading stack:'));
      lines.push('   ' + style.dim(state.error));
      lines.push('');
      lines.push('   ' + style.accent('r') + style.dim(' refresh'));
      return frame(lines, width, height);
    }

    // ── Loading ────────────────────────────────────────────────────────────────
    if (!state.loaded) {
      lines.push('');
      lines.push('   ' + style.dim('Loading…'));
      return frame(lines, width, height);
    }

    // ── Empty state ────────────────────────────────────────────────────────────
    if (state.servers.length === 0) {
      lines.push('');
      const toolResults = detectTools(buildStackEnv(ctx));
      const detected = toolResults.filter((t) => t.present).map((t) => t.adapter.displayName);
      if (detected.length > 0) {
        lines.push('   ' + style.dim('Detected tools: ') + detected.join(', '));
        lines.push('');
      }
      lines.push('   ' + style.dim('No MCP servers configured.'));
      lines.push(
        '   ' +
          style.dim('Run ') +
          style.accent('agora install <name>') +
          style.dim(' to add a server, or ') +
          style.accent('agora search') +
          style.dim(' to browse.')
      );
      lines.push('');
      lines.push(
        '   ' +
          style.dim('Tools appear here after they are probed with ') +
          style.accent('p') +
          style.dim('.')
      );
      lines.push('');
      lines.push('   ' + style.accent('r') + style.dim(' refresh'));
      return frame(lines, width, height);
    }

    // ── Detail mode ───────────────────────────────────────────────────────────
    if (state.mode === 'detail') {
      const entry = state.servers[state.selected];
      if (!entry) return frame(lines, width, height);

      const serverHealth = health?.servers.find((h) => h.name === entry.name);
      const glyph = serverHealth ? healthGlyph(serverHealth.status, style) : style.dim('?');

      const detail: string[] = [];
      detail.push(' ' + glyph + '  ' + style.bold(style.accent(entry.name)));
      detail.push(' ' + sep('', width - 2, style));
      detail.push('');

      // Instances
      detail.push(' ' + style.dim('Instances'));
      for (const inst of entry.instances) {
        const transport = inst.transport === 'local' ? style.dim('local') : style.dim('remote');
        const scope = style.dim('[' + inst.scope + ']');
        const cmd = inst.transport === 'local' ? (inst.command ?? []).join(' ') : (inst.url ?? '');
        const enabledNote = inst.enabled === false ? '  ' + style.orange('disabled') : '';
        detail.push('   ' + style.bold(inst.tool) + '  ' + scope + '  ' + transport + enabledNote);
        if (cmd) {
          detail.push('   ' + style.dim(truncate(cmd, width - 6)));
        }
      }
      detail.push('');

      // Health checks
      if (serverHealth && serverHealth.checks.length > 0) {
        detail.push(' ' + sep('Health checks', width - 2, style));
        for (const check of serverHealth.checks) {
          const g = checkGlyph(check.ok, check.level, style);
          const name = padRight(check.name, 28);
          const detail2 = check.detail ? style.dim(check.detail) : '';
          detail.push('   ' + g + '  ' + name + detail2);
        }
        detail.push('');
      } else if (serverHealth && serverHealth.checks.length === 0) {
        detail.push(' ' + style.dim('No issues detected.'));
        detail.push('');
      }

      // Cached capabilities
      const caps = state.caps.get(entry.name);
      detail.push(' ' + sep('Tools', width - 2, style));
      if (state.probing) {
        detail.push('   ' + style.dim('Probing…'));
      } else if (caps && caps.tools.length > 0) {
        for (const tool of caps.tools) {
          const desc = tool.description ? style.dim('  — ' + tool.description) : '';
          detail.push('   ' + style.bold(tool.name) + desc);
        }
      } else {
        detail.push(
          '   ' +
            style.dim('(probe to discover tools — press ') +
            style.accent('p') +
            style.dim(')')
        );
      }
      detail.push('');

      // Footer
      const footer = [
        ' ' + sep('', width - 2, style),
        ' ' + style.accent('p') + style.dim(' probe   ') + style.accent('Esc') + style.dim(' back')
      ];
      const padCount = Math.max(0, height - lines.length - detail.length - footer.length);
      lines.push(...detail);
      for (let i = 0; i < padCount; i++) lines.push('');
      lines.push(...footer);
      return frame(lines, width, height);
    }

    // ── List mode ─────────────────────────────────────────────────────────────
    state.selected = Math.min(state.selected, Math.max(0, state.servers.length - 1));
    const limit = Math.max(0, height - lines.length - 1);
    const start = Math.max(
      0,
      Math.min(state.selected - Math.floor(limit / 2), state.servers.length - limit)
    );

    for (let i = 0; i < limit && start + i < state.servers.length; i++) {
      const entry = state.servers[start + i];
      if (!entry) continue;
      const selected = start + i === state.selected;
      const lead = selected ? rail(style) : noRail();

      const serverHealth = health?.servers.find((h) => h.name === entry.name);
      const glyph = serverHealth ? healthGlyph(serverHealth.status, style) : style.dim('·');

      // Tools this server is configured in
      const toolList = [...new Set(entry.instances.map((inst) => inst.tool + ':' + inst.scope))];
      const toolStr = toolList.join(' ');

      // Cached tool count
      const caps = state.caps.get(entry.name);
      const toolCount =
        caps && caps.tools.length > 0 ? style.dim(' · ' + caps.tools.length + ' tools') : '';

      // Transport type
      const transports = [...new Set(entry.instances.map((inst) => inst.transport))].join('/');

      const probingNote = state.probing && selected ? '  ' + style.dim('probing…') : '';

      const nameCell = selected ? style.bold(entry.name) : entry.name;
      const left = ' ' + lead + glyph + '  ' + nameCell + probingNote;
      const right = style.dim(transports) + toolCount;
      const room = width - vlen(left) - vlen(right) - 3;
      const mid = room > 2 ? '  ' + style.dim(truncate(toolStr, Math.max(0, room - 2))) : '';
      const gap = ' '.repeat(Math.max(1, room - vlen(mid) - 1));
      lines.push(left + mid + gap + right);
    }

    lines.push(
      '  ' +
        (state.servers.length > limit
          ? style.dim(
              'servers ' +
                (start + 1) +
                '–' +
                Math.min(start + limit, state.servers.length) +
                ' of ' +
                state.servers.length
            )
          : style.dim(state.servers.length + (state.servers.length === 1 ? ' server' : ' servers')))
    );
    return frame(lines, width, height);
  },

  async handleKey(event, ctx: PageContext): Promise<PageAction> {
    if (state.mode === 'detail') {
      switch (event.key) {
        case 'esc':
          state.mode = 'list';
          ctx.repaint();
          return { kind: 'none' };
        case 'p': {
          const entry = state.servers[state.selected];
          if (!entry) return { kind: 'none' };
          // Only probe if there's a local instance
          const hasLocal = entry.instances.some((inst) => inst.transport === 'local');
          if (!hasLocal) {
            return { kind: 'status', message: 'No local instances to probe for ' + entry.name };
          }
          state.probing = true;
          ctx.repaint();
          try {
            const env = buildStackEnv(ctx);
            const dataDir = getDataDir(ctx);
            await checkStack(entry.instances, { ...env, probe: true, dataDir });
            // Refresh this server's health in our overall health
            const refreshedHealth = await checkStack(
              state.servers.flatMap((e) => e.instances),
              { ...env, probe: false }
            );
            state.health = refreshedHealth;
            // Reload caps
            const capList = readCapabilityCache(dataDir);
            for (const cap of capList) {
              state.caps.set(cap.name, cap);
            }
          } catch (err) {
            state.probing = false;
            ctx.repaint();
            return {
              kind: 'status',
              message: 'Probe failed: ' + (err instanceof Error ? err.message : String(err)),
              tone: 'error'
            };
          }
          state.probing = false;
          ctx.repaint();
          return { kind: 'status', message: 'Probed ' + state.servers[state.selected]?.name };
        }
        default:
          return { kind: 'none' };
      }
    }

    // list mode
    switch (event.key) {
      case 'j':
      case 'down':
        state.selected = Math.min(state.servers.length - 1, state.selected + 1);
        ctx.repaint();
        return { kind: 'none' };
      case 'k':
      case 'up':
        state.selected = Math.max(0, state.selected - 1);
        ctx.repaint();
        return { kind: 'none' };
      case 'enter':
        if (state.servers.length > 0) {
          state.mode = 'detail';
          ctx.repaint();
        }
        return { kind: 'none' };
      case 'esc':
        return { kind: 'none' };
      case 'r':
        state.loaded = false;
        ctx.repaint();
        loadStack(ctx).then(() => ctx.repaint());
        return { kind: 'none' };
      case 'p': {
        const entry = state.servers[state.selected];
        if (!entry) return { kind: 'none' };
        const hasLocal = entry.instances.some((inst) => inst.transport === 'local');
        if (!hasLocal) {
          return { kind: 'status', message: 'No local instances to probe for ' + entry.name };
        }
        state.probing = true;
        ctx.repaint();
        try {
          const env = buildStackEnv(ctx);
          const dataDir = getDataDir(ctx);
          await checkStack(entry.instances, { ...env, probe: true, dataDir });
          const refreshedHealth = await checkStack(
            state.servers.flatMap((e) => e.instances),
            { ...env, probe: false }
          );
          state.health = refreshedHealth;
          const capList = readCapabilityCache(dataDir);
          for (const cap of capList) {
            state.caps.set(cap.name, cap);
          }
        } catch (err) {
          state.probing = false;
          ctx.repaint();
          return {
            kind: 'status',
            message: 'Probe failed: ' + (err instanceof Error ? err.message : String(err)),
            tone: 'error'
          };
        }
        state.probing = false;
        ctx.repaint();
        return { kind: 'status', message: 'Probed ' + (state.servers[state.selected]?.name ?? '') };
      }
      default:
        return { kind: 'none' };
    }
  }
};
