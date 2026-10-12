// Test harness for PostgreSQL (spec 0003). Every call to startPostgres runs its own temporary
// Compose project `foundation-test-<16 hex>` with random passwords and an ephemeral host port,
// so tests never touch the development project foundation-rust or another worktree's run.
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const TEST_PROJECT_PREFIX = 'foundation-test-';
export const STALE_PROJECT_AGE_MS = 2 * 60 * 60 * 1000;

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const TEST_PROJECT_PATTERN = /^foundation-test-[0-9a-f]{16}$/;
const STRIPPED_PREFIXES = ['POSTGRES_', 'COMPOSE_', 'DATABASE_', 'FOUNDATION_'];
const WAIT_TIMEOUT_SECONDS = '120';
const ROLE_NAMES = {
  admin: 'foundation_admin',
  migrator: 'foundation_migrator',
  app: 'foundation_app',
} as const;

export type TestRole = keyof typeof ROLE_NAMES;

export interface TestPasswords {
  admin: string;
  migrator: string;
  runtime: string;
}

export interface TestEnv {
  project: string;
  passwords: TestPasswords;
  env: Record<string, string>;
}

export interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface TestPostgres {
  project: string;
  port: number;
  passwords: TestPasswords;
  urls: { admin: string; migrator: string; app: string };
  psql(role: TestRole, sql: string, options?: { password?: string }): CommandResult;
  compose(args: string[]): CommandResult;
  stop(): void;
}

export interface StartPostgresOptions {
  // Keep the data in the project's named volume instead of tmpfs.
  persistent?: boolean;
}

export interface ProjectContainer {
  project: string;
  created: Date;
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

// A new project name, three different passwords, and the child environment for Compose:
// a copy of process.env without POSTGRES_*, COMPOSE_*, DATABASE_*, and FOUNDATION_*,
// plus the three password variables of infrastructure/compose.yaml.
export function createTestEnv(): TestEnv {
  const project = `${TEST_PROJECT_PREFIX}${randomHex(8)}`;
  const passwords = { admin: randomHex(16), migrator: randomHex(16), runtime: randomHex(16) };
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (STRIPPED_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    env[name] = value;
  }
  env.POSTGRES_ADMIN_PASSWORD = passwords.admin;
  env.POSTGRES_MIGRATOR_PASSWORD = passwords.migrator;
  env.POSTGRES_RUNTIME_PASSWORD = passwords.runtime;
  return { project, passwords, env };
}

// Projects left by runs that were killed hard: every container of the project was created
// before the cut off. Younger projects may belong to another worktree and are kept.
export function selectStaleProjects(containers: ProjectContainer[], now: Date): string[] {
  const cutoff = now.getTime() - STALE_PROJECT_AGE_MS;
  const youngest = new Map<string, number>();
  for (const { project, created } of containers) {
    if (!TEST_PROJECT_PATTERN.test(project)) continue;
    youngest.set(project, Math.max(youngest.get(project) ?? 0, created.getTime()));
  }
  return [...youngest].filter(([, time]) => time < cutoff).map(([project]) => project);
}

function run(args: string[], env: Record<string, string>): CommandResult {
  const result = spawnSync('docker', args, {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) return { status: null, stdout: '', stderr: result.error.message };
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// Children still running (compose up); the signal handler kills them before cleaning up.
const runningChildren = new Set<ChildProcess>();

function runAsync(args: string[], env: Record<string, string>): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn('docker', args, { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
    runningChildren.add(child);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (error) => {
      runningChildren.delete(child);
      resolve({ status: null, stdout, stderr: error.message });
    });
    child.on('close', (status) => {
      runningChildren.delete(child);
      resolve({ status, stdout, stderr });
    });
  });
}

function composeFiles(persistent: boolean): string[] {
  const files = ['-f', 'infrastructure/compose.yaml', '-f', 'infrastructure/compose.test.yaml'];
  if (!persistent) files.push('-f', 'infrastructure/compose.test-tmpfs.yaml');
  return files;
}

function requireDocker(env: Record<string, string>): void {
  const result = run(['info', '--format', '{{.ServerVersion}}'], env);
  if (result.status !== 0) {
    throw new Error(
      `the PostgreSQL tests need a running Docker daemon: ${result.stderr.trim() || 'docker info failed'}`,
    );
  }
}

// docker inspect prints nanoseconds; Date only keeps milliseconds.
function parseCreated(text: string): Date {
  return new Date(text.trim().replace(/(\.\d{3})\d*(?=Z|[+-]\d{2}:\d{2}$)/, '$1'));
}

function removeStaleProjects(env: Record<string, string>): void {
  const ids = run(['ps', '-aq', '--filter', `name=${TEST_PROJECT_PREFIX}`], env)
    .stdout.split('\n')
    .filter(Boolean);
  if (ids.length === 0) return;
  const inspected = run(
    [
      'inspect',
      '--format',
      '{{index .Config.Labels "com.docker.compose.project"}} {{.Created}}',
      ...ids,
    ],
    env,
  );
  const containers = inspected.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [project = '', created = ''] = line.split(' ');
      return { project, created: parseCreated(created) };
    });
  for (const project of selectStaleProjects(containers, new Date())) {
    run(
      [
        'compose',
        ...composeFiles(true),
        '--project-name',
        project,
        'down',
        '--volumes',
        '--remove-orphans',
      ],
      env,
    );
  }
}

