// Fast tests of the development database tooling (spec 0003). They need the docker CLI with
// the Compose plugin but no daemon: DOCKER_HOST points at a socket that does not exist.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import {
  buildComposeArgs,
  composeEnv,
  confirmationAccepted,
  PASSWORD_PLACEHOLDER,
  validateInfraEnv,
  volumeNameFromConfig,
} from './db';
import { loadEnvFile } from './env-file';
import { DEFAULT_POSTGRES_PORT } from './postgres-env';
import { readRepoFile, repoRoot } from './test-helpers';

const NO_DAEMON = 'unix:///nonexistent/docker.sock';

// Portability (spec 0004): Windows has no bash, no `script`, and no unix socket DOCKER_HOST, and a
// machine without the docker CLI (for example GitHub macOS runners) cannot run `compose config`.
// Those checks skip there and still run on Linux CI, where the docker CLI is always present.
const IS_WINDOWS = process.platform === 'win32';
const HAS_COMPOSE_CLI =
  spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0;
const SKIP_DOCKER_CLI = IS_WINDOWS || !HAS_COMPOSE_CLI;
const ADMIN = 'admin.password-0001';
const MIGRATOR = 'migrator_password~02';
const RUNTIME = 'RuntimePassword0003';
const VALID = {
  POSTGRES_ADMIN_PASSWORD: ADMIN,
  POSTGRES_MIGRATOR_PASSWORD: MIGRATOR,
  POSTGRES_RUNTIME_PASSWORD: RUNTIME,
};
const PASSWORD_RULE = 'must be 16 to 128 characters from A-Z, a-z, 0-9, ".", "_", "~", "-"';
const PORT_RULE = 'must be an integer from 1024 to 65535';
const BASE = 'infrastructure/compose.yaml';
const TEST_PORTS = 'infrastructure/compose.test.yaml';
const TEST_TMPFS = 'infrastructure/compose.test-tmpfs.yaml';
const INIT_SCRIPT = 'infrastructure/postgres/initdb/10-roles.sh';

const INFRA_BLOCK = `# --- Development infrastructure (spec 0003) ---
# Host port of the development PostgreSQL. optional, default 15432, not secret.
POSTGRES_PORT=15432
# Password of the superuser foundation_admin, used only for initialisation. required, default none, secret.
POSTGRES_ADMIN_PASSWORD=
# Password of the migrator role foundation_migrator. required, default none, secret.
POSTGRES_MIGRATOR_PASSWORD=
# Password of the runtime role foundation_app. required, default none, secret.
POSTGRES_RUNTIME_PASSWORD=
# Passwords use 16 to 128 characters from A-Z a-z 0-9 . _ ~ - and must all differ, for example: openssl rand -hex 24
# Matching backend URLs:
# DATABASE_URL=postgres://foundation_app:<POSTGRES_RUNTIME_PASSWORD>@127.0.0.1:15432/foundation?sslmode=disable
# DATABASE_MIGRATOR_URL=postgres://foundation_migrator:<POSTGRES_MIGRATOR_PASSWORD>@127.0.0.1:15432/foundation?sslmode=disable
`;

// The SQL block of spec 0003 ("Script init"), in order. The two SET lines keep the password
// literals that psql interpolates out of the server log, even when a statement fails.
const INIT_SQL = `SET log_min_error_statement = 'panic';
SET log_statement = 'none';
\\getenv migrator_password FOUNDATION_MIGRATOR_PASSWORD
\\getenv runtime_password FOUNDATION_RUNTIME_PASSWORD
CREATE ROLE foundation_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'migrator_password';
CREATE ROLE foundation_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'runtime_password';
REVOKE ALL ON DATABASE foundation FROM PUBLIC;
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
GRANT CONNECT, CREATE, TEMPORARY ON DATABASE foundation TO foundation_migrator;
GRANT CONNECT ON DATABASE foundation TO foundation_app;
ALTER SCHEMA public OWNER TO foundation_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO foundation_app;
ALTER DEFAULT PRIVILEGES FOR ROLE foundation_migrator GRANT USAGE ON SCHEMAS TO foundation_app;
ALTER DEFAULT PRIVILEGES FOR ROLE foundation_migrator GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO foundation_app;
ALTER DEFAULT PRIVILEGES FOR ROLE foundation_migrator GRANT USAGE, SELECT ON SEQUENCES TO foundation_app;
`;

interface ComposeConfig {
  name: string;
  services: Record<
    string,
    {
      image: string;
      environment: Record<string, string>;
      ports?: {
        mode?: string;
        host_ip?: string;
        published?: string;
        target: number;
        protocol?: string;
      }[];
      volumes?: {
        type: string;
        source?: string;
        target: string;
        read_only?: boolean;
      }[];
      tmpfs?: string[];
      healthcheck: {
        test: string[];
        interval: string;
        timeout: string;
        retries: number;
        start_period: string;
        start_interval: string;
      };
      stop_grace_period: string;
    }
  >;
  volumes?: Record<string, { name: string }>;
}

// The process environment without any variable a developer's shell or .env could add.
function cleanEnv(extra: Record<string, string | undefined> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries({ ...process.env, ...extra })) {
    if (value === undefined) continue;
    if (/^(POSTGRES|COMPOSE|DATABASE|FOUNDATION)_/.test(name) && !(name in extra)) continue;
    env[name] = value;
  }
  return env;
}

