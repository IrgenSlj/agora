/**
 * Mutation inventory for every user/agent entry point.
 *
 * This is descriptive before it is enforcing: `coverage` records what the
 * current path really does, including known gaps. The central gate will consume
 * these declarations as paths are migrated. Completeness tests make omission a
 * build failure instead of an architectural blind spot.
 */

export type MutationMode = 'none' | 'conditional' | 'always' | 'delegated';

export type MutationEffect =
  | 'cache'
  | 'local-state'
  | 'install-intent'
  | 'portable-manifest'
  | 'project-files'
  | 'host-config'
  | 'observation-log'
  | 'external-process'
  | 'external-system';

export type GateCoverage = 'not-applicable' | 'missing' | 'partial' | 'present' | 'request-only';

export type ConsentKind =
  | 'none'
  | 'explicit-cli'
  | 'risk-acceptance'
  | 'agent-callable'
  | 'delegated';

export interface MutationDeclaration {
  mode: MutationMode;
  effects: MutationEffect[];
  /** True when the shared trust authorization service must decide before the effect. */
  requiresGate: boolean;
  /** Honest current coverage, not the desired end state. */
  coverage: GateCoverage;
  consent: ConsentKind;
  note: string;
}

function readOnly(note: string): MutationDeclaration {
  return {
    mode: 'none',
    effects: [],
    requiresGate: false,
    coverage: 'not-applicable',
    consent: 'none',
    note
  };
}

function local(
  mode: Exclude<MutationMode, 'none'>,
  effects: MutationEffect[],
  consent: ConsentKind,
  note: string
): MutationDeclaration {
  return { mode, effects, requiresGate: false, coverage: 'not-applicable', consent, note };
}

function controlled(
  mode: Exclude<MutationMode, 'none'>,
  effects: MutationEffect[],
  coverage: Exclude<GateCoverage, 'not-applicable'>,
  consent: ConsentKind,
  note: string
): MutationDeclaration {
  return { mode, effects, requiresGate: true, coverage, consent, note };
}

export const CLI_MUTATION_INVENTORY: Record<string, MutationDeclaration> = {
  acquire: controlled(
    'conditional',
    ['host-config', 'portable-manifest', 'local-state'],
    'present',
    'explicit-cli',
    'Primary acquire adapts scan, revocation, and Cedar evidence into one authorization decision.'
  ),
  apply: controlled(
    'conditional',
    ['host-config', 'project-files'],
    'partial',
    'explicit-cli',
    'Drift is checked; local manifests do not yet receive the complete acquire gate.'
  ),
  approve: controlled(
    'conditional',
    ['host-config', 'portable-manifest', 'local-state'],
    'partial',
    'explicit-cli',
    'Re-runs the complete acquire gate bound to the reviewed purl and project policy; terminal invocation is not itself a strong human-consent boundary.'
  ),
  audit: readOnly('Reads configured servers and queries OSV.'),
  browse: readOnly('Reads merged catalog detail.'),
  capabilities: readOnly('Reads the local capability cache.'),
  completions: readOnly('Prints shell completion source.'),
  config: local(
    'conditional',
    ['host-config', 'external-process'],
    'explicit-cli',
    'show/doctor are read-only unless edit or doctor --fix is selected.'
  ),
  diff: readOnly('Compatibility alias for config diff.'),
  doctor: controlled(
    'conditional',
    ['cache', 'local-state', 'host-config'],
    'partial',
    'explicit-cli',
    '--probe updates capability state and may quarantine drifted host entries.'
  ),
  edit: local(
    'always',
    ['host-config', 'external-process'],
    'explicit-cli',
    'Compatibility alias opens the host config in the user-selected editor.'
  ),
  export: readOnly('Writes evidence to stdout only.'),
  freeze: local(
    'conditional',
    ['portable-manifest'],
    'explicit-cli',
    '--write creates a portable manifest; preview is read-only.'
  ),
  help: readOnly('Prints command documentation.'),
  history: local(
    'conditional',
    ['local-state'],
    'explicit-cli',
    '--clear removes local history; listing is read-only.'
  ),
  info: readOnly('Reads local synchronized artifact information.'),
  init: local(
    'conditional',
    ['project-files', 'host-config', 'external-process'],
    'explicit-cli',
    'Scaffolds projects/integrations and may execute dependency installation commands.'
  ),
  install: controlled(
    'conditional',
    ['project-files', 'host-config', 'portable-manifest', 'external-process'],
    'present',
    'risk-acceptance',
    'Every write runs scan, revocation, and Cedar through the shared gate; --skip-scan leaves an unknown that only --accept-risk clears, and the acceptance is recorded.'
  ),
  installed: readOnly('Reads host configuration.'),
  integrate: controlled(
    'conditional',
    ['host-config'],
    'missing',
    'explicit-cli',
    'Installs Agora into a host; dry-run exists but no shared authorization decision runs.'
  ),
  lock: readOnly('Current lock command verifies only.'),
  mcp: local(
    'delegated',
    ['external-process'],
    'delegated',
    'Starts the MCP router; individual tools have their own declarations below.'
  ),
  notify: local(
    'always',
    ['external-system'],
    'explicit-cli',
    'Sends a desktop notification through an OS command.'
  ),
  observe: local(
    'conditional',
    ['host-config', 'local-state'],
    'explicit-cli',
    'enable/disable rewrite launch commands; status is read-only.'
  ),
  open: local('always', ['external-system'], 'explicit-cli', 'Opens a URL in the system browser.'),
  outdated: readOnly('Checks configured package versions.'),
  plan: readOnly('Computes stack and instruction diffs without writing.'),
  policy: local(
    'conditional',
    ['project-files'],
    'explicit-cli',
    'policy init scaffolds a Cedar file; check/test are read-only.'
  ),
  preferences: local(
    'conditional',
    ['local-state'],
    'explicit-cli',
    'Setting a preference writes local user state; listing is read-only.'
  ),
  quarantine: readOnly('Lists quarantine state.'),
  refresh: local(
    'always',
    ['cache', 'local-state'],
    'explicit-cli',
    'Refreshes the federation cache and local store.'
  ),
  remove: local(
    'conditional',
    ['portable-manifest'],
    'explicit-cli',
    'Removes a manifest entry unless --dry-run is selected.'
  ),
  run: local(
    'always',
    ['external-process', 'observation-log'],
    'explicit-cli',
    'Runs a supervised server and appends bounded session evidence.'
  ),
  scan: readOnly('Computes a trust scan without persisting a decision.'),
  search: local(
    'conditional',
    ['cache'],
    'none',
    'Successful federated queries may refresh per-source cache entries.'
  ),
  shell: local(
    'delegated',
    ['external-process'],
    'delegated',
    'Routes Agora commands or arbitrary user shell commands.'
  ),
  show: readOnly('Compatibility alias for config show.'),
  sync: controlled(
    'conditional',
    ['host-config', 'project-files'],
    'partial',
    'explicit-cli',
    'Remote profiles and drift are gated; local manifests do not receive the complete gate.'
  ),
  today: local(
    'conditional',
    ['cache'],
    'none',
    'Online mode refreshes the news cache; offline mode is read-only.'
  ),
  trust: readOnly('Builds a trust view from current evidence.'),
  try: controlled(
    'always',
    ['external-process', 'cache'],
    'present',
    'risk-acceptance',
    'Running the code is gated like a write: an unavailable or skipped scan is an unknown that only --accept-risk clears, and the acceptance is recorded.'
  ),
  tui: local(
    'delegated',
    ['host-config', 'local-state', 'external-process'],
    'delegated',
    'Full-screen router; actions must inherit the declaration of the service they call.'
  ),
  unquarantine: controlled(
    'always',
    ['host-config', 'local-state'],
    'partial',
    'risk-acceptance',
    'Requires --accept-risk, but is not yet represented by the shared authorization service.'
  ),
  update: controlled(
    'conditional',
    ['host-config'],
    'partial',
    'explicit-cli',
    'Drift is checked before --write --yes; complete provenance/revocation/Cedar checks are absent.'
  ),
  verify: readOnly('Compatibility alias for scan.'),
  watch: local(
    'delegated',
    ['external-process'],
    'delegated',
    'Repeatedly invokes a user-selected Agora command.'
  ),
  welcome: readOnly('Prints onboarding steps.')
};

