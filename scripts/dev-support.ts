// Pure helpers of the dev supervisor (spec 0004), kept apart from scripts/dev.ts so tests can
// import them without starting anything.
import { isIP } from 'node:net';
import { dirname, resolve } from 'node:path';

export interface DevOptions {
  envFile: string | undefined;
  stateDir: string;
  apiDir: string;
}

export interface DevDefaults {
  stateDir: string;
  apiDir: string;
}

const PATH_OPTIONS = ['--env-file', '--state-dir', '--api-dir'] as const;
type PathOption = (typeof PATH_OPTIONS)[number];

function isPathOption(name: string): name is PathOption {
  return (PATH_OPTIONS as readonly string[]).includes(name);
}

// Parses `--name value` and `--name=value` for the three dev options. Any other argument,
// or an option without a value, is reported as `[dev] unknown option: <arg>`.
export function parseDevArgs(
  argv: readonly string[],
  cwd: string,
  defaults: DevDefaults,
): DevOptions | { error: string } {
  const values = new Map<PathOption, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    const equals = arg.indexOf('=');
    const name = equals === -1 ? arg : arg.slice(0, equals);
    if (!isPathOption(name)) return { error: `[dev] unknown option: ${arg}` };
    let value: string | undefined;
    if (equals === -1) {
      index += 1;
      value = argv[index];
    } else {
      value = arg.slice(equals + 1);
    }
    if (value === undefined || value === '' || value.startsWith('--')) {
      return { error: `[dev] unknown option: ${arg}` };
    }
    values.set(name, value);
  }
  const envFile = values.get('--env-file');
  const stateDir = values.get('--state-dir');
  const apiDir = values.get('--api-dir');
  return {
    envFile,
    stateDir: stateDir === undefined ? defaults.stateDir : resolve(cwd, stateDir),
    apiDir: apiDir === undefined ? defaults.apiDir : resolve(cwd, apiDir),
  };
}

export interface DevSettings {
  apiHost: string;
  apiPort: number;
  webPort: number;
  postgresPort: number;
}

type Env = Readonly<Record<string, string | undefined>>;

function setting(env: Env, name: string, fallback: string): string {
  const value = env[name];
  return value === undefined || value === '' ? fallback : value;
}

function parsePort(text: string, minimum: number): number | undefined {
  if (!/^[0-9]+$/.test(text)) return undefined;
  const port = Number(text);
  return port >= minimum && port <= 65535 ? port : undefined;
}

// Validates the variables the supervisor itself uses. Every problem is reported; the backend
// still validates its full configuration on start (spec 0002).
export function validateDevEnv(
  env: Env,
  defaultPostgresPort: number,
): DevSettings | { errors: string[] } {
  const errors: string[] = [];
  if (env.APP_ENV !== 'development')
    errors.push('[dev] APP_ENV: must be development for bun run dev');
  const apiHost = setting(env, 'APP_HOST', '127.0.0.1');
  if (isIP(apiHost) === 0 || apiHost.includes('%')) {
    errors.push('[dev] APP_HOST: must be an IPv4 or IPv6 address literal');
  }
  const apiPort = parsePort(setting(env, 'APP_PORT', '3000'), 1);
  if (apiPort === undefined) errors.push('[dev] APP_PORT: must be an integer from 1 to 65535');
  const webPort = parsePort(setting(env, 'WEB_DEV_PORT', '4200'), 1024);
  if (webPort === undefined) {
    errors.push('[dev] WEB_DEV_PORT: must be an integer from 1024 to 65535');
  } else if (webPort === apiPort) {
    errors.push('[dev] WEB_DEV_PORT: must differ from APP_PORT');
  }
  const postgresPort = parsePort(setting(env, 'POSTGRES_PORT', String(defaultPostgresPort)), 1024);
  if (postgresPort === undefined) {
    errors.push('[dev] POSTGRES_PORT: must be an integer from 1024 to 65535');
  }
  if (
    errors.length > 0 ||
    apiPort === undefined ||
    webPort === undefined ||
    postgresPort === undefined
  ) {
    return { errors };
  }
  return { apiHost, apiPort, webPort, postgresPort };
}

// Host part of an URL: IPv6 literals go inside square brackets.
export function urlHost(host: string): string {
  return isIP(host) === 6 ? `[${host}]` : host;
}

// Where the dev server proxy and the readiness checks reach the backend. Wildcard binds are
// reached through the matching loopback address.
export function apiTarget(apiHost: string, apiPort: number): string {
  let host = apiHost;
  if (apiHost === '0.0.0.0' || apiHost === '::') host = '127.0.0.1';
  return `http://${urlHost(host)}:${String(apiPort)}`;
}

export function readyLine(settings: DevSettings): string {
  return `[dev] ready: web http://127.0.0.1:${String(settings.webPort)}, api http://${urlHost(settings.apiHost)}:${String(settings.apiPort)}`;
}

const EDITOR_TEMP_FILE = /(^\.#)|(~$)|(\.swp$)|(^4913$)/;

// Files the watcher ignores: Markdown and editor temporary files. `target` folders are
// skipped by the directory walk itself.
export function isIgnoredWatchFile(name: string): boolean {
  return name.endsWith('.md') || EDITOR_TEMP_FILE.test(name);
}

// Exit status in shell terms: the exit code, or 128 + n for a signal.
export function exitStatus(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) return code;
  const numbers: Partial<Record<NodeJS.Signals, number>> = {
    SIGHUP: 1,
    SIGINT: 2,
    SIGKILL: 9,
    SIGTERM: 15,
  };
  return 128 + (signal === null ? 0 : (numbers[signal] ?? 0));
}

// The key that holds the search path; Windows spells it Path.
export function pathKey(env: Record<string, string | undefined>): string {
  return Object.keys(env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH';
}

// Puts the directory of the chosen Node.js first on the search path, so every nested
// script of the dev server runs Angular on that same binary.
export function withNodeFirst(
  env: Record<string, string | undefined>,
  node: string,
  delimiter: string,
): Record<string, string | undefined> {
  const key = pathKey(env);
  const current = env[key] ?? '';
  const first = dirname(node);
  return { ...env, [key]: current === '' ? first : `${first}${delimiter}${current}` };
}

// Splits a byte stream into lines, dropping a carriage return before each newline and
// keeping a partial last line until flush().
export class LineSplitter {
  private pending = '';

  constructor(private readonly onLine: (line: string) => void) {}

  push(chunk: string): void {
    this.pending += chunk;
    let newline = this.pending.indexOf('\n');
    while (newline !== -1) {
      this.onLine(this.pending.slice(0, newline).replace(/\r$/, ''));
      this.pending = this.pending.slice(newline + 1);
      newline = this.pending.indexOf('\n');
    }
  }

  flush(): void {
    if (this.pending !== '') this.onLine(this.pending.replace(/\r$/, ''));
    this.pending = '';
  }
}
