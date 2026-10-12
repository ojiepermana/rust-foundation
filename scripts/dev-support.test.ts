import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import {
  apiTarget,
  exitStatus,
  isIgnoredWatchFile,
  LineSplitter,
  parseDevArgs,
  readyLine,
  urlHost,
  validateDevEnv,
} from './dev-support';

// Pure helpers of the dev supervisor (spec 0004); the supervisor itself is proven end to end in
// tests/integration/dev.test.ts.
const defaults = { stateDir: '/repo/.dev', apiDir: '/repo' };

describe('parseDevArgs', () => {
  // covers: 0004 AC-3
  test('uses the defaults without arguments', () => {
    expect(parseDevArgs([], '/work', defaults)).toEqual({
      envFile: undefined,
      stateDir: '/repo/.dev',
      apiDir: '/repo',
    });
  });

  // covers: 0004 AC-3
  test('accepts both the space and the equals form and resolves dirs against the cwd', () => {
    expect(
      parseDevArgs(
        ['--env-file', 'local.env', '--state-dir=tmp/state', '--api-dir', '/abs/ws'],
        '/work',
        defaults,
      ),
    ).toEqual({
      envFile: 'local.env',
      stateDir: resolve('/work', 'tmp/state'),
      apiDir: resolve('/work', '/abs/ws'),
    });
  });

  // covers: 0004 AC-4
  test.each([
    { argv: ['--verbose'], reported: '--verbose' },
    { argv: ['extra'], reported: 'extra' },
    { argv: ['--env-file'], reported: '--env-file' },
    { argv: ['--env-file='], reported: '--env-file=' },
    { argv: ['--state-dir', '--api-dir'], reported: '--state-dir' },
  ])('reports $reported as an unknown option', ({ argv, reported }) => {
    expect(parseDevArgs(argv, '/work', defaults)).toEqual({
      error: `[dev] unknown option: ${reported}`,
    });
  });
});

describe('validateDevEnv', () => {
  const valid = { APP_ENV: 'development', APP_PORT: '3000', WEB_DEV_PORT: '4200' };

  // covers: 0004 AC-3, AC-8
  test('applies the defaults for host, ports, and the PostgreSQL port', () => {
    expect(validateDevEnv({ APP_ENV: 'development' }, 15432)).toEqual({
      apiHost: '127.0.0.1',
      apiPort: 3000,
      webPort: 4200,
      postgresPort: 15432,
    });
  });

  test('treats empty values as unset', () => {
    expect(validateDevEnv({ ...valid, APP_HOST: '', POSTGRES_PORT: '' }, 15432)).toMatchObject({
      apiHost: '127.0.0.1',
      postgresPort: 15432,
    });
  });

  // covers: 0004 AC-4
  test('reports every problem at once with the spec messages', () => {
    expect(
      validateDevEnv(
        {
          APP_ENV: 'production',
          APP_HOST: 'localhost',
          APP_PORT: '0',
          WEB_DEV_PORT: '80',
          POSTGRES_PORT: 'x',
        },
        15432,
      ),
    ).toEqual({
      errors: [
        '[dev] APP_ENV: must be development for bun run dev',
        '[dev] APP_HOST: must be an IPv4 or IPv6 address literal',
        '[dev] APP_PORT: must be an integer from 1 to 65535',
        '[dev] WEB_DEV_PORT: must be an integer from 1024 to 65535',
        '[dev] POSTGRES_PORT: must be an integer from 1024 to 65535',
      ],
    });
  });

  // covers: 0004 AC-4
  test('rejects a web port equal to the api port', () => {
    expect(validateDevEnv({ ...valid, WEB_DEV_PORT: '3000', APP_PORT: '3000' }, 15432)).toEqual({
      errors: ['[dev] WEB_DEV_PORT: must differ from APP_PORT'],
    });
  });

  test.each(['::1', '0.0.0.0', '::', '192.168.1.10'])('accepts the IP literal %s', (host) => {
    expect(validateDevEnv({ ...valid, APP_HOST: host }, 15432)).toMatchObject({ apiHost: host });
  });

  test.each(['[::1]', 'fe80::1%lo0', 'example.com', '127.0.0.1 '])(
    'rejects the host %p',
    (host) => {
      expect(validateDevEnv({ ...valid, APP_HOST: host }, 15432)).toEqual({
        errors: ['[dev] APP_HOST: must be an IPv4 or IPv6 address literal'],
      });
    },
  );

  test.each(['3000.0', '+3000', '0x0bb8', ' 3000', '65536'])('rejects the port %p', (port) => {
    expect(validateDevEnv({ ...valid, APP_PORT: port }, 15432)).toEqual({
      errors: ['[dev] APP_PORT: must be an integer from 1 to 65535'],
    });
  });
});

describe('addresses', () => {
  // covers: 0004 AC-3
  test('brackets IPv6 hosts in URLs', () => {
    expect(urlHost('::1')).toBe('[::1]');
    expect(urlHost('127.0.0.1')).toBe('127.0.0.1');
  });

  // covers: 0004 AC-3
  test.each([
    ['127.0.0.1', 'http://127.0.0.1:3000'],
    ['0.0.0.0', 'http://127.0.0.1:3000'],
    ['::', 'http://127.0.0.1:3000'],
    ['::1', 'http://[::1]:3000'],
    ['10.0.0.5', 'http://10.0.0.5:3000'],
  ])('reaches a backend bound to %s at %s', (host, target) => {
    expect(apiTarget(host, 3000)).toBe(target);
  });

  // covers: 0004 AC-3
  test('prints the ready line with the bound host', () => {
    expect(readyLine({ apiHost: '::1', apiPort: 3001, webPort: 4201, postgresPort: 15432 })).toBe(
      '[dev] ready: web http://127.0.0.1:4201, api http://[::1]:3001',
    );
  });
});

describe('watcher filter', () => {
  // covers: 0004 AC-5
  test.each(['AGENTS.md', 'notes.md', '.#main.rs', 'main.rs~', '.main.rs.swp', '4913'])(
    'ignores %s',
    (name) => {
      expect(isIgnoredWatchFile(name)).toBe(true);
    },
  );

  test.each(['main.rs', 'Cargo.toml', 'mod.rs', 'schema.sql'])('watches %s', (name) => {
    expect(isIgnoredWatchFile(name)).toBe(false);
  });
});

describe('exitStatus', () => {
  // covers: 0004 AC-7
  test('passes exit codes through and maps signals to 128 + n', () => {
    expect(exitStatus(0, null)).toBe(0);
    expect(exitStatus(78, null)).toBe(78);
    expect(exitStatus(null, 'SIGINT')).toBe(130);
    expect(exitStatus(null, 'SIGTERM')).toBe(143);
    expect(exitStatus(null, 'SIGKILL')).toBe(137);
  });
});

describe('LineSplitter', () => {
  // covers: 0004 AC-6
  test('emits whole lines across chunks, drops carriage returns, and flushes the rest', () => {
    const lines: string[] = [];
    const splitter = new LineSplitter((line) => lines.push(line));
    splitter.push('first li');
    splitter.push('ne\r\nsecond\nthi');
    expect(lines).toEqual(['first line', 'second']);
    splitter.push('rd');
    splitter.flush();
    splitter.flush();
    expect(lines).toEqual(['first line', 'second', 'third']);
  });
});
