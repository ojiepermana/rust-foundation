import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
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

describe('childEnv', () => {
  // A developer .env loaded by bun test must never reach a child process.
  const planted: Record<string, string> = {
    NODE_ENV: 'test',
    GIT_INDEX_FILE: '/tmp/index',
    APP_ENV: 'production',
    APP_PORT: '1',
    DATABASE_URL: 'postgres://app:planted-secret@db/app',
    DATABASE_MIGRATOR_URL: 'postgres://m:planted-secret@db/app',
    DATABASE_URL_FILE: '/run/secrets/db',
    COOKIE_SECURE: 'false',
    CORS_ALLOWED_ORIGINS: 'http://evil.example',
    DEV_SEED_ENABLED: 'true',
    WEB_API_BASE_URL: 'http://evil.example',
    SOME_TOKEN_FILE: '/run/secrets/token',
    FOUNDATION_KEEP_ME: 'kept',
  };
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const [name, value] of Object.entries(planted)) {
      saved[name] = process.env[name];
      process.env[name] = value;
    }
  });

  afterEach(() => {
    for (const name of Object.keys(planted)) {
      const value = saved[name];
      if (value === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = value;
    }
  });

  // covers: 0002 AC-7 (test isolation from a developer .env)
  test('drops NODE_ENV, GIT_*, and every backend configuration variable', () => {
    const env = childEnv();
    const leaked = Object.keys(planted).filter(
      (name) => name !== 'FOUNDATION_KEEP_ME' && name in env,
    );
    expect(leaked).toEqual([]);
    expect(env.FOUNDATION_KEEP_ME).toBe('kept');
    expect(env.PATH).toBe(process.env.PATH);
  });

  // covers: 0002 AC-7
  test('adds extraEnv on top, so a test can pass configuration on purpose', () => {
    const env = childEnv({ DATABASE_URL: 'postgres://canary@db.invalid/canary', NODE_ENV: 'x' });
    expect(env.DATABASE_URL).toBe('postgres://canary@db.invalid/canary');
    expect(env.NODE_ENV).toBe('x');
    expect(env.DATABASE_MIGRATOR_URL).toBeUndefined();
  });
});

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
