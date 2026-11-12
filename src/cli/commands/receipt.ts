// `agora receipt`: what agent sessions did to produce a commit, as a statement
// stored in git notes under refs/notes/agora.

import { envelope } from '../../evidence/dsse.js';
import { sha256Hex } from '../../model/hash.js';
import { buildReceipt, POLICY_FILE } from '../../receipt/build.js';
import { fileAt, readNote, repoRoot, resolveCommit, writeNote } from '../../receipt/git.js';
import { parseSigners, SIGNERS_FILE, type TrustedKey } from '../../receipt/keys.js';
import { receiptLines } from '../../receipt/render.js';
import { verifyReceipt } from '../../receipt/verify.js';
import { status } from '../components.js';
import { ExitCode } from '../exit-codes.js';
import { detectDataDir, stringFlag, usageError, writeJson, writeLine } from '../helpers.js';
import { cliTheme } from '../theme.js';
import type { CommandHandler } from './types.js';

export function policyShaAt(repo: string, sha: string): string | null {
  const policy = fileAt(repo, sha, POLICY_FILE);
  return policy ? `sha256:${sha256Hex(policy)}` : null;
}

export function trustedKeysAt(repo: string, rev: string | undefined): TrustedKey[] {
  if (!rev) return [];
  const text = fileAt(repo, rev, SIGNERS_FILE);
  try {
    return parseSigners(text?.toString('utf8'));
  } catch {
    return [];
  }
}

export const commandReceipt: CommandHandler = async (parsed, io, style) => {
  const sub = parsed.args[0] ?? 'show';
  const theme = cliTheme(style, io);
  const repo = repoRoot(io.cwd ?? process.cwd());
  if (!repo) return usageError(io, 'Not inside a git repository.');

  if (sub === 'install' || sub === 'uninstall') {
    const { installGitHooks, uninstallGitHooks } = await import('../../receipt/githooks.js');
    if (sub === 'uninstall') {
      const removed = uninstallGitHooks(repo);
      if (parsed.flags.json) writeJson(io.stdout, { removed });
      else
        writeLine(
          io.stdout,
          removed.length
            ? `Removed Agora's lines from ${removed.join(' and ')}.`
            : 'No Agora git hooks here.'
        );
      return ExitCode.OK;
    }
    const changes = installGitHooks(repo);
    if (parsed.flags.json) {
      writeJson(io.stdout, { hooks: changes });
      return changes.some((c) => c.result === 'skipped') ? ExitCode.COULD_NOT_CHECK : ExitCode.OK;
    }
    for (const c of changes) {
      const line = `${c.hook} ${c.result}${c.why ? `: ${c.why}` : ''} · ${c.path}`;
      writeLine(io.stdout, c.result === 'skipped' ? theme.warning(line) : theme.dim(line));
    }
    writeLine(
      io.stdout,
      'Each commit now gets its receipt, and pushes send refs/notes/agora. Neither hook ever ' +
        'blocks a commit or a push.'
    );
    return changes.some((c) => c.result === 'skipped') ? ExitCode.COULD_NOT_CHECK : ExitCode.OK;
  }

  const rev = parsed.args[1] ?? 'HEAD';
  const sha = resolveCommit(repo, rev);
  if (!sha) return usageError(io, `Not a commit: ${rev}`);

  if (sub === 'write') {
    const dataDir = detectDataDir(parsed, io);
    const { signReceiptEnvelope, signerAvailable } = await import('../../signer/client.js');
    let level = parsed.flags['no-sign'] ? 'none' : await signerAvailable(io.env ?? {});
    let built = buildReceipt({ dataDir, repo, sha, signer: level });
    if (built.status === 'no-sessions') {
      if (parsed.flags.json) writeJson(io.stdout, { commit: sha, status: 'no-sessions' });
      else
        writeLine(
          io.stdout,
          theme.muted(`No recorded agent activity for ${sha.slice(0, 12)}; no receipt written.`)
        );
      return ExitCode.OK;
    }
    if (built.status === 'log-invalid') {
      writeLine(
        io.stderr,
        `Session ${built.session} does not verify; refusing to write a receipt from it.`
      );
      for (const p of built.problems) writeLine(io.stderr, `  ${p}`);
      return ExitCode.POLICY_FORBID;
    }
    let env = envelope(built.statement);
    if (level !== 'none') {
      try {
        env = await signReceiptEnvelope(env, io.env ?? {});
      } catch (e) {
        // An unsigned receipt that claims a signer would never verify. Say what
        // happened and write the honest, unsigned one instead.
        writeLine(
          io.stderr,
          `Signing failed (${e instanceof Error ? e.message : String(e)}); writing an unsigned receipt.`
        );
        level = 'none';
        built = buildReceipt({ dataDir, repo, sha, signer: level });
        if (built.status !== 'built') return ExitCode.COULD_NOT_CHECK;
        env = envelope(built.statement);
      }
    }
    const body = JSON.stringify(env);
    if (parsed.flags['dry-run']) {
      writeJson(io.stdout, { commit: sha, envelope: env, predicate: built.predicate });
      return ExitCode.OK;
    }
    writeNote(repo, sha, body);
    if (parsed.flags.json) {
      writeJson(io.stdout, { commit: sha, status: 'written', predicate: built.predicate });
    } else {
      writeLine(
        io.stdout,
        status('success', `receipt written for ${sha.slice(0, 12)} (${level})`, theme)
      );
      for (const line of receiptLines(built.predicate))
        writeLine(io.stdout, theme.dim(`  ${line}`));
      writeLine(io.stdout, theme.dim(`  push it with: git push origin refs/notes/agora`));
    }
    return ExitCode.OK;
  }

  if (sub === 'show' || sub === 'verify') {
    const note = readNote(repo, sha);
    if (!note) {
      if (parsed.flags.json) writeJson(io.stdout, { commit: sha, status: 'not-established' });
      else
        writeLine(io.stdout, theme.muted(`${sha.slice(0, 12)} has no receipt: not established.`));
      const failOnUnknown =
        parsed.flags['fail-on-unknown'] === true || parsed.flags.failOnUnknown === true;
      return sub === 'verify' && failOnUnknown ? ExitCode.COULD_NOT_CHECK : ExitCode.OK;
    }
    const trustedRev =
      stringFlag(parsed, 'trusted-from') ?? stringFlag(parsed, 'trustedFrom') ?? 'HEAD';
    const verdict = verifyReceipt(note, sha, {
      policySha256: policyShaAt(repo, sha),
      trusted: trustedKeysAt(repo, resolveCommit(repo, trustedRev))
    });
    if (parsed.flags.json) {
      writeJson(io.stdout, {
        commit: sha,
        status: verdict.valid ? 'valid' : 'invalid',
        ...verdict
      });
    } else {
      const head = `${sha.slice(0, 12)} · receipt ${verdict.valid ? 'verifies' : 'does not verify'} · signer ${verdict.level}`;
      writeLine(io.stdout, status(verdict.valid ? 'success' : 'error', head, theme));
      for (const p of verdict.problems) writeLine(io.stdout, theme.error(`  ${p}`));
      if (verdict.predicate) {
        for (const line of receiptLines(verdict.predicate))
          writeLine(io.stdout, theme.dim(`  ${line}`));
      }
    }
    return verdict.valid ? ExitCode.OK : ExitCode.POLICY_FORBID;
  }

  return usageError(io, `Unknown receipt subcommand: ${sub}. Use write, show or verify.`);
};
