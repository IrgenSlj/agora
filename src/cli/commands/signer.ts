// `agora signer`: the key that signs receipts on this machine.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFile } from '../../atomic-write.js';
import { repoRoot, tryGit } from '../../receipt/git.js';
import { SIGNERS_FILE, SignersFile } from '../../receipt/keys.js';
import { generateKey, identityOf } from '../../signer/client.js';
import { detectKeyStore } from '../../signer/keystore.js';
import { GITHUB_OIDC_ISSUER } from '../../signer/runner.js';
import { status } from '../components.js';
import { ExitCode } from '../exit-codes.js';
import { stringFlag, usageError, writeJson, writeLine } from '../helpers.js';
import { cliTheme } from '../theme.js';
import type { CommandHandler } from './types.js';

function readSigners(path: string): SignersFile {
  if (!existsSync(path)) return { keys: [] };
  return SignersFile.parse(JSON.parse(readFileSync(path, 'utf8')));
}

/** `owner/repo` of the origin remote, when it is on github.com. */
function githubSlug(repo: string): string | undefined {
  const url = tryGit(repo, ['remote', 'get-url', 'origin']);
  const m = url && /github\.com[:/]([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(url);
  return m?.[1];
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
          'Receipts stay unsigned here. In CI, receipts are runner-signed instead: see `agora signer trust --workflow`.'
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

  if (sub === 'trust' && stringFlag(parsed, 'workflow')) {
    if (!repo || !signersPath) return usageError(io, 'Not inside a git repository.');
    const file = stringFlag(parsed, 'workflow') as string;
    const ref = stringFlag(parsed, 'ref') ?? 'refs/heads/main';
    const slug = githubSlug(repo);
    if (!slug)
      return usageError(
        io,
        'The origin remote is not a GitHub repository; runner signing needs one.'
      );
    if (!/^[A-Za-z0-9._-]+\.ya?ml$/.test(file.replace(/^\.github\/workflows\//, '')))
      return usageError(io, '--workflow takes a workflow file name, such as agent.yml.');
    if (!/^refs\/(heads|tags)\/[A-Za-z0-9._/-]+$/.test(ref))
      return usageError(io, '--ref takes a full ref, such as refs/heads/main.');
    const identity = `https://github.com/${slug}/.github/workflows/${file.replace(/^\.github\/workflows\//, '')}@${ref}`;
    const doc = readSigners(signersPath);
    const runners = doc.runners ?? [];
    if (runners.some((r) => r.identity === identity)) {
      writeLine(io.stdout, `Already trusted in ${SIGNERS_FILE}.`);
      return ExitCode.OK;
    }
    const name = stringFlag(parsed, 'name');
    runners.push({ issuer: GITHUB_OIDC_ISSUER, identity, ...(name ? { name } : {}) });
    atomicWriteFile(signersPath, `${JSON.stringify({ ...doc, runners }, null, 2)}\n`, 0o644);
    writeLine(io.stdout, status('success', `trusted runner ${identity}`, theme));
    writeLine(
      io.stdout,
      theme.dim(
        '  Receipts that workflow signs on a runner (permissions: id-token: write) now verify at\n' +
          '  runner-oidc. Commit it; CI trusts identities from the pull request base.'
      )
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