export const MCP_MUTATION_INVENTORY: Record<string, MutationDeclaration> = {
  agora_acquire: controlled(
    'conditional',
    ['install-intent'],
    'request-only',
    'agent-callable',
    'Preview is read-only; confirm records an inert request and cannot write the stack.'
  ),
  agora_browse: readOnly('Reads catalog, scan, and trust detail.'),
  agora_plan: readOnly('Computes a stack diff.'),
  agora_search: local(
    'conditional',
    ['cache'],
    'none',
    'Federated search may update source caches.'
  ),
  agora_stack_status: readOnly('Reads host configuration and capability cache.')
};

export const PLUGIN_MUTATION_INVENTORY: Record<string, MutationDeclaration> = {
  agora_acquire: readOnly('Plugin acquire is preview-only.'),
  agora_browse: readOnly('Reads bundled catalog detail.'),
  agora_browse_category: readOnly('Reads bundled catalog categories.'),
  agora_chat: local(
    'delegated',
    ['external-process'],
    'agent-callable',
    'Invokes the configured local inference provider or host client.'
  ),
  agora_config: readOnly(
    'Reports config health and the repairs needed; the kernel refuses every agent-authorized host-config write, so fix:true only describes them.'
  ),
  agora_info: readOnly('Returns plugin help.'),
  agora_install: readOnly('Generates instructions/config text but does not write files.'),
  agora_scan: readOnly('Runs an offline scan preview.'),
  agora_search: readOnly('Searches the bundled catalog.'),
  agora_today: readOnly('Reads cached news and bundled catalog highlights.')
};

export function validateMutationInventory(
  inventory: Record<string, MutationDeclaration>
): string[] {
  const errors: string[] = [];
  for (const [name, declaration] of Object.entries(inventory)) {
    if (declaration.mode === 'none' && declaration.effects.length > 0) {
      errors.push(`${name}: mode none cannot declare mutation effects`);
    }
    if (declaration.mode !== 'none' && declaration.effects.length === 0) {
      errors.push(`${name}: mutating/delegated mode must declare at least one effect`);
    }
    if (declaration.requiresGate && declaration.coverage === 'not-applicable') {
      errors.push(`${name}: gate-required entry cannot be not-applicable`);
    }
    if (!declaration.requiresGate && declaration.coverage !== 'not-applicable') {
      errors.push(`${name}: non-gated entry must use not-applicable coverage`);
    }
  }
  return errors;
}
