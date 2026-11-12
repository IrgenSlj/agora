// Profiles: minimal policies per MCP server, shipped in `profiles/`.
//
// A profile names its server as "{{server}}", replaced on `add` by the name
// the server has in the user's host config. It is written into agora.cedar
// between markers, so adding it again replaces it.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SERVER_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
export const PROFILE_NAME = /^[a-z0-9][a-z0-9-]{0,99}$/;

export function profilesDir(): string {
  // dist/policy → ../../profiles (the package root), and the same from src/policy.
  return join(HERE, '..', '..', 'profiles');
}

export interface Profile {
  name: string;
  package?: string;
  summary: string;
  text: string;
}

export function listProfiles(dir = profilesDir()): Profile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.cedar'))
    .sort()
    .map((f) => {
      const text = readFileSync(join(dir, f), 'utf8');
      return {
        name: f.slice(0, -'.cedar'.length),
        package: /^\/\/ package: (.+)$/m.exec(text)?.[1]?.trim(),
        summary: /^\/\/ Profile: (.+)$/m.exec(text)?.[1]?.trim() ?? '',
        text
      };
    });
}

const begin = (name: string, server: string) =>
  `// --- agora profile ${name} (${server}): begin ---`;
const end = (name: string, server: string) => `// --- agora profile ${name} (${server}): end ---`;

/** The profile with its server filled in, between markers. */
export function profileBlock(profile: Profile, server: string): string {
  const body = profile.text.replaceAll('{{server}}', server).trimEnd();
  return `${begin(profile.name, server)}\n${body}\n${end(profile.name, server)}`;
}

/** agora.cedar with the profile added, or replaced if it is already there. */
export function addProfile(policy: string, profile: Profile, server: string): string {
  const block = profileBlock(profile, server);
  const b = policy.indexOf(begin(profile.name, server));
  const e = policy.indexOf(end(profile.name, server));
  if (b >= 0 && e > b)
    return `${policy.slice(0, b)}${block}${policy.slice(e + end(profile.name, server).length)}`;
  return `${policy.trimEnd()}\n\n${block}\n`;
}
