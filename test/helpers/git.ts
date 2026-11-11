import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE_COMMIT = 1_700_000_000;

/** Commit with a fixed committer time (seconds after BASE_COMMIT). */
export function commitAt(repoDir: string, seconds: number, file: string, body = 'x'): string {
  writeFileSync(join(repoDir, file), body);
  seconds += BASE_COMMIT;
  const env = {
    ...process.env,
    GIT_COMMITTER_DATE: `@${seconds} +0000`,
    GIT_AUTHOR_DATE: `@${seconds} +0000`,
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@example.com',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@example.com'
  };
  execFileSync('git', ['add', '-A'], { cwd: repoDir, env });
  execFileSync('git', ['commit', '-q', '-m', file], { cwd: repoDir, env });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();
}
