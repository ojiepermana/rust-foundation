import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { accessSync, constants, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { readGeneratedRoots } from './generated';
import { readCargoManifest, readPackageManifest, readRepoFile, repoRoot } from './test-helpers';

interface WorkflowStep {
  uses?: string;
  run?: string;
  with?: Record<string, string>;
}

interface Workflow {
  on: { pull_request?: unknown; push?: { branches?: string[] } };
  permissions: Record<string, string>;
  jobs: Record<string, { steps: WorkflowStep[] }>;
}

const rootScripts = readPackageManifest('package.json').scripts ?? {};
const generatedRoots = readGeneratedRoots(repoRoot);
const installHooks = join(repoRoot, 'scripts/install-hooks.ts');

function git(cwd: string, args: string[]) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

describe('root tasks', () => {
  test('check runs format, lint, typecheck, and the generated file guard in that order', () => {
    expect(rootScripts.check).toBe(
      'bun run format:check && bun run lint && bun run typecheck && bun run check:generated',
    );
  });

  test('lint fails on any ESLint warning and on any Clippy warning across all targets', () => {
    expect(rootScripts.lint).toBe(
      'eslint . --max-warnings 0 && cargo clippy --locked --workspace --all-targets -- -D warnings',
    );
  });

  test('format:check covers Prettier and rustfmt without writing files', () => {
    expect(rootScripts['format:check']).toBe('prettier --check . && cargo fmt --all --check');
  });

  test('typecheck covers both the tooling scripts and the web app', () => {
    expect(rootScripts.typecheck).toBe(
      'tsc -p scripts/tsconfig.json && bun run --filter web typecheck',
    );
  });
});

describe('Rust lint policy', () => {
  test('the workspace forbids unsafe code and the api crate inherits workspace lints', () => {
    const cargo = readCargoManifest('Cargo.toml');
    expect(cargo.workspace?.lints?.rust).toEqual({ unsafe_code: 'forbid' });
    expect(readCargoManifest('apps/api/Cargo.toml').lints).toEqual({ workspace: true });
  });
});

describe('generated roots stay out of lint and format', () => {
  test.each(generatedRoots)('.prettierignore lists %s', (root) => {
    const ignored = readRepoFile('.prettierignore')
      .split('\n')
      .map((line) => line.trim());
    expect(ignored).toContain(`${root}/`);
  });

  test.each(generatedRoots)('Prettier ignores files under %s', (root) => {
    const run = spawnSync(
      'node',
      ['node_modules/prettier/bin/prettier.cjs', '--file-info', `${root}/src/example.ts`],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ ignored: true });
  });

  test.each(generatedRoots)('ESLint ignores files under %s', async (root) => {
    const eslint = new ESLint({ cwd: repoRoot });
    expect(await eslint.isPathIgnored(join(repoRoot, root, 'src/example.ts'))).toBe(true);
    expect(await eslint.isPathIgnored(join(repoRoot, 'scripts/generated.ts'))).toBe(false);
  });
});

describe('pre-commit hook', () => {
  test('the committed hook is executable and runs the same check as CI', () => {
    const hook = join(repoRoot, '.githooks/pre-commit');
    expect(() => {
      accessSync(hook, constants.X_OK);
    }).not.toThrow();
    expect(readRepoFile('.githooks/pre-commit')).toContain('exec bun run check');
  });

  test('install points git at .githooks through the prepare script', () => {
    expect(rootScripts.prepare).toBe('bun scripts/install-hooks.ts');
    const repo = mkdtempSync(join(tmpdir(), 'foundation-hooks-'));
    try {
      expect(git(repo, ['init', '--quiet']).status).toBe(0);
      const run = spawnSync(process.execPath, [installHooks], { cwd: repo, encoding: 'utf8' });
      expect(run.status).toBe(0);
      expect(git(repo, ['config', '--get', 'core.hooksPath']).stdout.trim()).toBe('.githooks');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test('install does nothing and still succeeds outside a git work tree', () => {
    const folder = mkdtempSync(join(tmpdir(), 'foundation-no-git-'));
    try {
      const run = spawnSync(process.execPath, [installHooks], {
        cwd: folder,
        encoding: 'utf8',
        env: { ...process.env, GIT_CEILING_DIRECTORIES: tmpdir() },
      });
      expect(run.status).toBe(0);
      expect(run.stderr).toBe('');
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe('basic CI workflow', () => {
  const workflow = Bun.YAML.parse(readRepoFile('.github/workflows/ci.yml')) as Workflow;
  const steps = Object.values(workflow.jobs).flatMap((job) => job.steps);
  const actions = steps.flatMap((step) => (step.uses ? [step.uses] : []));
  const commands = steps.flatMap((step) =>
    (step.run ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );

  test('runs on pull requests and pushes to main with read only permissions', () => {
    expect(workflow.on.push?.branches).toEqual(['main']);
    expect('pull_request' in workflow.on).toBe(true);
    expect(workflow.permissions).toEqual({ contents: 'read' });
  });

  test('uses exactly the actions pinned in spec 0001', () => {
    expect(actions).toEqual([
      'actions/checkout@v7',
      'actions/setup-node@v7',
      'oven-sh/setup-bun@v2',
      'actions-rust-lang/setup-rust-toolchain@v2',
      'actions/cache@v6',
    ]);
  });

  test('installs Node from .nvmrc before any Bun or Angular step', () => {
    const setupNode = steps.find((step) => step.uses === 'actions/setup-node@v7');
    expect(setupNode?.with).toEqual({ 'node-version-file': '.nvmrc' });
    const firstRun = steps.findIndex((step) => step.run !== undefined);
    expect(steps.findIndex((step) => step === setupNode)).toBeLessThan(firstRun);
  });

  test('installs from the frozen lockfile and runs the same root tasks as developers', () => {
    expect(commands[0]).toBe('bun ci');
    for (const command of commands.slice(1)) {
      const script = /^bun run (\S+)$/.exec(command)?.[1];
      if (script) expect(Object.keys(rootScripts)).toContain(script);
      else expect(command).toMatch(/^cargo \S+ --locked/);
    }
    expect(commands).toContain('bun run check');
  });
});
