import { writeFileSync, renameSync, chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Write `body` to `path` atomically: writes to `path.tmp`, then renames
 * over the destination. Also chmods to `mode` (default 0o600) so files
 * holding user data — tokens, bookmarks, settings — are owner-readable
 * only.
 *
 * Ensures the parent directory exists before writing.
 */
export function atomicWriteFile(path: string, body: string, mode = 0o600): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, body, { mode });
  renameSync(tmp, path);
  try {
    chmodSync(path, mode);
  } catch {
    /* renameSync sometimes resets mode on some filesystems — best-effort */
  }
}
