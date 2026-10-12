// Development database commands (spec 0003). Run through the root tasks:
//   bun --no-env-file scripts/db.ts <up | down | status | reset>
// Every command loads the root .env, validates the infrastructure variables (up and reset),
// checks Docker, then runs Docker Compose with infrastructure/compose.yaml from the repo root.
// COMPOSE_PROJECT_NAME in the environment replaces the project name (used by the tests).
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { constants } from 'node:os';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from './env-file';
import { DEFAULT_POSTGRES_PORT } from './postgres-env';

export const COMPOSE_FILE = 'infrastructure/compose.yaml';
export const PASSWORD_VARIABLES = [
  'POSTGRES_ADMIN_PASSWORD',
  'POSTGRES_MIGRATOR_PASSWORD',
  'POSTGRES_RUNTIME_PASSWORD',
] as const;
export const PASSWORD_PLACEHOLDER = 'unused-placeholder-for-compose';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const SERVICE = 'postgres';
const VOLUME_KEY = 'postgres_data';
const WAIT_TIMEOUT_SECONDS = '120';
const CONFIRM_FLAG = '--confirm=';
const PASSWORD_PATTERN = /^[A-Za-z0-9._~-]{16,128}$/;
const PASSWORD_RULE = 'must be 16 to 128 characters from A-Z, a-z, 0-9, ".", "_", "~", "-"';
const PORT_RULE = 'must be an integer from 1024 to 65535';

const HELP = `Usage: bun run db:<command>

Manages the development PostgreSQL (Compose file ${COMPOSE_FILE}).
Passwords come from the shell environment or the root .env file.

Commands:
  up      Start postgres and wait until it is healthy.
  down    Remove the container and network. The data volume is kept.
  status  Show the state of the postgres service.
  reset   DESTRUCTIVE: delete the data volume and all its data, then start again.
          Type the volume name when asked, or pass --confirm=<volume name>.
`;

export type Subcommand = 'up' | 'down' | 'status' | 'reset';
export type ComposeCommand = 'up' | 'down' | 'status' | 'config';
export type InfraEnv = Readonly<Record<string, string | undefined>>;
export type InfraEnvResult = { ok: true; port: number } | { ok: false; errors: string[] };

export interface ComposeOptions {
  // Only for `down`: also remove the named volumes of the project.
  removeVolumes?: boolean;
}

// Checks the infrastructure variables of `up` and `reset`. Each error is one
// `<NAME>: <message>` line, in the order of the variable table of spec 0003.
// The resolved `port` is for callers such as the root tasks of feature 4; db.ts itself lets
// Compose read POSTGRES_PORT and only needs `ok`.
export function validateInfraEnv(env: InfraEnv): InfraEnvResult {
  const errors: string[] = [];
  let port = DEFAULT_POSTGRES_PORT;
  const portText = env.POSTGRES_PORT ?? '';
  if (portText !== '') {
    port = /^\d{1,5}$/.test(portText) ? Number(portText) : Number.NaN;
    if (!(port >= 1024 && port <= 65535)) errors.push(`POSTGRES_PORT: ${PORT_RULE}`);
  }
  const earlier: { name: string; value: string }[] = [];
  for (const name of PASSWORD_VARIABLES) {
    const value = env[name] ?? '';
    const same = earlier.find((other) => other.value === value);
    if (value === '') errors.push(`${name}: is required`);
    else if (!PASSWORD_PATTERN.test(value)) errors.push(`${name}: ${PASSWORD_RULE}`);
    else if (same) errors.push(`${name}: must differ from ${same.name}`);
    earlier.push({ name, value });
  }
  return errors.length === 0 ? { ok: true, port } : { ok: false, errors };
}

// Arguments for `docker`, always with the Compose file relative to the repo root.
export function buildComposeArgs(command: ComposeCommand, options: ComposeOptions = {}): string[] {
  const base = ['compose', '-f', COMPOSE_FILE];
  switch (command) {
    case 'up':
      return [...base, 'up', '-d', '--wait', '--wait-timeout', WAIT_TIMEOUT_SECONDS, SERVICE];
    case 'down':
      return options.removeVolumes === true ? [...base, 'down', '--volumes'] : [...base, 'down'];
    case 'status':
      return [...base, 'ps', SERVICE];
    case 'config':
      return [...base, 'config', '--format', 'json'];
  }
}

// A reset goes ahead only when the answer is exactly the expected volume name.
export function confirmationAccepted(expected: string, answer: string | null | undefined): boolean {
  return expected !== '' && answer === expected;
}

// Environment for Compose. `down` and `status` never use the passwords, so empty ones get a
// non secret placeholder in the child environment only, which keeps `${VAR:?}` from failing.
export function composeEnv(subcommand: Subcommand, env: InfraEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined) result[name] = value;
  }
  if (subcommand === 'down' || subcommand === 'status') {
    for (const name of PASSWORD_VARIABLES) {
      if ((result[name] ?? '') === '') result[name] = PASSWORD_PLACEHOLDER;
    }
  }
  return result;
}

