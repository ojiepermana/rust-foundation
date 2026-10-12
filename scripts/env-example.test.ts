import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { childEnv, readRepoFile, repoRoot } from './test-helpers';

// Asks git whether a path would be ignored, whether or not it exists.
function isIgnored(path: string): boolean {
  const run = spawnSync('git', ['check-ignore', '--no-index', '-q', path], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: childEnv(),
  });
  if (run.status !== 0 && run.status !== 1) {
    throw new Error(`git check-ignore ${path} failed: ${run.stderr}`);
  }
  return run.status === 0;
}

describe('.env files and .env.example', () => {
  // covers: 0002 AC-5
  test.each(['.env', '.env.local', '.env.production', 'apps/web/.env'])(
    'git ignores %s',
    (path) => {
      expect(isIgnored(path)).toBe(true);
    },
  );

  // covers: 0002 AC-5
  test('git keeps .env.example', () => {
    expect(isIgnored('.env.example')).toBe(false);
  });

  // covers: 0002 AC-5
  test('every secret line in .env.example is empty', () => {
    const lines = readRepoFile('.env.example').split('\n');
    const secrets: string[] = [];
    lines.forEach((line, index) => {
      if (!line.startsWith('# ') || !line.endsWith(', secret.')) return;
      const assignment = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(lines[index + 1] ?? '');
      expect(assignment, `"${line}" must be followed by NAME=`).not.toBeNull();
      const [, name = '', value] = assignment ?? [];
      expect({ name, value }).toEqual({ name, value: '' });
      secrets.push(name);
    });
    expect(secrets).toContain('DATABASE_URL');
    expect(secrets).toContain('DATABASE_MIGRATOR_URL');

    const fileLines = lines.filter((line) => /^# [A-Z][A-Z0-9_]*_FILE=/.test(line));
    expect(fileLines).toEqual(['# DATABASE_URL_FILE=', '# DATABASE_MIGRATOR_URL_FILE=']);
  });
});
