import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  gitVisibleFiles,
  readAngularWorkspace,
  readCargoManifest,
  readPackageManifest,
  readRepoFile,
  repoRoot,
} from './test-helpers';

const GUARD_PREFIX = 'node ../../scripts/guard-node.mjs && ';
const files = gitVisibleFiles();
const webManifest = readPackageManifest('apps/web/package.json');
const webScripts = webManifest.scripts ?? {};
const angularJson = readAngularWorkspace('apps/web/angular.json');

describe('Cargo workspace', () => {
  const cargo = readCargoManifest('Cargo.toml');
  const api = readCargoManifest('apps/api/Cargo.toml');

  // covers: AC-5
  test('the root manifest is a virtual workspace with resolver 3 and apps/api as member', () => {
    expect(cargo.package).toBeUndefined();
    expect(cargo.workspace?.resolver).toBe('3');
    expect(cargo.workspace?.members).toEqual(['apps/api']);
  });

  // covers: AC-5
  test('shared package fields set version, edition 2024, and rust-version', () => {
    expect(cargo.workspace?.package).toMatchObject({ version: '0.1.0', edition: '2024' });
    expect(cargo.workspace?.package?.['rust-version']).toMatch(/^\d+\.\d+$/);
  });

  // covers: AC-5, AC-7
  test('the api package inherits workspace fields and is never published', () => {
    expect(api.package?.name).toBe('api');
    expect(api.package?.publish).toBe(false);
    for (const field of ['version', 'edition', 'rust-version'] as const) {
      expect(api.package?.[field]).toEqual({ workspace: true });
    }
    expect(api.dependencies?.axum).toEqual({ workspace: true });
    expect(api.dependencies?.tokio).toMatchObject({ workspace: true });
  });

  // covers: AC-5
  test('Tokio stays on the LTS line through a tilde requirement', () => {
    expect(cargo.workspace?.dependencies?.tokio).toMatch(/^~1\.\d+$/);
  });
});

describe('Bun workspace', () => {
  // covers: AC-5
  test('the root declares apps/web as its only workspace', () => {
    expect(readPackageManifest('package.json').workspaces).toEqual(['apps/web']);
  });

  // covers: AC-5
  test('apps/web has no own lockfile, .gitignore, or packageManager field', () => {
    expect(webManifest.packageManager).toBeUndefined();
    const ownFiles = files.filter((file) => file.startsWith('apps/web/'));
    expect(ownFiles).not.toContain('apps/web/.gitignore');
    expect(
      ownFiles.filter((file) =>
        /(^|\/)(bun\.lock|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(file),
      ),
    ).toEqual([]);
  });

  // covers: AC-9
  test.each(Object.entries(webScripts))(
    'web script "%s" runs the Node guard first',
    (_name, command) => {
      expect(command.startsWith(GUARD_PREFIX)).toBe(true);
    },
  );

  // covers: AC-8
  test('the web test script never waits in watch mode', () => {
    expect(webScripts.test).toBe(`${GUARD_PREFIX}ng test --no-watch`);
  });
});

describe('Angular skeleton', () => {
  const buildTarget = angularJson.projects.web?.architect.build;
  const buildOptions = buildTarget?.options ?? {};

  // covers: AC-8
  test('builds a browser only application with no SSR, server, or prerender options', () => {
    expect(buildTarget?.builder).toBe('@angular/build:application');
    for (const key of ['server', 'ssr', 'prerender', 'outputMode']) {
      expect(buildOptions[key]).toBeUndefined();
    }
  });

  // covers: AC-8
  test('is zoneless: no zone.js polyfill, dependency, or zone change detection provider', () => {
    expect(JSON.stringify(buildOptions.polyfills ?? [])).not.toContain('zone.js');
    const allDependencies = { ...webManifest.dependencies, ...webManifest.devDependencies };
    expect(allDependencies['zone.js']).toBeUndefined();
    expect(readRepoFile('apps/web/src/app/app.config.ts')).not.toContain(
      'provideZoneChangeDetection',
    );
    expect(existsSync(join(repoRoot, 'node_modules/zone.js'))).toBe(false);
  });

  // covers: AC-8
  test('bun.lock holds no zone.js package entry', () => {
    expect(readRepoFile('bun.lock')).not.toContain('["zone.js@');
  });

  // covers: AC-8
  test('uses standalone components only (no NgModule in src)', () => {
    const sources = files.filter(
      (file) => file.startsWith('apps/web/src/') && file.endsWith('.ts'),
    );
    expect(sources.length).toBeGreaterThan(0);
    const withModules = sources.filter((file) => readRepoFile(file).includes('NgModule'));
    expect(withModules).toEqual([]);
  });

  // covers: AC-8
  test('turns on TypeScript strict mode explicitly', () => {
    expect(readRepoFile('apps/web/tsconfig.json')).toMatch(/"strict":\s*true/);
  });

  // covers: AC-8
  test('keeps Angular CLI analytics off and bun as its package manager', () => {
    expect(angularJson.cli).toEqual({ packageManager: 'bun', analytics: false });
  });
});
