import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gitVisibleFiles, repoRoot } from './test-helpers';

// Builds a fresh copy of everything git would commit and proves that installs
// and builds run from the committed lockfiles without changing any file.
const STEP_TIMEOUT_MS = 10 * 60 * 1000;
let copyRoot = '';

function childEnv() {
  // bun test sets NODE_ENV=test, and a git hook may export GIT_DIR or GIT_INDEX_FILE.
  // The copy must see a normal environment and its own repository only.
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name !== 'NODE_ENV' && !name.startsWith('GIT_')),
  );
}

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd: copyRoot,
    encoding: 'utf8',
    env: childEnv(),
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function expectSuccess(command: string, args: string[]) {
  const result = run(command, args);
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited ${String(result.status)}\n${result.output.slice(-4000)}`,
    );
  }
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
