/**
 * opencode-agora — the OpenCode plugin entry for Agora.
 *
 * This package is a thin re-export. It exists so that existing
 * `"plugin": ["opencode-agora"]` configs keep working: OpenCode loads plugins
 * by npm *package name* and auto-installs them at startup, so the plugin entry
 * lives here while every line of real code (and the `agora` CLI) ships in the
 * `agora-hub` dependency pinned in package.json.
 *
 * CLI users want the `agora` binary: `npm i -g agora-hub`, then run `agora`.
 */
export * from 'agora-hub/opencode';
export { default } from 'agora-hub/opencode';
