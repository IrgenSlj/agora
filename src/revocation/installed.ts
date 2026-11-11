// Maps what is actually configured in a user's hosts onto purls, so the
// revocation feed can be asked about it.
//
// Only npm-launched local servers are addressable today: those are the ones
// whose identity the feed can express as a purl. A remote server or a
// hand-rolled binary is not "clean", it is *not checkable*, and the caller is
// told which is which rather than being left to assume.

import semver from 'semver';
import { buildPurl } from '../model/purl.js';
import type { ConfiguredServer } from '../stack/types.js';

/** npm CLIs that take the package name as their first non-flag argument. */
const NPM_RUNNERS = new Set(['npx', 'bunx', 'pnpx']);

/** Splits `@scope/name@spec` or `name@spec` into name and the text after `@`. */
function splitSpec(arg: string): { name: string; spec?: string } {
  const at = arg.indexOf('@', arg.startsWith('@') ? 1 : 0);
  return at > 0 ? { name: arg.slice(0, at), spec: arg.slice(at + 1) } : { name: arg };
}

function firstPackageArg(command: readonly string[] | undefined): string | undefined {
  if (!command || command.length < 2) return undefined;
  const runner = command[0]?.split(/[\\/]/).pop() ?? '';
  if (!NPM_RUNNERS.has(runner)) return undefined;
  return command.slice(1).find((arg) => arg && !arg.startsWith('-'));
}

/**
 * Pulls the package name out of a launch command such as
 * `["npx", "-y", "@scope/server@latest"]`. Any `@version`, `@tag` or `@range`
 * is removed: it belongs in the purl's version field, or nowhere.
 */
export function npmPackageFromCommand(command: readonly string[] | undefined): string | undefined {
  const arg = firstPackageArg(command);
  return arg ? splitSpec(arg).name : undefined;
}

/**
 * The exact version pinned in the command (`@scope/server@1.2.3`). A tag such
 * as `latest` or a range such as `^1.2` names no single version, so the answer
 * is unknown and the caller must treat it as unknown.
 */
export function versionFromCommand(command: readonly string[] | undefined): string | undefined {
  const arg = firstPackageArg(command);
  const spec = arg ? splitSpec(arg).spec : undefined;
  return spec && semver.valid(spec) ? spec : undefined;
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
