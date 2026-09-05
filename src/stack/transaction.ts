// All of it, or none of it.
//
// Acquiring an artifact touches up to four files: the host config, the portable
// manifest, the trust sidecar, and the lockfile. They were written one after
// another with no relationship between them, so any failure after the first
// left the machine in a state that describes no real installation — a server
// running in a host config that `agora.toml` has never heard of, or a lockfile
// pinning something the manifest does not list. The next `agora ci` would then
// report drift that is really just a half-finished write, which is the most
// expensive kind of false alarm a tripwire can raise.
//
// This is deliberately not a general transaction system. It snapshots the exact
// bytes of the files it is about to touch, and puts them back if anything
// throws. That is enough for a handful of small local files, it needs no
// journal, and it has one property worth more than sophistication: restoring a
// file Agora just wrote cannot itself require Agora to be working correctly.

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { atomicWriteFile } from '../atomic-write.js';

interface Snapshot {
  path: string;
  /** Prior contents, or null when the file did not exist and must be removed. */
  before: string | null;
}

export class FileTransaction {
  private readonly snapshots: Snapshot[] = [];
  private done = false;

  /**
   * Record a file's current state before it is written.
   *
   * Idempotent per path: the *first* snapshot is the one to restore, because a
   * later write within the same transaction is itself part of what must be
   * undone.
   */
  snapshot(path: string): void {
    if (this.snapshots.some((s) => s.path === path)) return;
    this.snapshots.push({
      path,
      before: existsSync(path) ? readFileSync(path, 'utf8') : null
    });
  }

  /** Snapshot, then write. The ordinary way to use this. */
  write(path: string, contents: string): void {
    this.snapshot(path);
    atomicWriteFile(path, contents);
  }

  /**
   * Put every touched file back exactly as it was.
   *
   * Best-effort by necessity: it is already running because something failed,
   * and throwing here would replace a recoverable partial write with an
   * unrecoverable one plus a misleading error. Paths that could not be restored
   * are returned so the caller can name them rather than claim a clean undo.
   */
  rollback(): { failed: string[] } {
    const failed: string[] = [];
    // Reverse order so a file created inside the transaction is removed before
    // any directory work an earlier step might have done.
    for (const snap of [...this.snapshots].reverse()) {
      try {
        if (snap.before === null) {
          if (existsSync(snap.path)) rmSync(snap.path, { force: true });
        } else {
          // Not atomicWriteFile: the temp-file dance is what protects a *new*
          // write from being interrupted. Restoring known-good bytes should not
          // depend on more machinery than strictly necessary.
          writeFileSync(snap.path, snap.before, 'utf8');
        }
      } catch {
        failed.push(snap.path);
      }
    }
    this.done = true;
    return { failed };
  }

  /** Mark the transaction successful; rollback data is no longer needed. */
  commit(): void {
    this.done = true;
    this.snapshots.length = 0;
  }

  get settled(): boolean {
    return this.done;
  }

  /** Paths touched so far, for diagnostics. */
  get touched(): string[] {
    return this.snapshots.map((s) => s.path);
  }
}

/**
 * Run `fn` and undo every file it wrote if it throws.
 *
 * The error is rethrown after the rollback, because a caller that swallowed it
 * would be back to not knowing whether the install happened.
 */
export function inFileTransaction<T>(fn: (tx: FileTransaction) => T): T {
  const tx = new FileTransaction();
  try {
    const result = fn(tx);
    tx.commit();
    return result;
  } catch (err) {
    const { failed } = tx.rollback();
    if (failed.length) {
      const detail = failed.join(', ');
      throw new Error(
        `${err instanceof Error ? err.message : String(err)} — and rollback could not restore ${detail}; those files may be in a partial state`
      );
    }
    throw err;
  }
}
