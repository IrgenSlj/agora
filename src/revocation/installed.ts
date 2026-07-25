// Maps what is actually configured in a user's hosts onto purls, so the
// revocation feed can be asked about it.
//
// Only npm-launched local servers are addressable today: those are the ones
// whose identity the feed can express as a purl. A remote server or a
// hand-rolled binary is not "clean", it is *not checkable*, and the caller is
// told which is which rather than being left to assume.

import { buildPurl } from '../model/purl.js';
import type { ConfiguredServer } from '../stack/types.js';

/** npm CLIs that take the package name as their first non-flag argument. */
const NPM_RUNNERS = new Set(['npx', 'bunx', 'pnpx']);

/**
 * Pulls the package name out of a launch command such as
 * `["npx", "-y", "@scope/server"]`.
 */
export function npmPackageFromCommand(command: readonly string[] | undefined): string | undefined {
  if (!command || command.length < 2) return undefined;

  const runner = command[0]?.split(/[\\/]/).pop() ?? '';
  if (!NPM_RUNNERS.has(runner)) return undefined;

  for (const arg of command.slice(1)) {
    if (!arg || arg.startsWith('-')) continue;
    // Strip a trailing @version so the purl carries it in the right field.
    const at = arg.lastIndexOf('@');
    if (at > 0) {
      const version = arg.slice(at + 1);
      if (/^\d/.test(version)) return arg.slice(0, at);
    }
    return arg;
  }
  return undefined;
}

/** Version pinned in the command, when one is (`@scope/server@1.2.3`). */
export function versionFromCommand(command: readonly string[] | undefined): string | undefined {
  if (!command) return undefined;
  for (const arg of command.slice(1)) {
    if (!arg || arg.startsWith('-')) continue;
    const at = arg.lastIndexOf('@');
    if (at > 0) {
      const version = arg.slice(at + 1);
      if (/^\d/.test(version)) return version;
    }
    return undefined;
  }
  return undefined;
}

/** Builds an npm purl, splitting a scoped name so the `@` is encoded per spec. */
export function npmPurl(npmPackage: string, version?: string): string {
  const slash = npmPackage.indexOf('/');
  if (npmPackage.startsWith('@') && slash > 0) {
    return buildPurl({
      type: 'npm',
      namespace: npmPackage.slice(0, slash),
      name: npmPackage.slice(slash + 1),
      version
    });
  }
  return buildPurl({ type: 'npm', name: npmPackage, version });
}

export interface AddressableServer {
  server: ConfiguredServer;
  purl: string;
}

export interface InstalledPurls {
  /** Servers whose identity the feed can be queried about. */
  addressable: AddressableServer[];
  /** Servers that cannot be expressed as a purl — remote, or a non-npm launcher. */
  unaddressable: ConfiguredServer[];
}

export function installedPurls(servers: readonly ConfiguredServer[]): InstalledPurls {
  const addressable: AddressableServer[] = [];
  const unaddressable: ConfiguredServer[] = [];

  for (const server of servers) {
    const npmPackage = npmPackageFromCommand(server.command);
    if (!npmPackage) {
      unaddressable.push(server);
      continue;
    }
    addressable.push({
      server,
      purl: npmPurl(npmPackage, versionFromCommand(server.command))
    });
  }

  return { addressable, unaddressable };
}