function composeConfig(files: string[], extra: Record<string, string | undefined> = {}) {
  return spawnSync(
    'docker',
    ['compose', ...files.flatMap((file) => ['-f', file]), 'config', '--format', 'json'],
    {
      cwd: repoRoot,
      env: cleanEnv({ DOCKER_HOST: NO_DAEMON, ...VALID, ...extra }),
      encoding: 'utf8',
    },
  );
}

function parsedConfig(files: string[], extra: Record<string, string | undefined> = {}) {
  const result = composeConfig(files, extra);
  if (result.status !== 0) throw new Error(`docker compose config failed: ${result.stderr}`);
  return { config: JSON.parse(result.stdout) as ComposeConfig, stdout: result.stdout };
}

function postgresService(config: ComposeConfig) {
  const service = config.services.postgres;
  if (!service) throw new Error('service postgres is missing');
  return service;
}

function runDb(args: string[], env: Record<string, string>) {
  return spawnSync(process.execPath, ['--no-env-file', 'scripts/db.ts', ...args], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('validateInfraEnv', () => {
  // covers: AC-2
  test('accepts three valid, different passwords and defaults the port', () => {
    expect(validateInfraEnv(VALID)).toEqual({ ok: true, port: DEFAULT_POSTGRES_PORT });
    expect(validateInfraEnv({ ...VALID, POSTGRES_PORT: '' })).toEqual({
      ok: true,
      port: DEFAULT_POSTGRES_PORT,
    });
  });

  // covers: AC-2
  test.each(['1024', '15432', '65535'])('accepts POSTGRES_PORT=%s', (port) => {
    expect(validateInfraEnv({ ...VALID, POSTGRES_PORT: port })).toEqual({
      ok: true,
      port: Number(port),
    });
  });

  // covers: AC-2
  test.each(['1023', '65536', '0', '-1', 'abc', '1e4', ' 15432', '15432 ', '15432.0', '0x3c28'])(
    'rejects POSTGRES_PORT=%p',
    (port) => {
      expect(validateInfraEnv({ ...VALID, POSTGRES_PORT: port })).toEqual({
        ok: false,
        errors: [`POSTGRES_PORT: ${PORT_RULE}`],
      });
    },
  );

  // covers: AC-2
  test.each([
    ['16 allowed characters', 'abcdefghijklmnop'],
    ['128 characters', 'a'.repeat(128)],
    ['every allowed symbol', 'AZaz09._~-AZaz09'],
  ])('accepts a password with %s', (_label, password) => {
    expect(validateInfraEnv({ ...VALID, POSTGRES_ADMIN_PASSWORD: password }).ok).toBe(true);
  });

  // covers: AC-2
  test.each([
    ['15 characters', 'a'.repeat(15)],
    ['129 characters', 'a'.repeat(129)],
    ['a space', 'abcdefgh ijklmnop'],
    ['a dollar sign', 'abcdefgh$ijklmnop'],
    ['an at sign', 'abcdefgh@ijklmnop'],
    ['a colon', 'abcdefgh:ijklmnop'],
    ['a non ASCII letter', 'abcdefghéijklmnop'],
    ['a trailing newline', 'abcdefghijklmnop\n'],
  ])('rejects a password with %s', (_label, password) => {
    expect(validateInfraEnv({ ...VALID, POSTGRES_MIGRATOR_PASSWORD: password })).toEqual({
      ok: false,
      errors: [`POSTGRES_MIGRATOR_PASSWORD: ${PASSWORD_RULE}`],
    });
  });

  // covers: AC-2
  test('reports a missing or empty password as required', () => {
    expect(validateInfraEnv({ POSTGRES_ADMIN_PASSWORD: '' })).toEqual({
      ok: false,
      errors: [
        'POSTGRES_ADMIN_PASSWORD: is required',
        'POSTGRES_MIGRATOR_PASSWORD: is required',
        'POSTGRES_RUNTIME_PASSWORD: is required',
      ],
    });
  });

  // covers: AC-2
  test.each([
    [
      'migrator equal to admin',
      { POSTGRES_MIGRATOR_PASSWORD: ADMIN },
      ['POSTGRES_MIGRATOR_PASSWORD: must differ from POSTGRES_ADMIN_PASSWORD'],
    ],
    [
      'runtime equal to admin',
      { POSTGRES_RUNTIME_PASSWORD: ADMIN },
      ['POSTGRES_RUNTIME_PASSWORD: must differ from POSTGRES_ADMIN_PASSWORD'],
    ],
    [
      'runtime equal to migrator',
      { POSTGRES_RUNTIME_PASSWORD: MIGRATOR },
      ['POSTGRES_RUNTIME_PASSWORD: must differ from POSTGRES_MIGRATOR_PASSWORD'],
    ],
    [
      'all three equal (the first equal name is reported)',
      { POSTGRES_MIGRATOR_PASSWORD: ADMIN, POSTGRES_RUNTIME_PASSWORD: ADMIN },
      [
        'POSTGRES_MIGRATOR_PASSWORD: must differ from POSTGRES_ADMIN_PASSWORD',
        'POSTGRES_RUNTIME_PASSWORD: must differ from POSTGRES_ADMIN_PASSWORD',
      ],
    ],
  ])('rejects %s', (_label, change, errors) => {
    expect(validateInfraEnv({ ...VALID, ...change })).toEqual({ ok: false, errors });
  });

  // covers: AC-2
  test('reports one line per variable in table order, the rule before equality', () => {
    expect(
      validateInfraEnv({
        POSTGRES_RUNTIME_PASSWORD: 'short',
        POSTGRES_MIGRATOR_PASSWORD: 'short',
        POSTGRES_PORT: '80',
      }),
    ).toEqual({
      ok: false,
      errors: [
        `POSTGRES_PORT: ${PORT_RULE}`,
        'POSTGRES_ADMIN_PASSWORD: is required',
        `POSTGRES_MIGRATOR_PASSWORD: ${PASSWORD_RULE}`,
        `POSTGRES_RUNTIME_PASSWORD: ${PASSWORD_RULE}`,
      ],
    });
  });
});

describe('confirmationAccepted', () => {
  const volume = 'foundation-rust_postgres_data';

  // covers: AC-4
  test('accepts only the exact volume name', () => {
    expect(confirmationAccepted(volume, volume)).toBe(true);
  });

  // covers: AC-4
  test.each([
    ['nothing', undefined],
    ['null', null],
    ['an empty answer', ''],
    ['yes', 'yes'],
    ['another case', 'Foundation-Rust_Postgres_Data'],
    ['surrounding spaces', ` ${volume} `],
    ['a trailing newline', `${volume}\n`],
    ['a prefix', 'foundation-rust'],
  ])('rejects %s', (_label, answer) => {
    expect(confirmationAccepted(volume, answer)).toBe(false);
  });

  // covers: AC-4
  test('never accepts when the expected name is empty', () => {
    expect(confirmationAccepted('', '')).toBe(false);
  });
});

describe('buildComposeArgs', () => {
  // covers: AC-1, AC-3, AC-4
  test.each([
    ['up', {}, ['compose', '-f', BASE, 'up', '-d', '--wait', '--wait-timeout', '120', 'postgres']],
    ['down', {}, ['compose', '-f', BASE, 'down']],
    ['down', { removeVolumes: true }, ['compose', '-f', BASE, 'down', '--volumes']],
    ['status', {}, ['compose', '-f', BASE, 'ps', 'postgres']],
    ['config', {}, ['compose', '-f', BASE, 'config', '--format', 'json']],
  ] as const)('%s %o', (command, options, expected) => {
    expect(buildComposeArgs(command, options)).toEqual([...expected]);
  });
});

describe('composeEnv', () => {
  // covers: AC-3
  test.each(['down', 'status'] as const)(
    '%s fills empty passwords with the non secret placeholder',
    (subcommand) => {
      const env = composeEnv(subcommand, {
        POSTGRES_ADMIN_PASSWORD: '',
        POSTGRES_MIGRATOR_PASSWORD: MIGRATOR,
        OTHER: 'kept',
        UNSET: undefined,
      });
      expect(env).toEqual({
        POSTGRES_ADMIN_PASSWORD: PASSWORD_PLACEHOLDER,
        POSTGRES_MIGRATOR_PASSWORD: MIGRATOR,
        POSTGRES_RUNTIME_PASSWORD: PASSWORD_PLACEHOLDER,
        OTHER: 'kept',
      });
    },
  );

  // covers: AC-2
  test.each(['up', 'reset'] as const)('%s never adds a placeholder', (subcommand) => {
    expect(composeEnv(subcommand, { POSTGRES_ADMIN_PASSWORD: '' })).toEqual({
      POSTGRES_ADMIN_PASSWORD: '',
    });
  });
});

describe.skipIf(SKIP_DOCKER_CLI)('Compose file (docker compose config, no daemon)', () => {
  // covers: AC-1
  test('defines project foundation-rust with only the postgres service on the pinned image', () => {
    const { config } = parsedConfig([BASE]);
    expect(config.name).toBe('foundation-rust');
    expect(Object.keys(config.services)).toEqual(['postgres']);
    expect(postgresService(config).image).toBe('postgres:18.6-trixie');
  });

  // covers: AC-1
  test('publishes DEFAULT_POSTGRES_PORT on 127.0.0.1 only by default', () => {
    expect(postgresService(parsedConfig([BASE]).config).ports).toEqual([
      {
        mode: 'ingress',
        host_ip: '127.0.0.1',
        target: 5432,
        published: String(DEFAULT_POSTGRES_PORT),
        protocol: 'tcp',
      },
    ]);
  });

  // covers: AC-1
  test('an empty POSTGRES_PORT falls back to the default host port', () => {
    const ports = postgresService(parsedConfig([BASE], { POSTGRES_PORT: '' }).config).ports;
    expect(ports?.map((port) => port.published)).toEqual([String(DEFAULT_POSTGRES_PORT)]);
  });

  // covers: AC-1
  test('POSTGRES_PORT changes the host port, still on 127.0.0.1', () => {
    const ports = postgresService(parsedConfig([BASE], { POSTGRES_PORT: '25432' }).config).ports;
    expect(ports?.map((port) => [port.host_ip, port.published, port.target])).toEqual([
      ['127.0.0.1', '25432', 5432],
    ]);
  });

  // covers: AC-3, AC-4
  test('the data volume is foundation-rust_postgres_data, renamed by COMPOSE_PROJECT_NAME', () => {
    expect(volumeNameFromConfig(parsedConfig([BASE]).stdout)).toBe('foundation-rust_postgres_data');
    expect(
      volumeNameFromConfig(
        parsedConfig([BASE], { COMPOSE_PROJECT_NAME: 'foundation-test-0123456789abcdef' }).stdout,
      ),
    ).toBe('foundation-test-0123456789abcdef_postgres_data');
    const volumes = postgresService(parsedConfig([BASE]).config).volumes;
    expect(
      volumes?.map((volume) => [volume.type, volume.source, volume.target, volume.read_only]),
    ).toEqual([
      ['volume', 'postgres_data', '/var/lib/postgresql', undefined],
      [
        'bind',
        join(repoRoot, 'infrastructure/postgres/initdb'),
        '/docker-entrypoint-initdb.d',
        true,
      ],
    ]);
  });

  // covers: AC-1, AC-5
  test('sets the admin, database, role passwords, and scram-sha-256 for every connection', () => {
    expect(postgresService(parsedConfig([BASE]).config).environment).toEqual({
      POSTGRES_USER: 'foundation_admin',
      POSTGRES_DB: 'foundation',
      POSTGRES_PASSWORD: ADMIN,
      FOUNDATION_MIGRATOR_PASSWORD: MIGRATOR,
      FOUNDATION_RUNTIME_PASSWORD: RUNTIME,
      POSTGRES_INITDB_ARGS: '--auth-local=scram-sha-256 --auth-host=scram-sha-256',
    });
  });

  // covers: AC-1
  test('is healthy only after a TCP pg_isready and the init sentinel file', () => {
    const service = postgresService(parsedConfig([BASE]).config);
    expect(service.healthcheck).toMatchObject({
      interval: '2s',
      timeout: '3s',
      retries: 30,
      start_period: '10s',
      start_interval: '1s',
    });
    expect(service.healthcheck.test[0]).toBe('CMD-SHELL');
    expect(service.healthcheck.test[1]).toContain(
      'pg_isready -h 127.0.0.1 -p 5432 -U foundation_admin -d foundation',
    );
    // $$ in the file keeps Compose from interpolating PGDATA from the host environment.
    expect(readRepoFile(BASE)).toContain('test -f "$$PGDATA/foundation-init.done"');
    expect(service.stop_grace_period).toBe('30s');
  });

  // covers: AC-1
  test.each(['POSTGRES_ADMIN_PASSWORD', 'POSTGRES_MIGRATOR_PASSWORD', 'POSTGRES_RUNTIME_PASSWORD'])(
    'fails and names %s when it is empty',
    (name) => {
      const result = composeConfig([BASE], { [name]: '' });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`set ${name} in .env`);
    },
  );

  // covers: AC-6
  test('the test override lets Docker pick an ephemeral port on 127.0.0.1', () => {
    const service = postgresService(parsedConfig([BASE, TEST_PORTS]).config);
    expect(service.ports?.map((port) => [port.host_ip, port.published ?? '', port.target])).toEqual(
      [['127.0.0.1', '', 5432]],
    );
    expect(service.volumes?.map((volume) => volume.target)).toEqual([
      '/var/lib/postgresql',
      '/docker-entrypoint-initdb.d',
    ]);
  });

  // covers: AC-6
  test('the tmpfs override keeps only the init mount and puts the data on tmpfs', () => {
    const { config } = parsedConfig([BASE, TEST_PORTS, TEST_TMPFS]);
    const service = postgresService(config);
    expect(service.tmpfs).toEqual(['/var/lib/postgresql']);
    expect(
      service.volumes?.map((volume) => [
        volume.type,
        volume.source,
        volume.target,
        volume.read_only,
      ]),
    ).toEqual([
      [
        'bind',
        join(repoRoot, 'infrastructure/postgres/initdb'),
        '/docker-entrypoint-initdb.d',
        true,
      ],
    ]);
    expect(config.volumes).toBeUndefined();
  });
});

describe('init script', () => {
  // covers: AC-5
  test('is committed as executable with LF line endings', () => {
    const staged = spawnSync('git', ['ls-files', '-s', INIT_SCRIPT], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(staged.stdout).toStartWith('100755 ');
    expect(readRepoFile('.gitattributes').split('\n')).toContain('*.sh text eol=lf');
    const attribute = spawnSync('git', ['check-attr', 'eol', '--', INIT_SCRIPT], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(attribute.stdout.trim()).toBe(`${INIT_SCRIPT}: eol: lf`);
    expect(readRepoFile(INIT_SCRIPT)).not.toContain('\r');
  });

  // covers: AC-5
  test('reads passwords with \\getenv and never puts them in SQL text', () => {
    const script = readRepoFile(INIT_SCRIPT);
    expect(script).toStartWith('#!/usr/bin/env bash\n');
    expect(script).toContain('set -euo pipefail');
    expect(script).toContain('\\getenv migrator_password FOUNDATION_MIGRATOR_PASSWORD');
    expect(script).toContain('\\getenv runtime_password FOUNDATION_RUNTIME_PASSWORD');
    expect(script).toContain("<<'SQL'");
    expect(script).not.toMatch(/PASSWORD\s+'/);
    expect(script.trimEnd().split('\n').at(-1)).toBe('touch "$PGDATA/foundation-init.done"');
  });

  // covers: AC-5
  test('runs exactly the SQL of spec 0003, logging switched off before any password', () => {
    const script = readRepoFile(INIT_SCRIPT);
    const start = script.indexOf("<<'SQL'\n") + "<<'SQL'\n".length;
    const body = script.slice(start, script.indexOf('\nSQL\n', start) + 1);
    expect(body).toBe(INIT_SQL);
    expect(
      script.indexOf('psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname foundation'),
    ).toBeGreaterThan(0);
  });

  // covers: AC-5
  test.skipIf(IS_WINDOWS).each([
    ['FOUNDATION_MIGRATOR_PASSWORD', { FOUNDATION_MIGRATOR_PASSWORD: 'tiny9z' }],
    ['FOUNDATION_RUNTIME_PASSWORD', { FOUNDATION_MIGRATOR_PASSWORD: MIGRATOR }],
  ])('refuses to run when %s breaks the rule, without printing it', (name, values) => {
    const result = spawnSync('bash', [INIT_SCRIPT], {
      cwd: repoRoot,
      env: { PATH: '/usr/bin:/bin', ...values },
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(name);
    expect(result.stderr).not.toContain('tiny9z');
    expect(result.stderr).not.toContain(MIGRATOR);
  });
});

describe('.env.example', () => {
  const content = readRepoFile('.env.example');

  // covers: AC-7
  test('holds the infrastructure section exactly, right after the backend section', () => {
    const start = content.indexOf(INFRA_BLOCK);
    expect(start).toBeGreaterThanOrEqual(0);
    const before = content.slice(0, start);
    expect(before.split('\n').filter((line) => line.startsWith('# --- '))).toEqual([]);
  });

  // covers: AC-7
  test('has no password value', () => {
    const passwords = content
      .split('\n')
      .filter((line) => /^POSTGRES_\w*PASSWORD=/.test(line))
      .map((line) => line.slice(line.indexOf('=') + 1));
    expect(passwords).toEqual(['', '', '']);
  });
});

describe('db.ts command line (no daemon)', () => {
  const noDocker = { PATH: '/nonexistent' };

  // covers: AC-4
  test.each([[[]], [['--help']]])('prints the help for %p, marking reset DESTRUCTIVE', (args) => {
    const result = runDb(args, cleanEnv());
    expect(result.status).toBe(0);
    for (const command of ['up', 'down', 'status']) {
      expect(result.stdout).toMatch(new RegExp(`^  ${command} `, 'm'));
    }
    expect(result.stdout).toMatch(/^ {2}reset +DESTRUCTIVE\b/m);
  });

  // covers: AC-2
  test.each(['up', 'reset'])(
    '%s stops with status 1 before checking Docker when the variables are invalid',
    (subcommand) => {
      const result = runDb([subcommand], {
        ...noDocker,
        POSTGRES_PORT: '80',
        POSTGRES_ADMIN_PASSWORD: 'secret-tiny',
        POSTGRES_MIGRATOR_PASSWORD: MIGRATOR,
        POSTGRES_RUNTIME_PASSWORD: MIGRATOR,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toBe(
        [
          'database configuration error:',
          `  POSTGRES_PORT: ${PORT_RULE}`,
          `  POSTGRES_ADMIN_PASSWORD: ${PASSWORD_RULE}`,
          '  POSTGRES_RUNTIME_PASSWORD: must differ from POSTGRES_MIGRATOR_PASSWORD',
          '',
        ].join('\n'),
      );
      expect(`${result.stdout}${result.stderr}`).not.toContain('secret-tiny');
      expect(`${result.stdout}${result.stderr}`).not.toContain(MIGRATOR);
    },
  );

  // covers: AC-1
  test.skipIf(IS_WINDOWS).each(['up', 'down', 'status', 'reset'])(
    '%s reports a missing docker command with status 1',
    (subcommand) => {
      const result = runDb([subcommand], { ...noDocker, ...VALID });
      expect(result.status).toBe(1);
      expect(result.stderr).toBe(
        'database: docker command not found; install Docker and try again\n',
      );
    },
  );

  // covers: AC-1
  test.skipIf(SKIP_DOCKER_CLI).each(['up', 'down', 'status', 'reset'])(
    '%s reports a stopped Docker daemon with status 1',
    (subcommand) => {
      const result = runDb([subcommand], cleanEnv({ DOCKER_HOST: NO_DAEMON, ...VALID }));
      expect(result.status).toBe(1);
      expect(result.stderr).toBe('database: Docker is not running; start Docker and try again\n');
    },
  );

  test('rejects an unknown command with status 1', () => {
    const result = runDb(['drop'], cleanEnv());
    expect(result.status).toBe(1);
    expect(result.stderr).toStartWith('database: unknown command "drop"');
  });
});

describe('loadEnvFile', () => {
  const names = ['ENV_FILE_TEST_A', 'ENV_FILE_TEST_B', 'ENV_FILE_TEST_C', 'ENV_FILE_TEST_D'];
  const folders: string[] = [];

  function tempFolder(): string {
    const folder = realpathSync(mkdtempSync(join(tmpdir(), 'foundation-env-file-')));
    folders.push(folder);
    return folder;
  }

  afterEach(() => {
    for (const name of names) Reflect.deleteProperty(process.env, name);
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });

  // covers: AC-1
  test('parses quotes, export, and comments without expanding $VAR, relative to the cwd', () => {
    const file = join(tempFolder(), 'local.env');
    writeFileSync(
      file,
      [
        '# comment',
        'export ENV_FILE_TEST_A=plain',
        'ENV_FILE_TEST_B="two words" # trailing comment',
        "ENV_FILE_TEST_C='$ENV_FILE_TEST_A'",
      ].join('\n'),
    );
    const path = relative(process.cwd(), file);
    expect(loadEnvFile({ path })).toEqual({ loaded: true, path: file });
    expect(process.env.ENV_FILE_TEST_A).toBe('plain');
    expect(process.env.ENV_FILE_TEST_B).toBe('two words');
    expect(process.env.ENV_FILE_TEST_C).toBe('$ENV_FILE_TEST_A');
  });

  // covers: AC-1
  test('keeps a non empty process value and fills an empty one from the file', () => {
    const file = join(tempFolder(), 'local.env');
    writeFileSync(file, 'ENV_FILE_TEST_A=from-file\nENV_FILE_TEST_B=from-file\n');
    process.env.ENV_FILE_TEST_A = 'from-shell';
    process.env.ENV_FILE_TEST_B = '';
    loadEnvFile({ path: file });
    expect(process.env.ENV_FILE_TEST_A).toBe('from-shell');
    expect(process.env.ENV_FILE_TEST_B).toBe('from-file');
  });

  // covers: AC-1
  test('throws with the path when an explicit or required file is missing', () => {
    const missing = join(tempFolder(), 'missing.env');
    expect(() => loadEnvFile({ path: missing })).toThrow(`env file not found: ${missing}`);
    expect(() => loadEnvFile({ path: missing, required: true })).toThrow(missing);
  });

  // covers: AC-1
  test('defaults to .env beside the scripts folder, wherever it runs from', () => {
    const root = tempFolder();
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'elsewhere'));
    cpSync(join(repoRoot, 'scripts/env-file.ts'), join(root, 'scripts/env-file.ts'));
    const load = (options: string) =>
      spawnSync(
        process.execPath,
        [
          '--no-env-file',
          '-e',
          `import { loadEnvFile } from ${JSON.stringify(join(root, 'scripts/env-file.ts'))};
           try { console.log(JSON.stringify({ result: loadEnvFile(${options}), value: process.env.ENV_FILE_TEST_D ?? null })); }
           catch (error) { console.log(JSON.stringify({ error: String(error) })); }`,
        ],
        { cwd: join(root, 'elsewhere'), env: cleanEnv(), encoding: 'utf8' },
      );
    const expectedPath = join(root, '.env');
    expect(JSON.parse(load('').stdout)).toEqual({
      result: { loaded: false, path: expectedPath },
      value: null,
    });
    expect(JSON.parse(load('{ required: true }').stdout)).toEqual({
      error: `Error: env file not found: ${expectedPath}`,
    });
    writeFileSync(expectedPath, 'ENV_FILE_TEST_D=default-file\n');
    expect(JSON.parse(load('').stdout)).toEqual({
      result: { loaded: true, path: expectedPath },
      value: 'default-file',
    });
  });

  // covers: AC-1
  test('reports a file it cannot read with the path, not only a missing one', () => {
    const folder = tempFolder();
    expect(() => loadEnvFile({ path: folder })).toThrow(`cannot read env file ${folder}:`);
  });
});

// A stand in for the docker command at the process boundary. It records every call and the
// environment Compose would see, and answers from FAKE_DOCKER_* variables. Values are dummies.
const FAKE_DOCKER = `#!/bin/bash
printf 'ARGS %s\\n' "$*" >> "$FAKE_DOCKER_LOG"
if [ "$1" = info ]; then printf '%s\\n' "\${FAKE_DOCKER_INFO_VERSION-29.0.0}"; exit "\${FAKE_DOCKER_INFO_STATUS:-0}"; fi
printf 'ENV admin=%s migrator=%s runtime=%s port=%s cwd=%s\\n' \\
  "\${POSTGRES_ADMIN_PASSWORD-<unset>}" "\${POSTGRES_MIGRATOR_PASSWORD-<unset>}" \\
  "\${POSTGRES_RUNTIME_PASSWORD-<unset>}" "\${POSTGRES_PORT-<unset>}" "$(pwd -P)" >> "$FAKE_DOCKER_LOG"
case " $* " in
  *" config "*) printf '%s' "$FAKE_DOCKER_CONFIG"; exit "\${FAKE_DOCKER_CONFIG_STATUS:-0}" ;;
  *" down "*) exit "\${FAKE_DOCKER_DOWN_STATUS:-0}" ;;
  *" up "*)
    if [ -n "\${FAKE_DOCKER_UP_SIGNAL-}" ]; then kill -s "$FAKE_DOCKER_UP_SIGNAL" $$; fi
    exit "\${FAKE_DOCKER_UP_STATUS:-0}" ;;
  *" ps "*) exit "\${FAKE_DOCKER_PS_STATUS:-0}" ;;
esac
exit 99
`;

describe.skipIf(IS_WINDOWS)('db.ts against a fake docker command', () => {
  const FAKE_VOLUME = 'fake-project_postgres_data';
  const COMPOSE = 'compose -f infrastructure/compose.yaml';
  const UP = `ARGS ${COMPOSE} up -d --wait --wait-timeout 120 postgres`;
  const HINT =
    'database: postgres did not become healthy; if this was its first start, run "bun run db:reset"';
  let root = '';
  let log = '';

  // A copy of the three scripts, so the default .env is <root>/.env and never the developer's.
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'foundation-fake-docker-')));
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'bin'));
    for (const file of ['db.ts', 'env-file.ts', 'postgres-env.ts']) {
      cpSync(join(repoRoot, 'scripts', file), join(root, 'scripts', file));
    }
    writeFileSync(join(root, 'bin/docker'), FAKE_DOCKER, { mode: 0o755 });
    log = join(root, 'calls.log');
    writeFileSync(log, '');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function runFake(args: string[], extra: Record<string, string | undefined> = {}) {
    const env: Record<string, string> = {
      PATH: `${join(root, 'bin')}:/usr/bin:/bin`,
      FAKE_DOCKER_LOG: log,
      FAKE_DOCKER_CONFIG: JSON.stringify({ volumes: { postgres_data: { name: FAKE_VOLUME } } }),
      ...VALID,
    };
    for (const [name, value] of Object.entries(extra)) {
      if (value === undefined) Reflect.deleteProperty(env, name);
      else env[name] = value;
    }
    return spawnSync(process.execPath, ['--no-env-file', join(root, 'scripts/db.ts'), ...args], {
      cwd: tmpdir(),
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  function calls(prefix: 'ARGS' | 'ENV'): string[] {
    return readFileSync(log, 'utf8')
      .split('\n')
      .filter((line) => line.startsWith(`${prefix} `));
  }

  // covers: AC-1
  test('status runs Compose from the repo root and passes its exit status through', () => {
    const result = runFake(['status'], { FAKE_DOCKER_PS_STATUS: '3' });
    expect(result.status).toBe(3);
    expect(calls('ARGS')).toEqual([
      'ARGS info --format {{.ServerVersion}}',
      `ARGS ${COMPOSE} ps postgres`,
    ]);
    expect(calls('ENV')[0]).toEndWith(`cwd=${root}`);
  });

  // covers: AC-1
  test('up waits for health and prints no hint when Compose succeeds', () => {
    const result = runFake(['up']);
    expect(result.status).toBe(0);
    expect(calls('ARGS')).toEqual(['ARGS info --format {{.ServerVersion}}', UP]);
    expect(result.stderr).not.toContain(HINT);
  });

  // covers: AC-1
  test('up prints the reset hint and passes the failing Compose status through', () => {
    const result = runFake(['up'], { FAKE_DOCKER_UP_STATUS: '4' });
    expect(result.status).toBe(4);
    expect(result.stderr).toContain(HINT);
  });

  // covers: AC-1
  test.each([
    ['SIGTERM', 143],
    ['SIGKILL', 137],
  ])('a Compose child killed by %s exits with 128 + its number', (signal, status) => {
    const result = runFake(['up'], { FAKE_DOCKER_UP_SIGNAL: signal.slice(3) });
    expect(result.status).toBe(status);
  });

  // covers: AC-1
  test('a stopped Docker daemon stops the command before any Compose call', () => {
    const result = runFake(['status'], { FAKE_DOCKER_INFO_STATUS: '1' });
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('database: Docker is not running; start Docker and try again\n');
    expect(calls('ARGS')).toEqual(['ARGS info --format {{.ServerVersion}}']);
  });

  // covers: AC-1 (a CI runner whose docker info exits 0 without a reachable daemon)
  test('an empty server version counts as a stopped Docker daemon', () => {
    const result = runFake(['up'], { FAKE_DOCKER_INFO_VERSION: '' });
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('database: Docker is not running; start Docker and try again\n');
    expect(calls('ARGS')).toEqual(['ARGS info --format {{.ServerVersion}}']);
  });

  // covers: AC-1
  test('the .env beside scripts/ fills what the shell leaves empty; shell values win', () => {
    writeFileSync(
      join(root, '.env'),
      [
        'POSTGRES_PORT=25432',
        'POSTGRES_ADMIN_PASSWORD=file-admin-password-1',
        'POSTGRES_MIGRATOR_PASSWORD=file-migrator-password-2',
        'POSTGRES_RUNTIME_PASSWORD=file-runtime-password-3',
      ].join('\n'),
    );
    const result = runFake(['up'], {
      POSTGRES_ADMIN_PASSWORD: '',
      POSTGRES_MIGRATOR_PASSWORD: MIGRATOR,
      POSTGRES_RUNTIME_PASSWORD: undefined,
    });
    expect(result.status).toBe(0);
    expect(calls('ENV')).toEqual([
      `ENV admin=file-admin-password-1 migrator=${MIGRATOR} runtime=file-runtime-password-3 port=25432 cwd=${root}`,
    ]);
  });

  // covers: AC-3
  test.each(['down', 'status'])(
    '%s runs without passwords, using the placeholder only in the Compose environment',
    (subcommand) => {
      const result = runFake([subcommand], {
        POSTGRES_ADMIN_PASSWORD: '',
        POSTGRES_MIGRATOR_PASSWORD: undefined,
        POSTGRES_RUNTIME_PASSWORD: RUNTIME,
      });
      expect(result.status).toBe(0);
      expect(calls('ENV')).toEqual([
        `ENV admin=${PASSWORD_PLACEHOLDER} migrator=${PASSWORD_PLACEHOLDER} runtime=${RUNTIME} port=<unset> cwd=${root}`,
      ]);
      expect(calls('ARGS')[1]).toBe(
        subcommand === 'down' ? `ARGS ${COMPOSE} down` : `ARGS ${COMPOSE} ps postgres`,
      );
    },
  );

  // covers: AC-3
  test('down never asks Compose to remove volumes', () => {
    runFake(['down']);
    expect(calls('ARGS').filter((line) => line.includes('--volumes'))).toEqual([]);
  });

  // covers: AC-4
  test('reset reads the volume name from Compose, then removes volumes, then starts again', () => {
    const result = runFake(['reset', `--confirm=${FAKE_VOLUME}`]);
    expect(result.status).toBe(0);
    expect(calls('ARGS')).toEqual([
      'ARGS info --format {{.ServerVersion}}',
      `ARGS ${COMPOSE} config --format json`,
      `ARGS ${COMPOSE} down --volumes`,
      UP,
    ]);
  });

  // covers: AC-4
  test('reset compares against the Compose volume name, not the default project name', () => {
    const result = runFake(['reset', '--confirm=foundation-rust_postgres_data']);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      `database: reset cancelled; confirm with --confirm=${FAKE_VOLUME}\n`,
    );
    expect(calls('ARGS').filter((line) => line.includes(' down'))).toEqual([]);
  });

  // covers: AC-4
  test.each([
    ['an extra argument', [`--confirm=${FAKE_VOLUME}`, '--yes']],
    ['an empty value', ['--confirm=']],
    ['a short flag', ['-y']],
  ])('reset cancels with %s', (_label, args) => {
    const result = runFake(['reset', ...args]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('database: reset cancelled');
    expect(calls('ARGS').filter((line) => line.includes(' down'))).toEqual([]);
  });

  // covers: AC-4
  test('reset never starts again when removing the volumes fails', () => {
    const result = runFake(['reset', `--confirm=${FAKE_VOLUME}`], { FAKE_DOCKER_DOWN_STATUS: '5' });
    expect(result.status).toBe(5);
    expect(calls('ARGS')).not.toContain(UP);
  });

  // covers: AC-4
  test('reset passes a failing compose config through without removing anything', () => {
    const result = runFake(['reset', `--confirm=${FAKE_VOLUME}`], {
      FAKE_DOCKER_CONFIG_STATUS: '6',
    });
    expect(result.status).toBe(6);
    expect(calls('ARGS').filter((line) => line.includes(' down'))).toEqual([]);
  });

  // covers: AC-4
  test('reset stops with status 1 when Compose reports no data volume', () => {
    const result = runFake(['reset', `--confirm=${FAKE_VOLUME}`], {
      FAKE_DOCKER_CONFIG: JSON.stringify({ volumes: {} }),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('database: cannot read the volume name from Compose\n');
  });

  test('up rejects an unexpected argument without calling docker', () => {
    const result = runFake(['up', '--force']);
    expect(result.status).toBe(1);
    expect(result.stderr).toStartWith('database: unexpected argument "--force"');
    expect(calls('ARGS')).toEqual([]);
  });

  describe('interactive reset in a terminal', () => {
    const PROMPT = `DESTRUCTIVE: this deletes all data in volume ${FAKE_VOLUME}. Type the volume name to continue: `;
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

    // `script` gives db.ts a real terminal (macOS and util-linux syntax differ). macOS `script`
    // refuses a socket or FIFO on its standard streams, so plain pipes from `cat` surround it.
    async function runInTerminal(input: string) {
      const fifo = join(root, 'stdin.fifo');
      expect(spawnSync('mkfifo', [fifo]).status).toBe(0);
      const command = [process.execPath, '--no-env-file', join(root, 'scripts/db.ts'), 'reset']
        .map(quote)
        .join(' ');
      const terminal =
        process.platform === 'darwin'
          ? `script -q /dev/null ${command}`
          : `script -q -e -c ${quote(command)} /dev/null`;
      const child = Bun.spawn(
        ['bash', '-c', `set -o pipefail; cat "$0" | ${terminal} 2>&1 | cat`, fifo],
        {
          cwd: tmpdir(),
          env: {
            PATH: `${join(root, 'bin')}:/usr/bin:/bin`,
            FAKE_DOCKER_LOG: log,
            FAKE_DOCKER_CONFIG: JSON.stringify({
              volumes: { postgres_data: { name: FAKE_VOLUME } },
            }),
            ...VALID,
          },
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      // Read and write end, so opening never blocks while bash starts.
      const writer = openSync(fifo, 'r+');
      const reader = child.stdout.getReader();
      const decoder = new TextDecoder();
      let output = '';
      const readMore = async () => {
        const chunk = await reader.read();
        if (!chunk.done) output += decoder.decode(chunk.value);
        return !chunk.done;
      };
      while (!output.includes(PROMPT) && (await readMore()));
      writeSync(writer, input);
      await Bun.sleep(500);
      closeSync(writer);
      while (await readMore());
      return { status: await child.exited, output: output.replaceAll('\r', '') };
    }

    // covers: AC-4
    test.skipIf(Bun.which('script') === null).each([
      ['a wrong answer', 'foundation-rust_postgres_data\r'],
      ['Ctrl+C', '\x03'],
      ['Ctrl+D (end of input)', '\x04'],
    ])(
      'cancels on %s without removing anything',
      async (_label, input) => {
        const result = await runInTerminal(input);
        expect(result.output).toContain(PROMPT);
        expect(result.output).toContain(
          `\ndatabase: reset cancelled; confirm with --confirm=${FAKE_VOLUME}\n`,
        );
        expect(result.status).toBe(1);
        expect(calls('ARGS').filter((line) => line.includes(' down'))).toEqual([]);
      },
      30_000,
    );

    // covers: AC-4
    test.skipIf(Bun.which('script') === null)(
      'resets after the exact volume name is typed',
      async () => {
        const result = await runInTerminal(`${FAKE_VOLUME}\r`);
        expect(result.output).toContain(PROMPT);
        expect(result.status).toBe(0);
        expect(calls('ARGS')).toEqual([
          'ARGS info --format {{.ServerVersion}}',
          `ARGS ${COMPOSE} config --format json`,
          `ARGS ${COMPOSE} down --volumes`,
          UP,
        ]);
      },
      30_000,
    );
  });
});
