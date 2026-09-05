import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { FileTransaction, inFileTransaction } from '../src/stack/transaction';

// One install touches up to four files. A failure partway through used to leave
// a machine describing an installation that never happened, and the next
// `agora ci` would report that half-write as drift — the most expensive kind of
// false alarm a tripwire can raise.

let dir: string;
const p = (name: string) => join(dir, name);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agora-tx-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('FileTransaction', () => {
  test('restores prior contents on rollback', () => {
    writeFileSync(p('a.json'), 'original');
    const tx = new FileTransaction();

    tx.write(p('a.json'), 'modified');
    expect(readFileSync(p('a.json'), 'utf8')).toBe('modified');

    tx.rollback();
    expect(readFileSync(p('a.json'), 'utf8')).toBe('original');
  });

  test('removes files that did not exist before', () => {
    const tx = new FileTransaction();
    tx.write(p('new.json'), 'created');
    expect(existsSync(p('new.json'))).toBe(true);

    tx.rollback();
    expect(existsSync(p('new.json'))).toBe(false);
  });

  test('restores the state before the transaction, not the previous write', () => {
    // The subtle one. A second write to the same path inside the transaction is
    // itself part of what must be undone, so the *first* snapshot is the one
    // that gets restored.
    writeFileSync(p('a.json'), 'original');
    const tx = new FileTransaction();

    tx.write(p('a.json'), 'first');
    tx.write(p('a.json'), 'second');
    tx.rollback();

    expect(readFileSync(p('a.json'), 'utf8')).toBe('original');
  });

  test('commit discards the ability to roll back', () => {
    writeFileSync(p('a.json'), 'original');
    const tx = new FileTransaction();
    tx.write(p('a.json'), 'modified');
    tx.commit();

    tx.rollback();
    expect(readFileSync(p('a.json'), 'utf8')).toBe('modified');
  });

  test('inFileTransaction undoes every file when the body throws', () => {
    writeFileSync(p('host.json'), 'host-before');

    expect(() =>
      inFileTransaction((tx) => {
        tx.write(p('host.json'), 'host-after');
        tx.write(p('agora.toml'), 'manifest');
        tx.write(p('agora.lock'), 'lock');
        throw new Error('write failed halfway');
      })
    ).toThrow('write failed halfway');

    // All three, not just the one that failed.
    expect(readFileSync(p('host.json'), 'utf8')).toBe('host-before');
    expect(existsSync(p('agora.toml'))).toBe(false);
    expect(existsSync(p('agora.lock'))).toBe(false);
  });

  test('inFileTransaction keeps everything when the body succeeds', () => {
    const result = inFileTransaction((tx) => {
      tx.write(p('a.json'), 'kept');
      return 'done';
    });

    expect(result).toBe('done');
    expect(readFileSync(p('a.json'), 'utf8')).toBe('kept');
  });

  test('a file written outside the transaction is untouched by rollback', () => {
    writeFileSync(p('unrelated.json'), 'not mine');
    const tx = new FileTransaction();
    tx.write(p('mine.json'), 'mine');
    tx.rollback();

    expect(readFileSync(p('unrelated.json'), 'utf8')).toBe('not mine');
  });

  test('reports paths it could not restore rather than claiming a clean undo', () => {
    // Rollback runs because something already failed. Throwing here would
    // replace a recoverable partial write with an unrecoverable one plus a
    // misleading error, so the failure is returned instead — but it must never
    // be silent, or the caller reports a clean undo that did not happen.
    writeFileSync(p('blocked.json'), 'original');
    const tx = new FileTransaction();
    tx.write(p('blocked.json'), 'modified');

    // Replace the file with a directory: restoring it now fails with EISDIR.
    rmSync(p('blocked.json'));
    mkdirSync(p('blocked.json'));

    const { failed } = tx.rollback();
    expect(failed).toEqual([p('blocked.json')]);
  });

  test('inFileTransaction surfaces both the original error and the failed restore', () => {
    writeFileSync(p('blocked.json'), 'original');

    expect(() =>
      inFileTransaction((tx) => {
        tx.write(p('blocked.json'), 'modified');
        rmSync(p('blocked.json'));
        mkdirSync(p('blocked.json'));
        throw new Error('the real failure');
      })
    ).toThrow(/the real failure.*rollback could not restore/s);
  });
});
