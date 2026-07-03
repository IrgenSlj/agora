/**
 * agora-hub — the system manager for your agentic stack.
 *
 * This is the library surface: types and functions for programmatic use
 * (the `agora mcp` server and integrations build on these). The OpenCode
 * plugin is a *separate* entry point — import it from `agora-hub/opencode`,
 * never from the package root, so plugin-loaders never scan this surface.
 */

// Stack manager — the crown jewels (adapter contract, manifest, sync).
export * from './stack/types.js';
export * from './stack/manifest.js';

// Trust gate.
export { scanItem } from './scan.js';
export type { ScanResult, ScanCheck, CheckStatus, ScanOptions } from './scan.js';

// Capability acquisition (resolve → scan-gate → write).
export { acquire, renderAcquireResult } from './acquire.js';
export type { AcquireInput, AcquireResult, AcquireDeps } from './acquire.js';