// Stops every project this process started, once, when the process receives SIGINT or
// SIGTERM, because bun test does not run afterAll hooks on a signal.
const activeStops = new Set<() => void>();
let signalHandlersInstalled = false;

function installSignalHandlers(): void {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;
  const onSignal = (exitCode: number) => () => {
    for (const child of runningChildren) child.kill('SIGKILL');
    for (const stop of [...activeStops]) {
      try {
        stop();
      } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
    process.exit(exitCode);
  };
  process.once('SIGINT', onSignal(130));
  process.once('SIGTERM', onSignal(143));
}

function parsePort(output: string): number {
  const port = Number(/:(\d+)\s*$/.exec(output.trim())?.[1]);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`cannot read the published port from "${output.trim()}"`);
  }
  return port;
}

function databaseUrl(role: TestRole, password: string, port: number): string {
  return `postgres://${ROLE_NAMES[role]}:${password}@127.0.0.1:${String(port)}/foundation?sslmode=disable`;
}

export async function startPostgres(options: StartPostgresOptions = {}): Promise<TestPostgres> {
  const { project, passwords, env } = createTestEnv();
  requireDocker(env);
  removeStaleProjects(env);

  const files = composeFiles(options.persistent === true);
  const composeArgs = (args: string[]) => ['compose', ...files, '--project-name', project, ...args];
  const compose = (args: string[]) => run(composeArgs(args), env);
  // Idempotent once `down` succeeds; a failed `down` stays registered so a later call
  // (afterAll or the signal handler) tries again.
  let stopped = false;
  const stop = () => {
    if (!project.startsWith(TEST_PROJECT_PREFIX)) {
      throw new Error(
        `refusing to remove project ${project}: not a ${TEST_PROJECT_PREFIX}* project`,
      );
    }
    if (stopped) return;
    const result = compose(['down', '--volumes', '--remove-orphans']);
    if (result.status !== 0) {
      throw new Error(`docker compose down failed for ${project}: ${result.stderr.trim()}`);
    }
    stopped = true;
    activeStops.delete(stop);
  };
  // Cleans up after a failed start and keeps the start error as the main message.
  const failStart = (message: string): Error => {
    try {
      stop();
      return new Error(message);
    } catch (error) {
      const cleanup = error instanceof Error ? error.message : String(error);
      return new Error(`${message}\n(cleanup also failed: ${cleanup})`);
    }
  };
  activeStops.add(stop);
  installSignalHandlers();

  const up = await runAsync(
    composeArgs(['up', '-d', '--wait', '--wait-timeout', WAIT_TIMEOUT_SECONDS]),
    env,
  );
  if (up.status !== 0) {
    const logs = compose(['logs', '--no-color', '--tail', '50', 'postgres']).stdout;
    throw failStart(
      `postgres in ${project} did not become healthy (status ${String(up.status)}):\n${up.stderr}\n${logs}`,
    );
  }
  let port: number;
  try {
    port = parsePort(compose(['port', 'postgres', '5432']).stdout);
  } catch (error) {
    throw failStart(error instanceof Error ? error.message : String(error));
  }

  const rolePassword = {
    admin: passwords.admin,
    migrator: passwords.migrator,
    app: passwords.runtime,
  };
  return {
    project,
    port,
    passwords,
    urls: {
      admin: databaseUrl('admin', passwords.admin, port),
      migrator: databaseUrl('migrator', passwords.migrator, port),
      app: databaseUrl('app', passwords.runtime, port),
    },
    psql: (role, sql, psqlOptions = {}) =>
      compose([
        'exec',
        '-T',
        '-e',
        `PGPASSWORD=${psqlOptions.password ?? rolePassword[role]}`,
        'postgres',
        'psql',
        '-X',
        '-q',
        '-At',
        '-v',
        'ON_ERROR_STOP=1',
        '-v',
        'VERBOSITY=sqlstate',
        '-h',
        '127.0.0.1',
        '-U',
        ROLE_NAMES[role],
        '-d',
        'foundation',
        '-c',
        sql,
      ]),
    compose,
    stop,
  };
}
