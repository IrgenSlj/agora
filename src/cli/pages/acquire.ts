// src/cli/pages/acquire.ts
// The Acquire flow (TUI-1): RESOLVE → PLAN → GATE → APPLY, over the real
// `acquire()` gateway (src/acquire.ts). A satellite page — launched via the
// `a` hotkey from Stack/Search/Item (pre-seeded with an item id), not a
// primary tab (see tui.ts PAGE_ORDER comment).
//
// Honest by construction: a dry-run `acquire()` call gets us RESOLVE + PLAN +
// GATE in one federation round-trip (item/plan/scan bundled); a second,
// explicit `acquire()` call on APPLY is the only one that ever writes. `fail`
// never reaches an apply prompt — verdictBanner already enforces that
// visually; this page enforces it functionally too.
import type { Page, PageAction, PageContext, PageId } from './types.js';
import {
  frame,
  truncate,
  rule,
  pageHeader,
  kvRow,
  spinnerFrame,
  bp,
  provenanceBadges,
  verdictBanner,
  trustPanel,
  planDiff,
  type Verdict,
  type Provenance
} from './components.js';
import { liftStyler } from '../theme.js';
import type { Theme } from '../theme.js';
import { acquire, writeLocationFor, type AcquireResult, type AcquireInput } from '../../acquire.js';
import type { FederatedItem } from '../../federation/types.js';
import type { ScanResult } from '../../scan.js';
import type { MarketplaceItem } from '../../marketplace.js';
import type { AgentToolId, ToolConfigLocation } from '../../stack/types.js';
import { detectTools } from '../../stack/registry.js';
import { detectAgoraDataDir } from '../../state.js';
import { buildPermRows, buildDrift, scanVerdict } from './helpers.js';

const TOOLS: AgentToolId[] = ['opencode', 'claude-code', 'cursor', 'windsurf'];

export interface AcquireSeed {
  /** Item id (preferred — exact federation/catalog lookup). */
  id?: string;
  /** Capability query, used when no exact id is known. */
  query?: string;
  tool?: AgentToolId;
  /** Page to return to on Esc — the page that launched Acquire. */
  returnTo?: PageId;
}

interface AcquireState {
  seed: AcquireSeed | null;
  returnTo: PageId;
  tool: AgentToolId;
  queryInput: string;
  editing: boolean;
  target: string;
  resolving: boolean;
  result: AcquireResult | null;
  location: ToolConfigLocation | null;
  applying: boolean;
  applyResult: AcquireResult | null;
  tick: number;
}

const state: AcquireState = {
  seed: null,
  returnTo: 'stack',
  tool: 'opencode',
  queryInput: '',
  editing: false,
  target: '',
  resolving: false,
  result: null,
  location: null,
  applying: false,
  applyResult: null,
  tick: 0
};

/**
 * Seed the Acquire flow before switching to it — the launch affordance from
 * Stack/Search/Item calls this, then returns `{ kind: 'switch', to: 'acquire' }`.
 * `mount()` reads and clears the seed (module state is the only way to pass
 * data across a page switch — `PageContext` carries no payload).
 */
export function seedAcquire(seed: AcquireSeed): void {
  state.seed = seed;
}

function envRecord(io: PageContext['io']): Record<string, string | undefined> | undefined {
  return io.env as Record<string, string | undefined> | undefined;
}

function acquireInputBase(
  ctx: PageContext,
  tool: AgentToolId
): Pick<AcquireInput, 'tool' | 'cwd' | 'home' | 'env' | 'fetcher' | 'githubToken' | 'dataDir'> {
  const env = envRecord(ctx.io);
  return {
    tool,
    cwd: ctx.io.cwd,
    home: env?.HOME,
    env,
    fetcher: ctx.io.fetcher,
    githubToken: env?.AGORA_GITHUB_TOKEN,
    // Pass cwd/home explicitly (not just env) so dataDir resolution stays
    // under a caller-supplied HOME (e.g. a hermetic test's tmpdir) instead of
    // silently falling back to the real machine's homedir.
    dataDir: detectAgoraDataDir({ cwd: ctx.io.cwd, home: env?.HOME, env })
  };
}

