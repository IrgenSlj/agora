import { describe, expect, test, afterEach } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWriteFile } from '../src/atomic-write';

const cleanup: string[] = [];
afterEach(() => {
  while (cleanup.length) {
    const dir = cleanup.pop();
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'agora-atomic-'));
  cleanup.push(d);
  return d;
}

describe('atomicWriteFile', () => {
  test('writes body to path', () => {
    const dir = tempDir();
    const path = join(dir, 'sub', 'file.txt');
    atomicWriteFile(path, 'hello world');
    expect(readFileSync(path, 'utf8')).toBe('hello world');
  });

  test('creates parent directory if missing', () => {
    const dir = tempDir();
    const path = join(dir, 'a', 'b', 'c.json');
    atomicWriteFile(path, '{}');
    expect(existsSync(path)).toBe(true);
  });

  test('does not leave a .tmp file behind on success', () => {
    const dir = tempDir();
    const path = join(dir, 'file.txt');
    atomicWriteFile(path, 'x');
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  test('defaults to mode 0o600', () => {
    const dir = tempDir();
    const path = join(dir, 'secret.json');
    atomicWriteFile(path, '{}');
    const mode = statSync(path).mode & 0o777;
    // Some filesystems (Windows, certain CI runners) report 0o666 — only assert
    // owner permissions, skip if the platform stripped them.
    if (process.platform !== 'win32') {
      expect(mode).toBe(0o600);
    }
  });

  test('subsequent writes overwrite the file atomically', () => {
    const dir = tempDir();
    const path = join(dir, 'rotate.txt');
    atomicWriteFile(path, 'one');
    atomicWriteFile(path, 'two');
    atomicWriteFile(path, 'three');
    expect(readFileSync(path, 'utf8')).toBe('three');
  });
});
