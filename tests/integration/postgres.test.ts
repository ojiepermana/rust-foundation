// Integration tests of the development PostgreSQL (spec 0003). They need a running Docker
// daemon and use only temporary foundation-test-* projects, never foundation-rust.
// Run: bun test --no-env-file ./tests/integration/postgres.test.ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { connect, createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import {
  createTestEnv,
  selectStaleProjects,
  startPostgres,
  STALE_PROJECT_AGE_MS,
  type TestPostgres,
} from '../../scripts/testing/postgres';

const HOOK_TIMEOUT_MS = 180_000;
const TEST_TIMEOUT_MS = 180_000;
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const signalFixture = fileURLToPath(new URL('./fixtures/postgres-signal.ts', import.meta.url));
const failingSuite = fileURLToPath(
  new URL('./fixtures/postgres-failing-suite.ts', import.meta.url),
);

interface PsEntry {
  Health: string;
  State: string;
  Publishers: { URL: string; TargetPort: number; PublishedPort: number }[] | null;
}

function docker(args: string[]) {
  return spawnSync('docker', args, { cwd: repoRoot, encoding: 'utf8' });
}

function projectResources(project: string): string[] {
  const label = `label=com.docker.compose.project=${project}`;
  return [
    ['ps', '-aq', '--filter', label],
    ['volume', 'ls', '-q', '--filter', label],
    ['network', 'ls', '-q', '--filter', label],
  ].flatMap((args) => docker(args).stdout.split('\n').filter(Boolean));
}

function volumeExists(name: string): boolean {
  return docker(['volume', 'inspect', name]).status === 0;
}

function psEntries(database: TestPostgres): PsEntry[] {
  const result = database.compose(['ps', '--format', 'json', 'postgres']);
  expect(result.status).toBe(0);
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as PsEntry);
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => {
      resolve(false);
    });
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

// Environment for `bun --no-env-file scripts/db.ts` against a temporary project.
function dbEnv(database: TestPostgres, extra: Record<string, string> = {}) {
  return {
    ...createTestEnv().env,
    POSTGRES_ADMIN_PASSWORD: database.passwords.admin,
    POSTGRES_MIGRATOR_PASSWORD: database.passwords.migrator,
    POSTGRES_RUNTIME_PASSWORD: database.passwords.runtime,
    COMPOSE_PROJECT_NAME: database.project,
    ...extra,
  };
}

// stdin is either text piped to the command or closed.
function runDb(args: string[], env: Record<string, string>, stdin: string | null = null) {
  return spawnSync(process.execPath, ['--no-env-file', 'scripts/db.ts', ...args], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    ...(stdin === null ? { stdio: ['ignore', 'pipe', 'pipe'] as const } : { input: stdin }),
  });
}

function started(database: TestPostgres | undefined): TestPostgres {
  if (!database) throw new Error('the temporary postgres project did not start');
  return database;
}

const SYSTEM_IDENTIFIER = 'select system_identifier from pg_control_system()';
const PROBE_SETUP = [
  'create schema probe',
  'create table probe.items (id bigint generated always as identity primary key, name text not null)',
  "insert into probe.items (name) values ('kept')",
].join('; ');