// Reads the effective name of the data volume from `docker compose config --format json`.
export function volumeNameFromConfig(configJson: string): string | undefined {
  const config = JSON.parse(configJson) as { volumes?: Record<string, { name?: unknown }> };
  const name = config.volumes?.[VOLUME_KEY]?.name;
  return typeof name === 'string' && name !== '' ? name : undefined;
}

function fail(message: string): number {
  process.stderr.write(`${message}\n`);
  return 1;
}

function exitStatus(result: SpawnSyncReturns<unknown>): number {
  if (result.signal) return 128 + constants.signals[result.signal];
  return result.status ?? 1;
}

function checkDocker(): number | undefined {
  const result = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
    stdio: 'ignore',
  });
  const code = result.error && 'code' in result.error ? result.error.code : undefined;
  if (code === 'ENOENT') {
    return fail('database: docker command not found; install Docker and try again');
  }
  if (result.error || result.status !== 0) {
    return fail('database: Docker is not running; start Docker and try again');
  }
  return undefined;
}

function compose(args: string[], env: Record<string, string>): number {
  return exitStatus(spawnSync('docker', args, { cwd: repoRoot, env, stdio: 'inherit' }));
}

function up(env: Record<string, string>): number {
  const status = compose(buildComposeArgs('up'), env);
  if (status !== 0) {
    process.stderr.write(
      'database: postgres did not become healthy; if this was its first start, run "bun run db:reset"\n',
    );
  }
  return status;
}

function promptLine(question: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const prompt = createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: true,
    });
    let settled = false;
    const finish = (answer: string | undefined) => {
      if (settled) return;
      settled = true;
      process.off('SIGINT', onInterrupt);
      prompt.close();
      resolve(answer);
    };
    const onInterrupt = () => {
      process.stderr.write('\n');
      finish(undefined);
    };
    process.on('SIGINT', onInterrupt);
    prompt.on('SIGINT', onInterrupt);
    prompt.on('close', () => {
      // End of input (Ctrl+D) closes the prompt before any answer; end the prompt line first.
      if (!settled) process.stderr.write('\n');
      finish(undefined);
    });
    prompt.question(question, (answer) => {
      finish(answer);
    });
  });
}

// Only `--confirm=<value>` counts as a confirmation argument; any other argument, including
// `--confirm <value>` with a space, cancels. Without arguments, only a terminal may confirm.
async function readConfirmation(args: string[], volume: string): Promise<string | undefined> {
  const [first] = args;
  if (first !== undefined) {
    return args.length === 1 && first.startsWith(CONFIRM_FLAG)
      ? first.slice(CONFIRM_FLAG.length)
      : undefined;
  }
  if (!process.stdin.isTTY) return undefined;
  return promptLine(
    `DESTRUCTIVE: this deletes all data in volume ${volume}. Type the volume name to continue: `,
  );
}

async function reset(args: string[], env: Record<string, string>): Promise<number> {
  const config = spawnSync('docker', buildComposeArgs('config'), {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 16 * 1024 * 1024,
  });
  if (config.signal || config.status !== 0) return exitStatus(config);
  const volume = volumeNameFromConfig(config.stdout);
  if (volume === undefined) return fail('database: cannot read the volume name from Compose');
  const answer = await readConfirmation(args, volume);
  if (!confirmationAccepted(volume, answer)) {
    return fail(`database: reset cancelled; confirm with ${CONFIRM_FLAG}${volume}`);
  }
  const down = compose(buildComposeArgs('down', { removeVolumes: true }), env);
  if (down !== 0) return down;
  return up(env);
}

function isSubcommand(value: string): value is Subcommand {
  return value === 'up' || value === 'down' || value === 'status' || value === 'reset';
}

export async function main(argv: string[]): Promise<number> {
  const [subcommand, ...args] = argv;
  if (subcommand === undefined || subcommand === '--help') {
    process.stdout.write(HELP);
    return 0;
  }
  if (!isSubcommand(subcommand)) {
    return fail(`database: unknown command "${subcommand}"\n\n${HELP}`);
  }
  if (subcommand !== 'reset' && args.length > 0) {
    return fail(`database: unexpected argument "${args.join(' ')}"\n\n${HELP}`);
  }
  try {
    loadEnvFile();
  } catch (error) {
    return fail(`database: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (subcommand === 'up' || subcommand === 'reset') {
    const result = validateInfraEnv(process.env);
    if (!result.ok) {
      const lines = result.errors.map((line) => `  ${line}`);
      return fail(['database configuration error:', ...lines].join('\n'));
    }
  }
  const dockerStatus = checkDocker();
  if (dockerStatus !== undefined) return dockerStatus;
  const env = composeEnv(subcommand, process.env);
  switch (subcommand) {
    case 'up':
      return up(env);
    case 'down':
      return compose(buildComposeArgs('down'), env);
    case 'status':
      return compose(buildComposeArgs('status'), env);
    case 'reset':
      return reset(args, env);
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
