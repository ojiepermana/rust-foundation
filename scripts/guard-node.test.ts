import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRuntime, lowerBound, parseVersion } from './guard-node.mjs';
import { repoRoot } from './test-helpers';

const guardPath = fileURLToPath(new URL('./guard-node.mjs', import.meta.url));
const NVMRC = '24.21.0\n';
const ENGINES = '>=24.15.0 <25';

function check(versions: Record<string, string>, nvmrc = NVMRC, enginesNode = ENGINES) {
  return checkRuntime({ versions, nvmrc, enginesNode });
}

describe('checkRuntime', () => {
  // covers: AC-9
  test('accepts Node on the pinned major at or above the engines lower bound', () => {
    expect(check({ node: '24.21.0' })).toEqual({ ok: true });
  });

  // covers: AC-9
  test('accepts a Node version exactly at the engines lower bound', () => {
    expect(check({ node: '24.15.0' })).toEqual({ ok: true });
  });

  // covers: AC-9
  test('rejects the Bun runtime and names it, even when it reports a Node version', () => {
    const result = check({ node: '24.21.0', bun: '1.4.3' });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('Bun runtime 1.4.3');
  });

  // covers: AC-9
  test('rejects a Node major that differs from .nvmrc', () => {
    const result = check({ node: '26.11.1' });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('Node.js 26.11.1 found');
    expect(result.reason).toContain('major 24');
  });

  // covers: AC-9
  test('rejects a Node version below the engines lower bound', () => {
    const result = check({ node: '24.14.9' });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('engines.node requires >=24.15.0 <25');
  });

  // covers: AC-9
  test('accepts an .nvmrc written with a v prefix', () => {
    expect(check({ node: '24.21.0' }, 'v24.21.0\n')).toEqual({ ok: true });
  });

  // covers: AC-9
  test('rejects an .nvmrc that holds an alias instead of a version', () => {
    const result = check({ node: '24.21.0' }, 'lts/*\n');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('.nvmrc does not hold a version');
  });

  // covers: AC-9
  test('rejects engines.node without a ">=" lower bound', () => {
    const result = check({ node: '24.21.0' }, NVMRC, '^24.15.0');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('no ">=" lower bound');
  });

  // covers: AC-9
  test('rejects a Node version it cannot read', () => {
    const result = check({ node: 'unknown' });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('cannot read the Node.js version');
  });
});

describe('parseVersion and lowerBound', () => {
  test('parses plain and v prefixed versions and ignores surrounding whitespace', () => {
    expect(parseVersion('24.21.0')).toEqual([24, 21, 0]);
    expect(parseVersion(' v24.21.0\n')).toEqual([24, 21, 0]);
  });

  test('returns null for text without a full major.minor.patch version', () => {
    expect(parseVersion('24')).toBeNull();
    expect(parseVersion('')).toBeNull();
    expect(parseVersion(undefined)).toBeNull();
  });

  test('reads the ">=" bound out of an engines range', () => {
    expect(lowerBound('>=24.15.0 <25')).toEqual([24, 15, 0]);
    expect(lowerBound('>= v22.22.3')).toEqual([22, 22, 3]);
    expect(lowerBound('^24.15.0')).toBeNull();
  });
});

describe('guard as a process', () => {
  // covers: AC-9
  test('exits 0 with no output when run by Node', () => {
    const run = spawnSync('node', [guardPath], { encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(run.stderr).toBe('');
  });

  // covers: AC-9
  test('reads .nvmrc and package.json next to itself, not from the working directory', () => {
    const run = spawnSync('node', [guardPath], { cwd: tmpdir(), encoding: 'utf8' });
    expect(run.status).toBe(0);
  });

  // covers: AC-9
  test('exits 1 with a guard-node message when run by the Bun runtime', () => {
    const run = spawnSync(process.execPath, ['--bun', guardPath], { encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stderr).toStartWith('guard-node: Angular tooling must run on Node.js');
    expect(run.stderr).toContain('Bun runtime');
  });
});

describe('web scripts behind the guard', () => {
  // A PATH that keeps Bun but drops Node, the case where Bun silently swaps runtimes.
  const pathWithoutNode = [dirname(process.execPath), '/usr/bin', '/bin'].join(':');
  const nodeStillVisible =
    spawnSync('sh', ['-c', 'command -v node'], { env: { PATH: pathWithoutNode } }).status === 0;

  function runRoot(args: string[], env: Record<string, string | undefined> = process.env) {
    return spawnSync(process.execPath, args, { cwd: repoRoot, encoding: 'utf8', env });
  }

  // covers: AC-9
  test('bun --bun on the web build stops at the guard with status 1', () => {
    const run = runRoot(['--bun', 'run', '--filter', 'web', 'build']);
    expect(run.status).not.toBe(0);
    expect(`${run.stdout}${run.stderr}`).toContain(
      'guard-node: Angular tooling must run on Node.js',
    );
  });

  // covers: AC-9
  // A top level `bun run` shims `node` with Bun, so the guard reports the Bun runtime.
  // A nested `bun run` (for example inside `bun run test:scripts`) adds no shim, so the
  // shell fails first with "node: command not found". Both stop before Angular starts.
  test.skipIf(nodeStillVisible)(
    'the web build fails before Angular starts when node is missing from PATH',
    () => {
      const run = runRoot(['run', 'build:web'], { ...process.env, PATH: pathWithoutNode });
      const output = `${run.stdout}${run.stderr}`;
      expect(run.status).not.toBe(0);
      expect(output).toMatch(
        /guard-node: Angular tooling must run on Node\.js|node: command not found/,
      );
      expect(output).not.toContain('Building');
    },
  );
});