function pickDefaultTool(ctx: PageContext): AgentToolId {
  try {
    const env = envRecord(ctx.io);
    const detected = detectTools({ cwd: ctx.io.cwd, home: env?.HOME, env });
    const found = detected.find((d) => d.present);
    return found ? found.adapter.id : 'opencode';
  } catch {
    return 'opencode';
  }
}

/** Every item resolved through `acquire()` is structurally a FederatedItem
 * when federation supplied it; the plain bundled-catalog fallback has no
 * `provenance` at all — in which case the honest label is `local` (it came
 * from the offline/bundled cache, not a federation source). */
function provenanceOf(item: MarketplaceItem): Provenance[] {
  const fed = item as Partial<FederatedItem>;
  if (fed.provenance && fed.provenance.length > 0) return fed.provenance.map((p) => p.source);
  return ['local'];
}

interface PlanSection {
  harness: string;
  file: string;
  changes: Array<{ op: '+' | '~' | '-'; name: string; detail: string }>;
}

function buildPlanSections(
  result: AcquireResult,
  location: ToolConfigLocation | null,
  tool: AgentToolId,
  width: number
): PlanSection[] {
  const plan = result.plan;
  const item = result.item;
  if (!plan || !item) return [];
  const file = location?.path ?? '(no writable config location found)';
  if (plan.kind === 'mcp-config-patch' && item.kind === 'package' && item.npmPackage) {
    return [
      {
        harness: tool,
        file: truncate(file, width),
        changes: [{ op: '+', name: item.id, detail: truncate('npx ' + item.npmPackage, width) }]
      }
    ];
  }
  return [
    {
      harness: tool,
      file: plan.commands.length ? '(shell — no config file write)' : file,
      changes: plan.commands.map((cmd) => ({ op: '+' as const, name: 'run', detail: truncate(cmd, width) }))
    }
  ];
}

function verdictHeadline(v: Verdict, scan: ScanResult): string {
  if (v === 'fail') return `${scan.summary.fail} check(s) failed — blocked`;
  if (v === 'warn') return `${scan.summary.warn} warning(s) — review before applying`;
  return 'no known red flags — ready to apply';
}

function verdictDetail(v: Verdict, scan: ScanResult, width: number): string | undefined {
  const notable = scan.checks.filter((c) => c.status === (v === 'fail' ? 'fail' : 'warn'));
  if (notable.length === 0) return undefined;
  return truncate(notable.map((c) => c.label + ': ' + c.message).join(' · '), width);
}

async function runResolve(ctx: PageContext, target: string): Promise<AcquireResult> {
  state.target = target;
  state.resolving = true;
  state.result = null;
  state.location = null;
  state.applyResult = null;
  state.applying = false;
  ctx.repaint();
  const base = acquireInputBase(ctx, state.tool);
  const result = await acquire({ ...base, id: target, dryRun: true });
  state.result = result;
  state.location = writeLocationFor(base, state.tool);
  state.resolving = false;
  ctx.repaint();
  return result;
}

async function runApply(ctx: PageContext, acceptWarnings: boolean): Promise<AcquireResult> {
  state.applying = true;
  ctx.repaint();
  const base = acquireInputBase(ctx, state.tool);
  const applied = await acquire({ ...base, id: state.target, acceptWarnings, save: true });
  state.applyResult = applied;
  state.applying = false;
  ctx.repaint();
  return applied;
}

