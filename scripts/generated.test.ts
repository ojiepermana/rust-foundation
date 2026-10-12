import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  MANIFEST_FILE,
  hashGeneratedRoot,
  readGeneratedRoots,
  verifyGeneratedRoot,
  writeGeneratedManifest,
} from './generated';
import { repoRoot } from './test-helpers';

let workspace = '';
let root = '';

function writeFile(relativePath: string, content: string) {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'foundation-generated-'));
  root = join(workspace, 'packages/api-client');
  writeFile('src/client.ts', 'export const client = 1;\n');
  writeFile('src/models/user.ts', 'export interface User { id: string }\n');
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('writeGeneratedManifest', () => {
  test('records a SHA-256 hash for every file with forward slash paths', () => {
    const manifest = writeGeneratedManifest(root, 'fixture-generator');
    expect(manifest.generator).toBe('fixture-generator');
    expect(Object.keys(manifest.files)).toEqual(['src/client.ts', 'src/models/user.ts']);
    for (const hash of Object.values(manifest.files)) {
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test('never lists the manifest itself', () => {
    writeGeneratedManifest(root, 'fixture-generator');
    expect(Object.keys(hashGeneratedRoot(root))).not.toContain(MANIFEST_FILE);
  });
});

describe('verifyGeneratedRoot', () => {
  test('accepts files exactly as the generator wrote them', () => {
    writeGeneratedManifest(root, 'fixture-generator');
    expect(verifyGeneratedRoot(root)).toEqual([]);
  });

  test('treats a root that does not exist yet as nothing to check', () => {
    expect(verifyGeneratedRoot(join(workspace, 'packages/not-generated-yet'))).toEqual([]);
  });

  test('rejects a root without a manifest', () => {
    expect(verifyGeneratedRoot(root)).toEqual([
      `${root}: ${MANIFEST_FILE} is missing; regenerate the files with their generator`,
    ]);
  });

  test('rejects a file edited by hand after generation', () => {
    writeGeneratedManifest(root, 'fixture-generator');
    writeFile('src/client.ts', 'export const client = 2;\n');
    expect(verifyGeneratedRoot(root)).toEqual([
      `${root}/src/client.ts: edited by hand after generation`,
    ]);
  });

  test('rejects a file added by hand to a generated root', () => {
    writeGeneratedManifest(root, 'fixture-generator');
    writeFile('src/extra.ts', 'export const extra = true;\n');
    expect(verifyGeneratedRoot(root)).toEqual([
      `${root}/src/extra.ts: not written by the generator`,
    ]);
  });

  test('rejects a generated file that was deleted', () => {
    writeGeneratedManifest(root, 'fixture-generator');
    unlinkSync(join(root, 'src/models/user.ts'));
    expect(verifyGeneratedRoot(root)).toEqual([
      `${root}/src/models/user.ts: removed after generation`,
    ]);
  });

  test('reports every problem at once', () => {
    writeGeneratedManifest(root, 'fixture-generator');
    writeFile('src/client.ts', 'changed\n');
    writeFile('src/extra.ts', 'extra\n');
    unlinkSync(join(root, 'src/models/user.ts'));
    expect(verifyGeneratedRoot(root)).toHaveLength(3);
  });
});

describe('symbolic links', () => {
  test('are rejected inside a generated root', () => {
    writeGeneratedManifest(root, 'fixture-generator');
    symlinkSync(join(workspace, 'outside.ts'), join(root, 'src/linked.ts'));
    expect(verifyGeneratedRoot(root)).toEqual([
      `${root}/src/linked.ts: symbolic links are not allowed`,
    ]);
  });

  test('stop a generator from writing a manifest over them', () => {
    symlinkSync(join(workspace, 'outside.ts'), join(root, 'src/linked.ts'));
    expect(() => writeGeneratedManifest(root, 'fixture-generator')).toThrow(
      'symbolic links are not allowed in a generated root',
    );
  });
});

describe('check-generated command', () => {
  const command = join(repoRoot, 'scripts/check-generated.ts');

  function runCheck() {
    writeFileSync(
      join(workspace, 'generated-roots.json'),
      JSON.stringify({ roots: ['packages/api-client'] }),
    );
    return spawnSync(process.execPath, [command, workspace], { encoding: 'utf8' });
  }

  test('exits 0 when every generated root matches its manifest', () => {
    writeGeneratedManifest(root, 'fixture-generator');
    const run = runCheck();
    expect(run.status).toBe(0);
    expect(run.stderr).toBe('');
  });

  test('exits 1 and names each file edited by hand', () => {
    writeGeneratedManifest(root, 'fixture-generator');
    writeFile('src/client.ts', 'export const client = 3;\n');
    const run = runCheck();
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('check-generated: generated files must not be edited by hand');
    expect(run.stderr).toContain(
      'packages/api-client/src/client.ts: edited by hand after generation',
    );
  });
});

describe('readGeneratedRoots', () => {
  test('reads the declared roots of this repo', () => {
    expect(readGeneratedRoots(repoRoot)).toEqual(['packages/api-client']);
  });
});
