// Where the receipt signing key lives: the OS keystore, never a file.
//
// macOS: the login keychain through /usr/bin/security (or the keychain file
// named by AGORA_KEYCHAIN). Linux: the Secret Service through `secret-tool`.
// Anything else has no local signer, and receipts say `signer none`.
//
// The secret is passed on stdin, never on a command line, so it does not show
// up in the process list.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const SERVICE = 'agora-receipt-signing';
const ACCOUNT = 'agora';

export interface KeyStore {
  name: 'macos-keychain' | 'secret-service';
  get(): Buffer | undefined;
  put(pkcs8Der: Buffer): void;
  remove(): void;
}

function onPath(program: string, env: Record<string, string | undefined>): boolean {
  return (env.PATH ?? '').split(':').some((d) => d && existsSync(join(d, program)));
}

function macos(env: Record<string, string | undefined>): KeyStore {
  const keychain = env.AGORA_KEYCHAIN ? [env.AGORA_KEYCHAIN] : [];
  const run = (args: string[], input?: string) =>
    execFileSync('/usr/bin/security', args, {
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
  return {
    name: 'macos-keychain',
    get() {
      try {
        const b64 = run([
          'find-generic-password',
          '-a',
          ACCOUNT,
          '-s',
          SERVICE,
          '-w',
          ...keychain
        ]).trim();
        return b64 ? Buffer.from(b64, 'base64') : undefined;
      } catch {
        return undefined;
      }
    },
    put(der) {
      const target = keychain.length ? ` "${keychain[0]}"` : '';
      run(
        ['-i'],
        `add-generic-password -U -a ${ACCOUNT} -s ${SERVICE} -w ${der.toString('base64')}${target}\n`
      );
    },
    remove() {
      try {
        run(['delete-generic-password', '-a', ACCOUNT, '-s', SERVICE, ...keychain]);
      } catch {
        // Nothing to remove.
      }
    }
  };
}

function secretService(): KeyStore {
  const attrs = ['service', SERVICE, 'account', ACCOUNT];
  return {
    name: 'secret-service',
    get() {
      try {
        const b64 = execFileSync('secret-tool', ['lookup', ...attrs], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe']
        }).trim();
        return b64 ? Buffer.from(b64, 'base64') : undefined;
      } catch {
        return undefined;
      }
    },
    put(der) {
      execFileSync('secret-tool', ['store', '--label=Agora receipt signing key', ...attrs], {
        input: der.toString('base64'),
        stdio: ['pipe', 'pipe', 'pipe']
      });
    },
    remove() {
      try {
        execFileSync('secret-tool', ['clear', ...attrs], { stdio: 'ignore' });
      } catch {
        // Nothing to remove.
      }
    }
  };
}

/** The keystore for this machine, or undefined when there is none. */
export function detectKeyStore(env: Record<string, string | undefined>): KeyStore | undefined {
  if (process.platform === 'darwin' && existsSync('/usr/bin/security')) return macos(env);
  if (process.platform === 'linux' && onPath('secret-tool', env)) return secretService();
  return undefined;
}