/** Turn a resolve/re-resolve outcome into a status-bar-worthy PageAction. */
function gateActionFor(result: AcquireResult): PageAction {
  if (result.status === 'not_found') {
    return { kind: 'status', message: result.reason ?? 'not found', tone: 'error' };
  }
  if (!result.scan) {
    return { kind: 'plan', summary: result.reason ?? result.plan?.reason ?? 'not installable' };
  }
  const v = scanVerdict(result.scan);
  const { pass, warn, fail } = result.scan.summary;
  return { kind: 'gate', verdict: v, summary: `${pass} pass · ${warn} warn · ${fail} fail` };
}

function canApply(): boolean {
  if (!state.result || !state.result.scan || state.applying || state.applyResult) return false;
  return scanVerdict(state.result.scan) !== 'fail';
}

export const acquirePage: Page = {
  id: 'acquire',
  title: 'ACQUIRE',
  navLabel: 'Acquire',
  navIcon: 'A',
  hotkeys: [
    { key: '/', label: 'resolve' },
    { key: 'r', label: 're-resolve' },
    { key: 't', label: 'tool' },
    { key: 'y', label: 'apply' },
    { key: 'Esc', label: 'back' }
  ],

  async mount(ctx: PageContext): Promise<void> {
    const seed = state.seed;
    state.seed = null;
    state.tick = 0;
    state.applyResult = null;
    state.applying = false;
    if (seed) {
      state.returnTo = seed.returnTo ?? 'stack';
      state.tool = seed.tool ?? pickDefaultTool(ctx);
      state.queryInput = seed.id ?? seed.query ?? '';
      state.editing = false;
    } else if (!state.queryInput) {
      state.tool = pickDefaultTool(ctx);
      state.editing = true;
    }
    if (state.queryInput && !state.editing) {
      await runResolve(ctx, state.queryInput);
    }
  },

  render(ctx: PageContext): string {
    const { width, height } = ctx;
    const theme: Theme = liftStyler(ctx.style, { trueColor: ctx.trueColor });
    const narrow = bp(width) === 'xs';
    const lines: string[] = [];

    const toolLabel = narrow ? undefined : theme.dim('tool:') + ' ' + theme.accent(state.tool);
    lines.push(
      pageHeader({
        title: 'ACQUIRE',
        crumbs: state.target ? [state.target] : [],
        right: toolLabel,
        width,
        theme
      })
    );
    lines.push(' ' + rule(width - 2, undefined, theme));

    // ── editing / empty input ──────────────────────────────────────────────
    if (state.editing) {
      lines.push('');
      lines.push(' ' + theme.accent('resolve ▸') + ' ' + state.queryInput + theme.dim('▏'));
      lines.push('');
      lines.push(
        ' ' +
          theme.dim(
            'Type an item id (mcp-postgres) or a capability query ("postgres database"), then Enter.'
          )
      );
      lines.push(' ' + theme.dim('Esc to cancel.'));
      return frame(lines, width, height);
    }

    // ── resolving spinner ───────────────────────────────────────────────────
    if (state.resolving) {
      state.tick++;
      lines.push('');
      lines.push(
        ' ' + spinnerFrame(state.tick, theme) + '  ' + theme.dim('Resolving ' + state.target + ' via federation…')
      );
      return frame(lines, width, height);
    }

    const result = state.result;
    if (!result) {
      lines.push('');
      lines.push(' ' + theme.dim('Press ') + theme.accent('/') + theme.dim(' to resolve an item.'));
      return frame(lines, width, height);
    }

    // ── not found ────────────────────────────────────────────────────────────
    if (result.status === 'not_found') {
      lines.push('');
      lines.push(' ' + theme.error(theme.glyph('err') + ' Not found'));
      if (result.reason) lines.push(' ' + theme.dim(truncate(result.reason, width - 2)));
      lines.push('');
      lines.push(
        ' ' +
          theme.accent('/') +
          theme.dim(' try another   ') +
          theme.accent('Esc') +
          theme.dim(' back')
      );
      return frame(lines, width, height);
    }

    const item = result.item;
    if (!item) return frame(lines, width, height);
    const prov = provenanceOf(item);

    const body: string[] = [];
    // ── RESOLVE ──────────────────────────────────────────────────────────────
    body.push(' ' + rule(width - 2, 'Resolve', theme));
    body.push(' ' + theme.bold(item.name) + theme.muted('  ' + item.id));
    body.push(' ' + provenanceBadges(prov, theme));
    if (!narrow && item.description) {
      body.push(' ' + theme.dim(truncate(item.description, width - 2)));
    }
    body.push('');

    // ── PLAN ─────────────────────────────────────────────────────────────────
    body.push(' ' + rule(width - 2, 'Plan', theme));
    if (!result.plan) {
      body.push(' ' + theme.dim('No install plan available.'));
    } else if (!result.plan.installable) {
      body.push(' ' + theme.warning(theme.glyph('warn') + ' Not installable'));
      const reason = result.plan.reason ?? result.reason;
      if (reason) body.push(' ' + theme.dim(truncate(reason, width - 2)));
    } else {
      const sections = buildPlanSections(result, state.location, state.tool, width - 4);
      for (const l of planDiff(sections, width - 2, theme)) body.push(' ' + l);
    }
    body.push('');

    // ── blocked pre-gate (no scan was ever computed) ──────────────────────────
    if (!result.scan) {
      const footer = [
        ' ' + rule(width - 2, undefined, theme),
        ' ' +
          theme.accent('/') +
          theme.dim(' try another   ') +
          theme.accent('r') +
          theme.dim(' re-resolve   ') +
          theme.accent('t') +
          theme.dim(' tool   ') +
          theme.accent('Esc') +
          theme.dim(' back')
      ];
      const padCount = Math.max(0, height - lines.length - body.length - footer.length);
      lines.push(...body);
      for (let i = 0; i < padCount; i++) lines.push('');
      lines.push(...footer);
      return frame(lines, width, height);
    }

    // ── GATE ─────────────────────────────────────────────────────────────────
    const scan = result.scan;
    const verdict = scanVerdict(scan);
    body.push(' ' + rule(width - 2, 'Gate', theme));
    const banner = verdictBanner({
      verdict,
      headline: verdictHeadline(verdict, scan),
      detail: verdictDetail(verdict, scan, width - 4),
      hint: verdict === 'warn' ? 'press y to accept warnings and apply' : undefined,
      width: width - 2,
      theme
    });
    for (const l of banner) body.push(' ' + l);
    body.push(
      ' ' + theme.dim('"passed the gate" means no known red flags — not a guarantee of safety.')
    );
    body.push('');
    const panel = trustPanel({
      scan: {
        pass: scan.summary.pass,
        warn: scan.summary.warn,
        fail: scan.summary.fail,
        lines: scan.checks
          .filter((c) => c.status !== 'pass')
          .map((c) => truncate(c.status.toUpperCase() + ' ' + c.label + ' — ' + c.message, width - 6))
      },
      perms: buildPermRows(item, (item as Partial<FederatedItem>).tools),
      drift: buildDrift(scan),
      width: width - 2,
      theme
    });
    body.push(...panel.map((l) => ' ' + l));
    body.push('');

    // ── APPLY ────────────────────────────────────────────────────────────────
    if (state.applying) {
      const footer = [
        ' ' + rule(width - 2, undefined, theme),
        ' ' + spinnerFrame(state.tick++, theme) + '  ' + theme.dim('Applying…')
      ];
      const padCount = Math.max(0, height - lines.length - body.length - footer.length);
      lines.push(...body);
      for (let i = 0; i < padCount; i++) lines.push('');
      lines.push(...footer);
      return frame(lines, width, height);
    }

    if (state.applyResult) {
      const applied = state.applyResult;
      body.push(' ' + rule(width - 2, 'Apply', theme));
      if (applied.status === 'installed') {
        body.push(' ' + theme.success(theme.glyph('ok') + ' Installed ' + item.name));
        if (applied.written) {
          body.push(' ' + kvRow('config', truncate(applied.written.configPath, width - 10), 8, theme));
        }
        for (const step of (applied.nextSteps ?? []).slice(0, 3)) {
          body.push(' ' + theme.dim('- ' + truncate(step, width - 4)));
        }
      } else {
        body.push(' ' + theme.error(theme.glyph('err') + ' Apply did not complete'));
        if (applied.reason) body.push(' ' + theme.dim(truncate(applied.reason, width - 2)));
      }
      const footer = [
        ' ' + rule(width - 2, undefined, theme),
        ' ' + theme.accent('/') + theme.dim(' new   ') + theme.accent('Esc') + theme.dim(' back')
      ];
      const padCount = Math.max(0, height - lines.length - body.length - footer.length);
      lines.push(...body);
      for (let i = 0; i < padCount; i++) lines.push('');
      lines.push(...footer);
      return frame(lines, width, height);
    }

    // ── default footer: apply hint depends on verdict, FAIL never offers it ──
    let footerLine =
      ' ' +
      theme.accent('/') +
      theme.dim(' new   ') +
      theme.accent('r') +
      theme.dim(' re-resolve   ') +
      theme.accent('t') +
      theme.dim(' tool   ');
    if (verdict !== 'fail') {
      footerLine +=
        theme.accent('y') + theme.dim(verdict === 'warn' ? ' accept warnings + apply   ' : ' apply   ');
    }
    footerLine += theme.accent('Esc') + theme.dim(' back');
    const footer = [' ' + rule(width - 2, undefined, theme), footerLine];
    const padCount = Math.max(0, height - lines.length - body.length - footer.length);
    lines.push(...body);
    for (let i = 0; i < padCount; i++) lines.push('');
    lines.push(...footer);
    return frame(lines, width, height);
  },

  async handleKey(event, ctx: PageContext): Promise<PageAction> {
    if (state.editing) {
      switch (event.key) {
        case 'esc':
          state.editing = false;
          if (!state.result) state.queryInput = state.target;
          ctx.repaint();
          return { kind: 'none' };
        case 'enter': {
          const q = state.queryInput.trim();
          if (!q) return { kind: 'none' };
          state.editing = false;
          const result = await runResolve(ctx, q);
          return gateActionFor(result);
        }
        case 'backspace':
          state.queryInput = state.queryInput.slice(0, -1);
          ctx.repaint();
          return { kind: 'none' };
        default:
          if (event.key.length === 1 && !event.ctrl) {
            state.queryInput += event.key;
            ctx.repaint();
          }
          return { kind: 'none' };
      }
    }

    switch (event.key) {
      case '/':
        state.editing = true;
        ctx.repaint();
        return { kind: 'none' };
      case 'r': {
        if (!state.target || state.resolving) return { kind: 'none' };
        const result = await runResolve(ctx, state.target);
        return gateActionFor(result);
      }
      case 't': {
        const idx = TOOLS.indexOf(state.tool);
        state.tool = TOOLS[(idx + 1) % TOOLS.length] ?? 'opencode';
        if (state.target) {
          const result = await runResolve(ctx, state.target);
          return gateActionFor(result);
        }
        ctx.repaint();
        return { kind: 'status', message: 'tool: ' + state.tool };
      }
      case 'y': {
        if (!canApply()) return { kind: 'none' };
        const verdict = scanVerdict(state.result!.scan!);
        const applied = await runApply(ctx, verdict === 'warn');
        if (applied.status === 'installed') {
          return { kind: 'status', message: 'Installed ' + (applied.item?.name ?? state.target) };
        }
        return { kind: 'status', message: applied.reason ?? 'Apply did not complete', tone: 'error' };
      }
      case 'esc':
        return { kind: 'switch', to: state.returnTo };
      default:
        return { kind: 'none' };
    }
  }
};
