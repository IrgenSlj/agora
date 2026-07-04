import type { Page, PageAction, PageContext } from './types.js';
import { frame, padRight, truncate, vlen } from './components.js';
import {
  pageHeader,
  rule,
  rail,
  status,
  kvRow,
  tagList,
  spinnerFrame,
  pill
} from './components.js';
import { liftStyler } from '../theme.js';
import type { Theme } from '../theme.js';
import { readAllServers, groupServersByName, detectTools } from '../../stack/registry.js';
import { checkStack } from '../../stack/doctor.js';
import { readCapabilityCache } from '../../stack/capability-cache.js';
import { detectAgoraDataDir } from '../../state.js';
import type { StackHealth } from '../../stack/doctor.js';
import type { ServerCapabilities } from '../../stack/capability-cache.js';
import type { ConfiguredServer, StackEnv } from '../../stack/types.js';
import { seedAcquire } from './acquire.js';

// suppress unused-import warning for pill (used below)
void pill;

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
  tick: number;
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
  tick: 0,
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

// Map doctor health status → theme tone for status()
function healthTone(s: 'ok' | 'warn' | 'error'): 'success' | 'warning' | 'error' {
  if (s === 'ok') return 'success';
  if (s === 'warn') return 'warning';
  return 'error';
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
    { key: 'a', label: 'acquire' },
    { key: 'Esc', label: 'back' }
  ],

  async mount(ctx: PageContext): Promise<void> {
    state.mode = 'list';
    state.selected = 0;
    state.loaded = false;
    state.tick = 0;
    await loadStack(ctx);
  },

  render(ctx: PageContext): string {
    const { width, height } = ctx;
    const theme: Theme = liftStyler(ctx.style, { trueColor: ctx.trueColor });
    const lines: string[] = [];
    const health = state.health;

    // ── Header ────────────────────────────────────────────────────────────────
    const totalServers = state.servers.length;
    const totalInstances = state.servers.reduce((n, e) => n + e.instances.length, 0);

    let rightCluster = '';
    if (health) {
      rightCluster =
        theme.tone('success', theme.glyph('ok') + ' ' + health.summary.ok) +
        '  ' +
        theme.tone('warning', theme.glyph('warn') + ' ' + health.summary.warn) +
        '  ' +
        theme.tone('error', theme.glyph('err') + ' ' + health.summary.error);
    }

    const crumbs =
      totalServers === 0
        ? []
        : [
            totalServers + (totalServers === 1 ? ' server' : ' servers'),
            totalInstances + (totalInstances === 1 ? ' instance' : ' instances')
          ];

    lines.push(pageHeader({ title: 'STACK', crumbs, right: rightCluster, width, theme }));
    lines.push(' ' + rule(width - 2, undefined, theme));

    // ── Error state ────────────────────────────────────────────────────────────
    if (state.error) {
      lines.push('');
      lines.push('   ' + theme.bold('Error loading stack:'));
      lines.push('   ' + theme.dim(state.error));
      lines.push('');
      lines.push('   ' + theme.accent('r') + theme.dim(' refresh'));
      return frame(lines, width, height);
    }

    // ── Loading ────────────────────────────────────────────────────────────────
    if (!state.loaded) {
      lines.push('');
      lines.push('   ' + theme.dim('Loading…'));
      return frame(lines, width, height);
    }

    // ── Empty state ────────────────────────────────────────────────────────────
    if (state.servers.length === 0) {
      lines.push('');
      const toolResults = detectTools(buildStackEnv(ctx));
      const detected = toolResults.filter((t) => t.present).map((t) => t.adapter.displayName);
      if (detected.length > 0) {
        lines.push('   ' + theme.dim('Detected tools: ') + detected.join(', '));
        lines.push('');
      }
      lines.push('   ' + theme.dim('No MCP servers configured.'));
      lines.push(
        '   ' +
          theme.dim('Run ') +
          theme.accent('agora install <name>') +
          theme.dim(' to add a server, or ') +
          theme.accent('agora search') +
          theme.dim(' to browse.')
      );
      lines.push('');
      lines.push(
        '   ' +
          theme.dim('Tools appear here after they are probed with ') +
          theme.accent('p') +
          theme.dim('.')
      );
      lines.push('');
      lines.push('   ' + theme.accent('r') + theme.dim(' refresh'));
      return frame(lines, width, height);
    }

    // ── Detail mode ───────────────────────────────────────────────────────────
    if (state.mode === 'detail') {
      const entry = state.servers[state.selected];
      if (!entry) return frame(lines, width, height);

      const serverHealth = health?.servers.find((h) => h.name === entry.name);
      const tone = serverHealth ? healthTone(serverHealth.status) : 'info';
      const healthBadge = status(tone, entry.name, theme);

      const detail: string[] = [];
      detail.push(pageHeader({ title: 'STACK', crumbs: [entry.name], width, theme }));
      detail.push(' ' + rule(width - 2, undefined, theme));
      detail.push('');

      // Health badge row
      detail.push('   ' + healthBadge);
      detail.push('');

      // Instances
      detail.push(' ' + rule(width - 2, 'Instances', theme));
      const kW = 12;
      for (const inst of entry.instances) {
        const transport = inst.transport === 'local' ? 'local' : 'remote';
        const cmd = inst.transport === 'local' ? (inst.command ?? []).join(' ') : (inst.url ?? '');
        const enabledNote = inst.enabled === false ? '  ' + theme.tone('warning', 'disabled') : '';
        detail.push(
          '   ' +
            kvRow(
              inst.tool,
              theme.dim('[' + inst.scope + ']') + '  ' + theme.dim(transport) + enabledNote,
              kW,
              theme
            )
        );
        if (cmd) {
          detail.push('   ' + theme.dim(truncate(cmd, width - 6)));
        }
      }
      detail.push('');

      // Health checks
      if (serverHealth && serverHealth.checks.length > 0) {
        detail.push(' ' + rule(width - 2, 'Health checks', theme));
        for (const check of serverHealth.checks) {
          const checkTone = check.ok ? 'success' : check.level === 'warn' ? 'warning' : 'error';
          const g = status(checkTone, '', theme);
          const name = padRight(check.name, 28);
          const detail2 = check.detail ? theme.dim(check.detail) : '';
          detail.push('   ' + g + '  ' + name + detail2);
        }
        detail.push('');
      } else if (serverHealth && serverHealth.checks.length === 0) {
        detail.push('   ' + theme.dim('No issues detected.'));
        detail.push('');
      }

      // Cached capabilities
      detail.push(' ' + rule(width - 2, 'Tools', theme));
      if (state.probing) {
        state.tick++;
        detail.push('   ' + spinnerFrame(state.tick, theme) + '  ' + theme.dim('Probing…'));
      } else if (
        state.caps.get(entry.name) &&
        (state.caps.get(entry.name)?.tools.length ?? 0) > 0
      ) {
        const caps = state.caps.get(entry.name)!;
        const toolNames = caps.tools.map((t) => t.name);
        detail.push('   ' + tagList(toolNames, theme));
        detail.push('');
        for (const tool of caps.tools) {
          const desc = tool.description ? theme.dim('  — ' + tool.description) : '';
          detail.push('   ' + theme.bold(tool.name) + desc);
        }
      } else {
        detail.push(
          '   ' +
            theme.dim('(probe to discover tools — press ') +
            theme.accent('p') +
            theme.dim(')')
        );
      }
      detail.push('');

      // Footer
      const footer = [
        ' ' + rule(width - 2, undefined, theme),
        ' ' + theme.accent('p') + theme.dim(' probe   ') + theme.accent('Esc') + theme.dim(' back')
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

      const serverHealth = health?.servers.find((h) => h.name === entry.name);
      const tone = serverHealth ? healthTone(serverHealth.status) : 'info';
      const healthGlyph = serverHealth
        ? theme.tone(
            tone,
            serverHealth.status === 'ok'
              ? theme.glyph('ok')
              : serverHealth.status === 'warn'
                ? theme.glyph('warn')
                : theme.glyph('err')
          )
        : theme.dim(theme.glyph('info'));

      // Tools this server is configured in
      const toolList = [...new Set(entry.instances.map((inst) => inst.tool + ':' + inst.scope))];
      const toolStr = toolList.join(' ');

      // Cached tool count
      const caps = state.caps.get(entry.name);
      const toolCount =
        caps && caps.tools.length > 0 ? theme.dim(' · ' + caps.tools.length + ' tools') : '';

      // Transport type
      const transports = [...new Set(entry.instances.map((inst) => inst.transport))].join('/');

      // Spinner while probing this entry
      let probingNote = '';
      if (state.probing && selected) {
        state.tick++;
        probingNote = '  ' + spinnerFrame(state.tick, theme);
      }

      const nameCell = selected ? theme.bold(entry.name) : entry.name;
      const railStr = rail(theme, selected);
      const left = ' ' + railStr + healthGlyph + '  ' + nameCell + probingNote;
      const right = theme.dim(transports) + toolCount;
      const room = width - vlen(left) - vlen(right) - 3;
      const mid = room > 2 ? '  ' + theme.dim(truncate(toolStr, Math.max(0, room - 2))) : '';
      const gap = ' '.repeat(Math.max(1, room - vlen(mid) - 1));
      lines.push(left + mid + gap + right);
    }

    lines.push(
      '  ' +
        (state.servers.length > limit
          ? theme.dim(
              'servers ' +
                (start + 1) +
                '–' +
                Math.min(start + limit, state.servers.length) +
                ' of ' +
                state.servers.length
            )
          : theme.dim(state.servers.length + (state.servers.length === 1 ? ' server' : ' servers')))
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
          state.tick = 0;
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
        case 'a': {
          const entry = state.servers[state.selected];
          if (!entry) return { kind: 'none' };
          seedAcquire({ id: entry.name, returnTo: 'stack' });
          return { kind: 'switch', to: 'acquire' };
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
        state.tick = 0;
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
      case 'a': {
        const entry = state.servers[state.selected];
        if (!entry) return { kind: 'none' };
        seedAcquire({ id: entry.name, returnTo: 'stack' });
        return { kind: 'switch', to: 'acquire' };
      }
      default:
        return { kind: 'none' };
    }
  }
};