describe('temporary project on tmpfs', () => {
  let database: TestPostgres | undefined;

  beforeAll(async () => {
    database = await startPostgres();
  }, HOOK_TIMEOUT_MS);

  afterAll(() => {
    database?.stop();
  });

  // covers: AC-1
  test('is healthy and publishes the port only on 127.0.0.1', () => {
    const entries = psEntries(started(database));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.Health).toBe('healthy');
    const publishers = entries[0]?.Publishers ?? [];
    expect(publishers.length).toBeGreaterThan(0);
    for (const publisher of publishers) expect(publisher.URL).toBe('127.0.0.1');
  });

  // covers: AC-1
  test('accepts TCP connections on the published host port', async () => {
    expect(await canConnect(started(database).port)).toBe(true);
  });

  // covers: AC-6
  test('reports the published port and one URL per role on it', () => {
    const db = started(database);
    expect(psEntries(db)[0]?.Publishers?.map((publisher) => publisher.PublishedPort)).toEqual([
      db.port,
    ]);
    const base = `@127.0.0.1:${String(db.port)}/foundation?sslmode=disable`;
    expect(db.urls).toEqual({
      admin: `postgres://foundation_admin:${db.passwords.admin}${base}`,
      migrator: `postgres://foundation_migrator:${db.passwords.migrator}${base}`,
      app: `postgres://foundation_app:${db.passwords.runtime}${base}`,
    });
  });

  // covers: AC-1
  test('db:status shows the service as healthy', () => {
    const db = started(database);
    const result = runDb(['status'], dbEnv(db));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('healthy');
  });

  // covers: AC-6
  test('keeps the data directory on tmpfs', () => {
    const result = started(database).compose([
      'exec',
      '-T',
      'postgres',
      'stat',
      '-f',
      '-c',
      '%T',
      '/var/lib/postgresql',
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('tmpfs');
  });

  describe('roles and privileges', () => {
    beforeAll(() => {
      const db = started(database);
      const setup = db.psql(
        'migrator',
        [
          'create schema probe',
          'create table probe.items (id bigint generated always as identity primary key, name text)',
          'create table public.items (id bigint generated always as identity primary key, name text)',
        ].join('; '),
      );
      if (setup.status !== 0) throw new Error(`migrator setup failed: ${setup.stderr}`);
    });

    // covers: AC-5
    test('the migrator owns public and can create schemas and tables in it', () => {
      const result = started(database).psql(
        'migrator',
        "select nspowner::regrole from pg_namespace where nspname = 'public'",
      );
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('foundation_migrator');
    });

    // covers: AC-5
    test.each(['probe.items', 'public.items'])(
      'the app role reads and writes %s, using its sequence',
      (table) => {
        const db = started(database);
        const statements = [
          `insert into ${table} (name) values ('first') returning id`,
          `update ${table} set name = 'second' where id = 1 returning name`,
          `select count(*) from ${table}`,
          `delete from ${table} where id = 1 returning id`,
        ];
        const outputs = statements.map((sql) => db.psql('app', sql));
        for (const output of outputs) expect(output.status).toBe(0);
        expect(outputs.map((output) => output.stdout.trim())).toEqual(['1', 'second', '1', '1']);
      },
    );

    // covers: AC-5
    test.each([
      'create schema app_owned',
      'create table public.app_owned (id int)',
      'create table probe.app_owned (id int)',
      'alter table probe.items add column extra int',
      'drop table probe.items',
      'truncate probe.items',
      'create role app_created',
      'create database app_created',
    ])('the app role is refused with 42501: %s', (sql) => {
      const result = started(database).psql('app', sql);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('42501');
    });

    // covers: AC-5
    test('neither role has superuser, createdb, createrole, replication, or bypassrls', () => {
      const result = started(database).psql(
        'admin',
        [
          'select rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls',
          "from pg_roles where rolname in ('foundation_migrator', 'foundation_app') order by 1",
        ].join(' '),
      );
      expect(result.status).toBe(0);
      expect(result.stdout.trim().split('\n')).toEqual([
        'foundation_app|f|f|f|f|f',
        'foundation_migrator|f|f|f|f|f',
      ]);
    });

    // covers: AC-5
    test('PUBLIC has no privilege on the foundation database', () => {
      const result = started(database).psql(
        'admin',
        [
          'select count(*), count(*) filter (where a.grantee = 0)',
          "from pg_database d, aclexplode(d.datacl) a where d.datname = 'foundation'",
        ].join(' '),
      );
      expect(result.status).toBe(0);
      const [entries, publicEntries] = result.stdout.trim().split('|').map(Number);
      // An empty ACL would mean the default privileges, which include PUBLIC.
      expect(entries).toBeGreaterThan(0);
      expect(publicEntries).toBe(0);
    });

    // covers: AC-5
    test('every pg_hba rule asks for a scram-sha-256 password', () => {
      const result = started(database).psql(
        'admin',
        "select count(*), count(*) filter (where auth_method <> 'scram-sha-256') from pg_hba_file_rules",
      );
      expect(result.status).toBe(0);
      const [rules, other] = result.stdout.trim().split('|').map(Number);
      expect(rules).toBeGreaterThan(0);
      expect(other).toBe(0);
    });

    // covers: AC-5
    test.each(['admin', 'migrator', 'app'] as const)(
      'a wrong password is refused for the %s role over TCP 127.0.0.1',
      (role) => {
        const result = started(database).psql(role, 'select 1', {
          password: 'wrong-password-0123456789',
        });
        expect(result.status).toBe(2);
        expect(result.stderr).toContain('password authentication failed');
      },
    );
  });
});

describe('persistent project', () => {
  let database: TestPostgres | undefined;

  beforeAll(async () => {
    database = await startPostgres({ persistent: true });
  }, HOOK_TIMEOUT_MS);

  afterAll(() => {
    database?.stop();
  });

  // covers: AC-3, AC-1
  test(
    'db:down keeps the volume, and db:up brings back the same cluster and data',
    async () => {
      const db = started(database);
      expect(db.psql('migrator', PROBE_SETUP).status).toBe(0);
      const before = db.psql('admin', SYSTEM_IDENTIFIER).stdout.trim();
      expect(before).toMatch(/^\d+$/);

      const port = await freePort();
      const env = dbEnv(db, { POSTGRES_PORT: String(port) });
      expect(runDb(['down'], env).status).toBe(0);
      expect(volumeExists(`${db.project}_postgres_data`)).toBe(true);
      expect(
        docker(['ps', '-aq', '--filter', `label=com.docker.compose.project=${db.project}`]).stdout,
      ).toBe('');
      expect(
        docker([
          'network',
          'ls',
          '-q',
          '--filter',
          `label=com.docker.compose.project=${db.project}`,
        ]).stdout,
      ).toBe('');

      expect(runDb(['up'], env).status).toBe(0);
      const entries = psEntries(db);
      expect(entries[0]?.Health).toBe('healthy');
      expect(
        entries[0]?.Publishers?.map((publisher) => [publisher.URL, publisher.PublishedPort]),
      ).toEqual([['127.0.0.1', port]]);
      expect(db.psql('admin', SYSTEM_IDENTIFIER).stdout.trim()).toBe(before);
      expect(db.psql('migrator', 'select name from probe.items').stdout.trim()).toBe('kept');
    },
    TEST_TIMEOUT_MS,
  );
});

describe('db:reset on a temporary project', () => {
  let database: TestPostgres | undefined;
  let env: Record<string, string> = {};
  let volume = '';

  beforeAll(async () => {
    database = await startPostgres({ persistent: true });
    env = dbEnv(database, { POSTGRES_PORT: String(await freePort()) });
    volume = `${database.project}_postgres_data`;
    const setup = database.psql('migrator', PROBE_SETUP);
    if (setup.status !== 0) throw new Error(`probe setup failed: ${setup.stderr}`);
  }, HOOK_TIMEOUT_MS);

  afterAll(() => {
    database?.stop();
  });

  function expectCancelledAndKept(result: ReturnType<typeof runDb>) {
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`database: reset cancelled; confirm with --confirm=${volume}`);
    expect(volumeExists(volume)).toBe(true);
    expect(started(database).psql('migrator', 'select name from probe.items').stdout.trim()).toBe(
      'kept',
    );
  }

  // covers: AC-4
  test('refuses without confirmation, even when the volume name is piped to stdin', () => {
    expectCancelledAndKept(runDb(['reset'], env, `${volume}\n`));
  });

  // covers: AC-4
  test('refuses when stdin is closed', () => {
    expectCancelledAndKept(runDb(['reset'], env));
  });

  // covers: AC-4
  test('refuses a confirmation for another volume', () => {
    expectCancelledAndKept(runDb(['reset', '--confirm=foundation-rust_postgres_data'], env));
  });

  // covers: AC-4
  test('refuses --confirm followed by a space and the name', () => {
    expectCancelledAndKept(runDb(['reset', '--confirm', volume], env));
  });

  // covers: AC-4
  test(
    'with --confirm=<volume> deletes the data and starts a new healthy cluster',
    () => {
      const db = started(database);
      const before = db.psql('admin', SYSTEM_IDENTIFIER).stdout.trim();
      const result = runDb(['reset', `--confirm=${volume}`], env);
      expect(result.status).toBe(0);
      expect(psEntries(db)[0]?.Health).toBe('healthy');
      expect(db.psql('migrator', "select to_regclass('probe.items')").stdout.trim()).toBe('');
      const after = db.psql('admin', SYSTEM_IDENTIFIER).stdout.trim();
      expect(after).toMatch(/^\d+$/);
      expect(after).not.toBe(before);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('harness isolation and cleanup', () => {
  // covers: AC-6
  test('creates a foundation-test project with three random passwords and a clean env', () => {
    const saved = { ...process.env };
    Object.assign(process.env, {
      POSTGRES_PORT: '1',
      COMPOSE_FILE: 'other.yaml',
      DATABASE_URL: 'postgres://leak',
      FOUNDATION_LEAK: 'leak',
    });
    try {
      const first = createTestEnv();
      const second = createTestEnv();
      expect(first.project).toMatch(/^foundation-test-[0-9a-f]{16}$/);
      expect(second.project).not.toBe(first.project);
      const passwords = Object.values(first.passwords);
      for (const password of passwords) expect(password).toMatch(/^[0-9a-f]{32}$/);
      expect(new Set(passwords).size).toBe(3);
      const names = Object.keys(first.env);
      expect(
        names.filter((name) => /^(POSTGRES|COMPOSE|DATABASE|FOUNDATION)_/.test(name)).sort(),
      ).toEqual([
        'POSTGRES_ADMIN_PASSWORD',
        'POSTGRES_MIGRATOR_PASSWORD',
        'POSTGRES_RUNTIME_PASSWORD',
      ]);
      expect(first.env.POSTGRES_RUNTIME_PASSWORD).toBe(first.passwords.runtime);
    } finally {
      for (const name of Object.keys(process.env)) {
        if (!(name in saved)) Reflect.deleteProperty(process.env, name);
      }
      Object.assign(process.env, saved);
    }
  });

  // covers: AC-6
  test('treats a project as stale only when every container is older than two hours', () => {
    const now = new Date('2026-10-12T12:00:00Z');
    const old = new Date(now.getTime() - STALE_PROJECT_AGE_MS - 1000);
    const young = new Date(now.getTime() - 60_000);
    const stale = 'foundation-test-0000000000000001';
    const mixed = 'foundation-test-0000000000000002';
    expect(
      selectStaleProjects(
        [
          { project: stale, created: old },
          { project: mixed, created: old },
          { project: mixed, created: young },
          { project: 'foundation-rust', created: old },
          { project: 'foundation', created: old },
          { project: 'foundation-test-other', created: old },
        ],
        now,
      ),
    ).toEqual([stale]);
  });

  // covers: AC-6
  test(
    'stop removes every container, volume, and network, and is idempotent',
    async () => {
      const database = await startPostgres({ persistent: true });
      try {
        expect(projectResources(database.project).length).toBeGreaterThanOrEqual(3);
      } finally {
        database.stop();
      }
      expect(projectResources(database.project)).toEqual([]);
      expect(() => {
        database.stop();
      }).not.toThrow();
    },
    TEST_TIMEOUT_MS,
  );

  // covers: AC-6
  test.each([
    ['SIGTERM', 143],
    ['SIGINT', 130],
  ] as const)(
    'a process that receives %s after starting a project exits %d and leaves nothing behind',
    async (signal, exitCode) => {
      const child = Bun.spawn([process.execPath, '--no-env-file', signalFixture], {
        cwd: repoRoot,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const reader = child.stdout.getReader();
      const decoder = new TextDecoder();
      let output = '';
      while (!/ready (\S+)\n/.test(output)) {
        const chunk = await reader.read();
        if (chunk.done) break;
        output += decoder.decode(chunk.value);
      }
      const project = /ready (\S+)\n/.exec(output)?.[1] ?? '';
      expect(project).toMatch(/^foundation-test-[0-9a-f]{16}$/);
      expect(projectResources(project).length).toBeGreaterThan(0);
      child.kill(signal);
      expect(await child.exited).toBe(exitCode);
      expect(projectResources(project)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  // covers: AC-6
  test(
    'a suite whose test fails still removes its project in afterAll',
    () => {
      const result = spawnSync(process.execPath, ['test', '--no-env-file', failingSuite], {
        cwd: repoRoot,
        env: createTestEnv().env,
        encoding: 'utf8',
      });
      const output = `${result.stdout}${result.stderr}`;
      expect(result.status).toBe(1);
      expect(output).toContain('1 fail');
      const project = /started (foundation-test-[0-9a-f]{16})/.exec(output)?.[1] ?? '';
      expect(project).not.toBe('');
      expect(projectResources(project)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  // covers: AC-1, AC-6
  test(
    'a failed init script never reports healthy and does not print the password',
    () => {
      const { project, env } = createTestEnv();
      env.POSTGRES_MIGRATOR_PASSWORD = 'short-value-x';
      const compose = (args: string[]) =>
        spawnSync(
          'docker',
          [
            'compose',
            ...['-f', 'infrastructure/compose.yaml', '-f', 'infrastructure/compose.test.yaml'],
            ...['-f', 'infrastructure/compose.test-tmpfs.yaml', '--project-name', project],
            ...args,
          ],
          { cwd: repoRoot, env, encoding: 'utf8' },
        );
      try {
        const up = compose(['up', '-d', '--wait', '--wait-timeout', '60']);
        expect(up.status).not.toBe(0);
        const health = compose(['ps', '-a', '--format', '{{.Health}}', 'postgres']).stdout.trim();
        expect(health).not.toBe('healthy');
        const logs = compose(['logs', '--no-color', 'postgres']).stdout;
        expect(logs).toContain('FOUNDATION_MIGRATOR_PASSWORD must be 16 to 128 characters');
        expect(logs).not.toContain('short-value-x');
      } finally {
        compose(['down', '--volumes', '--remove-orphans']);
      }
      expect(projectResources(project)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  // covers: AC-6
  test('fails with a message that names Docker when the daemon is unreachable', () => {
    const result = spawnSync(process.execPath, ['--no-env-file', signalFixture], {
      cwd: repoRoot,
      env: { ...process.env, DOCKER_HOST: 'unix:///nonexistent/docker.sock' },
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Docker');
  });
});

describe('db.ts on a project that is not running', () => {
  function composeDown(project: string, env: Record<string, string>) {
    spawnSync(
      'docker',
      [
        'compose',
        '-f',
        'infrastructure/compose.yaml',
        '--project-name',
        project,
        'down',
        '--volumes',
        '--remove-orphans',
      ],
      { cwd: repoRoot, env, encoding: 'utf8' },
    );
  }

  // covers: AC-4
  test('reset still asks for confirmation when the volume does not exist yet', () => {
    const { project, env } = createTestEnv();
    const result = runDb(['reset'], { ...env, COMPOSE_PROJECT_NAME: project });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `database: reset cancelled; confirm with --confirm=${project}_postgres_data`,
    );
    expect(projectResources(project)).toEqual([]);
  });

  // covers: AC-1
  test(
    'up reports a host port that is already in use and exits non zero',
    async () => {
      const { project, env } = createTestEnv();
      const server = createServer();
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
      });
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      try {
        const result = runDb(['up'], {
          ...env,
          COMPOSE_PROJECT_NAME: project,
          POSTGRES_PORT: String(port),
        });
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(String(port));
        expect(result.stderr).toContain('database: postgres did not become healthy');
      } finally {
        server.close();
        composeDown(project, env);
      }
      expect(projectResources(project)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
});
