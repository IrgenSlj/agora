// `agora signer`: the key that signs receipts on this machine.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFile } from '../../atomic-write.js';
import { repoRoot } from '../../receipt/git.js';
import { SIGNERS_FILE, SignersFile } from '../../receipt/keys.js';
import { generateKey, identityOf } from '../../signer/client.js';
import { detectKeyStore } from '../../signer/keystore.js';
import { status } from '../components.js';
import { ExitCode } from '../exit-codes.js';
import { stringFlag, usageError, writeJson, writeLine } from '../helpers.js';
import { cliTheme } from '../theme.js';
import type { CommandHandler } from './types.js';

function readSigners(path: string): SignersFile {
  if (!existsSync(path)) return { keys: [] };
  return SignersFile.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export const commandSigner: CommandHandler = async (parsed, io, style) => {
  const sub = parsed.args[0] ?? 'status';
  const theme = cliTheme(style, io);
  const env = io.env ?? {};
  const store = detectKeyStore(env);
  const key = store?.get();
  const identity = key ? identityOf(key) : undefined;
  const repo = repoRoot(io.cwd ?? process.cwd());
  const signersPath = repo ? join(repo, SIGNERS_FILE) : undefined;
  const trusted = Boolean(
    identity && signersPath && readSigners(signersPath).keys.some((k) => k.keyid === identity.keyid)
  );

  if (sub === 'status') {
    if (parsed.flags.json) {
      writeJson(io.stdout, {
        keystore: store?.name ?? null,
        key: identity ?? null,
        trusted_in_repository: repo ? trusted : null
      });
      return ExitCode.OK;
    }
    if (!store) {
      writeLine(
        io.stdout,
        status('warning', 'no OS keystore found; receipts will be unsigned (signer none)', theme)
      );
      return ExitCode.OK;
    }
    if (!identity) {
      writeLine(
        io.stdout,
        status('warning', `no signing key in ${store.name} · run \`agora signer init\``, theme)
      );
      return ExitCode.OK;
    }
    writeLine(
      io.stdout,
      status('success', `signing key ${identity.keyid.slice(0, 19)}… in ${store.name}`, theme)
    );
    if (repo) {
      writeLine(
        io.stdout,
        trusted
          ? status('success', `trusted by this repository (${SIGNERS_FILE})`, theme)
          : status('warning', `not trusted by this repository · run \`agora signer trust\``, theme)
      );
    }
    return ExitCode.OK;
  }

  if (sub === 'init') {
    if (!store) {
      writeLine(
        io.stderr,
        'No OS keystore on this machine (macOS Keychain or Linux Secret Service via secret-tool). ' +
          'Receipts stay unsigned here; runner-signed receipts in CI are planned.'
      );
      return ExitCode.COULD_NOT_CHECK;
    }
    if (identity) {
      writeLine(io.stdout, `A signing key already exists: ${identity.keyid}`);
      return ExitCode.OK;
    }
    const der = generateKey();
    store.put(der);
    const stored = store.get();
    if (!stored || identityOf(stored).keyid !== identityOf(der).keyid) {
      writeLine(
        io.stderr,
        `The key could not be read back from ${store.name}; nothing was set up.`
      );
      return ExitCode.COULD_NOT_CHECK;
    }
    writeLine(
      io.stdout,
      status('success', `created signing key ${identityOf(der).keyid} in ${store.name}`, theme)
    );
    writeLine(
      io.stdout,
      theme.dim('  It exists only in the keystore. Run `agora signer trust` in each repository.')
    );
    return ExitCode.OK;
  }

  if (sub === 'trust') {
    if (!identity)
      return usageError(io, 'No signing key on this machine; run `agora signer init` first.');
    if (!repo || !signersPath) return usageError(io, 'Not inside a git repository.');
    const doc = readSigners(signersPath);
    if (doc.keys.some((k) => k.keyid === identity.keyid)) {
      writeLine(io.stdout, `Already trusted in ${SIGNERS_FILE}.`);
      return ExitCode.OK;
    }
    const name = stringFlag(parsed, 'name');
    doc.keys.push({ ...identity, ...(name ? { name } : {}) });
    atomicWriteFile(signersPath, `${JSON.stringify(doc, null, 2)}\n`, 0o644);
    writeLine(
      io.stdout,
      status('success', `added ${identity.keyid.slice(0, 19)}… to ${SIGNERS_FILE}`, theme)
    );
    writeLine(
      io.stdout,
      theme.dim(
        '  Commit it. CI trusts keys from the pull request base, so it applies once merged.'
      )
    );
    return ExitCode.OK;
  }

  return usageError(io, `Unknown signer subcommand: ${sub}. Use status, init or trust.`);
};
