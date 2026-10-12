import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { childEnv, gitVisibleFiles, repoRoot } from './test-helpers';

// Builds a fresh copy of everything git would commit and proves that installs
// and builds run from the committed lockfiles without changing any file.
const STEP_TIMEOUT_MS = 10 * 60 * 1000;
let copyRoot = '';

function run(command: string, args: string[], extraEnv: Record<string, string> = {}) {
  const result = spawnSync(command, args, {
    cwd: copyRoot,
    encoding: 'utf8',
    env: childEnv(extraEnv),
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function expectSuccess(command: string, args: string[], extraEnv: Record<string, string> = {}) {
  const result = run(command, args, extraEnv);
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited ${String(result.status)}\n${result.output.slice(-4000)}`,
    );
  }
}

// Every file below dir, recursively.
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

// Files below dir whose bytes contain the marker or a PostgreSQL URL scheme.
function filesLeakingDatabaseUrls(dir: string, marker: string): string[] {
  return filesUnder(dir)
    .filter((file) => {
      // latin1 maps every byte to one character, so binary files scan safely.
      const bytes = readFileSync(file).toString('latin1');
      return bytes.includes(marker) || /postgres(ql)?:\/\//.test(bytes);
    })
    .map((file) => relative(dir, file));
}

// Every key of a parsed JSON value, at any depth.
function jsonKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(jsonKeys);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...jsonKeys(child)]);
}

describe('clean checkout', () => {
  beforeAll(() => {
    copyRoot = mkdtempSync(join(tmpdir(), 'foundation-clean-'));
    for (const file of gitVisibleFiles()) {
      mkdirSync(dirname(join(copyRoot, file)), { recursive: true });
      cpSync(join(repoRoot, file), join(copyRoot, file));
    }
    expectSuccess('git', ['init', '--quiet']);
    expectSuccess('git', ['add', '--all']);
    expectSuccess('git', [
      '-c',
      'user.name=clean-checkout',
      '-c',
      'user.email=clean-checkout@localhost',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--quiet',
      '--no-verify',
      '--message',
      'snapshot',
    ]);
  }, STEP_TIMEOUT_MS);

  afterAll(() => {
    if (copyRoot) rmSync(copyRoot, { recursive: true, force: true });
  });

  // covers: AC-6, AC-4
  test(
    'installs JavaScript dependencies from the frozen bun.lock',
    () => {
      expectSuccess('bun', ['ci']);
    },
    STEP_TIMEOUT_MS,
  );

  // covers: AC-6, AC-7
  test(
    'builds the Rust workspace from the committed Cargo.lock',
    () => {
      expectSuccess('cargo', ['build', '--locked', '--workspace']);
    },
    STEP_TIMEOUT_MS,
  );

  // covers: AC-6, AC-8
  test(
    'builds the Angular app into dist/web/browser',
    () => {
      expectSuccess('bun', ['run', 'build:web']);
      const index = readFileSync(join(copyRoot, 'apps/web/dist/web/browser/index.html'), 'utf8');
      expect(index).toContain('<app-root');
      expect(existsSync(join(copyRoot, 'apps/web/dist/web/server'))).toBe(false);
    },
    STEP_TIMEOUT_MS,
  );

  // covers: 0002 AC-7
  test(
    'a web build with database URLs in the environment ships none of them',
    () => {
      const canary = randomUUID();
      const url = `postgres://canary:${canary}@db.invalid/canary`;

      // The scanner must find planted markers before a clean result means anything.
      const probe = mkdtempSync(join(tmpdir(), 'foundation-scan-'));
      try {
        writeFileSync(join(probe, 'marker.js'), `const leaked = "${canary}";`);
        mkdirSync(join(probe, 'nested'));
        writeFileSync(
          join(probe, 'nested/scheme.bin'),
          Buffer.concat([Buffer.from([0, 255]), Buffer.from('postgresql://x'), Buffer.from([254])]),
        );
        writeFileSync(join(probe, 'clean.txt'), 'nothing to see');
        expect(filesLeakingDatabaseUrls(probe, canary).sort()).toEqual([
          'marker.js',
          join('nested', 'scheme.bin'),
        ]);
      } finally {
        rmSync(probe, { recursive: true, force: true });
      }

      expectSuccess('bun', ['run', 'build:web'], {
        DATABASE_URL: url,
        DATABASE_MIGRATOR_URL: url,
      });
      const dist = join(copyRoot, 'apps/web/dist');
      expect(filesUnder(dist).length).toBeGreaterThan(0);
      expect(filesLeakingDatabaseUrls(dist, canary)).toEqual([]);
    },
    STEP_TIMEOUT_MS,
  );

  // covers: 0002 AC-6, 0002 AC-7
  // Reads the dist built by the previous step, so it cannot run on its own.
  test('the web build reads config.json at runtime and has no build time configuration', () => {
    const browser = join(copyRoot, 'apps/web/dist/web/browser');
    expect(JSON.parse(readFileSync(join(browser, 'config.json'), 'utf8'))).toEqual({
      apiBaseUrl: '/api',
    });
    const mainBundles = readdirSync(browser).filter((name) => /^main-.*\.js$/.test(name));
    expect(mainBundles).toHaveLength(1);
    expect(readFileSync(join(browser, mainBundles[0] ?? ''), 'utf8')).toContain('/config.json');

    const webFiles = run('git', ['ls-files', '--', 'apps/web']).output.split('\n').filter(Boolean);
    expect(webFiles.length).toBeGreaterThan(0);
    expect(webFiles.filter((file) => /^environment.*\.ts$/.test(basename(file)))).toEqual([]);

    const angularJson: unknown = JSON.parse(
      readFileSync(join(copyRoot, 'apps/web/angular.json'), 'utf8'),
    );
    const keys = jsonKeys(angularJson);
    expect(keys).toContain('architect');
    expect(keys).not.toContain('fileReplacements');
    expect(keys).not.toContain('define');

    const sources = filesUnder(join(copyRoot, 'apps/web/src'));
    expect(sources.length).toBeGreaterThan(0);
    const usingProcessEnv = sources
      .filter((file) => readFileSync(file, 'utf8').includes('process.env'))
      .map((file) => relative(copyRoot, file));
    expect(usingProcessEnv).toEqual([]);
  });

  // covers: feature 2 (format, lint, Clippy, typecheck clean on a clean checkout)
  test(
    'passes bun run check and installs the pre-commit hook',
    () => {
      expect(run('git', ['config', '--get', 'core.hooksPath']).output.trim()).toBe('.githooks');
      expectSuccess('bun', ['run', 'check']);
    },
    STEP_TIMEOUT_MS,
  );

  // covers: feature 2 (pre-commit hook)
  test(
    'the pre-commit hook rejects a commit that breaks formatting',
    () => {
      const target = join(copyRoot, 'scripts/generated.ts');
      const original = readFileSync(target, 'utf8');
      writeFileSync(target, `${original}\nexport   const   badlyFormatted=1\n`);
      try {
        expectSuccess('git', ['add', 'scripts/generated.ts']);
        const commit = run('git', [
          '-c',
          'user.name=clean-checkout',
          '-c',
          'user.email=clean-checkout@localhost',
          '-c',
          'commit.gpgsign=false',
          'commit',
          '--message',
          'should be rejected',
        ]);
        expect(commit.status).not.toBe(0);
        expect(commit.output).toContain('format:check');
      } finally {
        writeFileSync(target, original);
        expectSuccess('git', ['add', 'scripts/generated.ts']);
      }
    },
    STEP_TIMEOUT_MS,
  );

  // covers: AC-6, AC-3
  test('leaves every committed file, including both lockfiles, unchanged', () => {
    const status = run('git', ['status', '--porcelain']);
    expect(status.status).toBe(0);
    expect(status.output).toBe('');
  });
});
