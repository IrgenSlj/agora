/**
 * agora-hub — the trust plane for agentic tooling.
 *
 * This is the library surface: types and functions for programmatic use
 * (the `agora mcp` server and integrations build on these). The OpenCode
 * plugin is a *separate* entry point — import it from `agora-hub/opencode`,
 * never from the package root, so plugin-loaders never scan this surface.
 */

export type { AcquireDeps, AcquireInput, AcquireResult } from './acquire.js';
// Capability acquisition (resolve -> scan-gate -> write).
export { acquire, renderAcquireResult } from './acquire.js';
export type { CheckStatus, ScanCheck, ScanOptions, ScanResult } from './scan.js';
// Trust gate.
export { scanItem } from './scan.js';
export * from './stack/manifest.js';
// Stack manager — adapter contract, manifest, sync.
export * from './stack/types.js';
