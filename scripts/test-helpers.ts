import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../', import.meta.url));

// Files git would put in a commit: tracked plus untracked files that are not ignored.
export function gitVisibleFiles(): string[] {
  const run = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (run.status !== 0) throw new Error(`git ls-files failed: ${run.stderr}`);
  return run.stdout.split('\0').filter(Boolean);
}

export function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8');
}

export function readRepoJson<T = Record<string, any>>(path: string): T {
  return JSON.parse(readRepoFile(path)) as T;
}
