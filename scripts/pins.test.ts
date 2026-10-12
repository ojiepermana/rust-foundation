import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRuntime } from './guard-node.mjs';
import {
  gitVisibleFiles,
  readBunfig,
  readCargoManifest,
  readPackageManifest,
  readRepoFile,
  readRustToolchain,
  repoRoot,
  type PackageManifest,
} from './test-helpers';

const EXACT_VERSION = /^\d+\.\d+\.\d+$/;
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'overrides',
  'resolutions',
] as const satisfies readonly (keyof PackageManifest)[];
const FOREIGN_LOCKFILES = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
];

const files = gitVisibleFiles();
const manifests = files.filter((file) => file === 'package.json' || file.endsWith('/package.json'));
const rootManifest = readPackageManifest('package.json');

describe('dependency versions', () => {
  // covers: AC-3
  test('finds both the root and the web manifest', () => {
    expect(manifests).toContain('package.json');
    expect(manifests).toContain('apps/web/package.json');
  });

  // covers: AC-3
  test.each(manifests)('%s pins every dependency to an exact version', (manifestPath) => {
    const manifest = readPackageManifest(manifestPath);
    const loose: string[] = [];
    for (const field of DEPENDENCY_FIELDS) {
      for (const [name, version] of Object.entries(manifest[field] ?? {})) {
        if (typeof version !== 'string' || !EXACT_VERSION.test(version)) {
          loose.push(`${field}.${name}=${JSON.stringify(version)}`);
        }
      }
    }
    expect(loose).toEqual([]);
  });

  // covers: AC-3
  test('bunfig keeps bun add exact, uses the hoisted linker, and has no [run] section', () => {
    const bunfig = readBunfig();
    expect(bunfig.install).toMatchObject({ linker: 'hoisted', exact: true });
    expect(bunfig.run).toBeUndefined();
    expect(bunfig.install?.trustedDependencies).toBeUndefined();
  });
});

describe('lockfiles', () => {
  // covers: AC-4
  test('bun.lock and Cargo.lock live at the repo root', () => {
    expect(files).toContain('bun.lock');
    expect(files).toContain('Cargo.lock');
  });

  // covers: AC-4
  test('no other package manager lockfile is visible to git', () => {
    const foreign = files.filter((file) =>
      FOREIGN_LOCKFILES.some((name) => file === name || file.endsWith(`/${name}`)),
    );
    expect(foreign).toEqual([]);
  });

  // covers: AC-4
  test('bun.lock and Cargo.lock exist only at the root', () => {
    const nested = files.filter(
      (file) => file.endsWith('/bun.lock') || file.endsWith('/Cargo.lock'),
    );
    expect(nested).toEqual([]);
  });
});

describe('toolchain pins', () => {
  // covers: AC-3
  test('Bun is pinned exactly and npm is refused through devEngines', () => {
    const packageManager = rootManifest.packageManager ?? '';
    expect(packageManager).toMatch(/^bun@\d+\.\d+\.\d+$/);
    const pinnedBun = packageManager.slice('bun@'.length);
    expect(rootManifest.devEngines?.packageManager).toEqual({
      name: 'bun',
      version: pinnedBun,
      onFail: 'error',
    });
  });

  // covers: AC-3, AC-9
  test('.nvmrc holds an exact version that satisfies the root engines.node range', () => {
    const nvmrc = readRepoFile('.nvmrc');
    expect(nvmrc.trim()).toMatch(EXACT_VERSION);
    const result = checkRuntime({
      versions: { node: nvmrc.trim() },
      nvmrc,
      enginesNode: rootManifest.engines?.node,
    });
    expect(result).toEqual({ ok: true });
  });

  // covers: AC-3, AC-9
  test('the engines.node upper bound closes right above the .nvmrc major', () => {
    const major = Number(readRepoFile('.nvmrc').trim().replace(/^v/, '').split('.')[0]);
    expect(rootManifest.engines?.node).toMatch(new RegExp(`<${String(major + 1)}$`));
  });

  // covers: AC-3
  test('rust-toolchain.toml pins an exact channel with rustfmt and clippy', () => {
    const toolchain = readRustToolchain();
    expect(toolchain.toolchain.channel).toMatch(EXACT_VERSION);
    expect(toolchain.toolchain.components ?? []).toContain('rustfmt');
    expect(toolchain.toolchain.components ?? []).toContain('clippy');
  });

  // covers: AC-3, AC-5
  test('the workspace rust-version matches the pinned toolchain major and minor', () => {
    const [major, minor] = readRustToolchain().toolchain.channel.split('.');
    const cargo = readCargoManifest('Cargo.toml');
    expect(cargo.workspace?.package?.['rust-version']).toBe(`${major ?? ''}.${minor ?? ''}`);
  });

  // covers: AC-4
  test('no lockfile was created next to the root manifest by another tool', () => {
    for (const name of FOREIGN_LOCKFILES) {
      expect(existsSync(join(repoRoot, name))).toBe(false);
    }
  });
});

describe('npm refusal', () => {
  // covers: AC-4
  test('npm install stops with EBADDEVENGINES naming bun and writes no package-lock.json', () => {
    const copy = mkdtempSync(join(tmpdir(), 'foundation-npm-'));
    try {
      for (const manifest of ['package.json', 'apps/web/package.json']) {
        mkdirSync(join(copy, manifest, '..'), { recursive: true });
        cpSync(join(repoRoot, manifest), join(copy, manifest));
      }
      const run = spawnSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], {
        cwd: copy,
        encoding: 'utf8',
      });
      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain('EBADDEVENGINES');
      expect(run.stderr).toContain('"bun"');
      expect(existsSync(join(copy, 'package-lock.json'))).toBe(false);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  }, 60_000);
});
