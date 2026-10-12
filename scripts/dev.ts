// `bun run dev`: runs the Angular dev server, the Axum backend, and the /api proxy together,
// rebuilds the backend when Rust sources change, and stops every child cleanly (spec 0004).
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  createWriteStream,
  type Dirent,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  type WriteStream,
} from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  apiTarget,
  type DevOptions,
  type DevSettings,
  exitStatus,
  isIgnoredWatchFile,
  LineSplitter,
  parseDevArgs,
  readyLine,
  validateDevEnv,
} from './dev-support';
import { loadEnvFile } from './env-file';
import { DEFAULT_POSTGRES_PORT } from './postgres-env';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const isWindows = process.platform === 'win32';
const STOP_GRACE_MS = 10_000;
const RELOAD_GRACE_MS = 5_000;
const KILL_WAIT_MS = 2_000;
const READY_LIMIT_MS = 120_000;
const POLL_INTERVAL_MS = 500;
const REPEAT_TRIGGER_IGNORE_MS = 1_500;

type Service = 'web' | 'api';

function info(message: string): void {
  process.stdout.write(`${message}\n`);
}

function fatal(message: string): void {
  process.stderr.write(`${message}\n`);
}

function delay(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

// ---------------------------------------------------------------- preflight

function bindProbe(host: string, port: number): Promise<string | undefined> {
  return new Promise((done) => {
    const server = createServer();
    server.once('error', (error: NodeJS.ErrnoException) => {
      done(error.code ?? 'EADDRINUSE');
    });
    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => {
        done(undefined);
      });
    });
  });
}

function connectProbe(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (accepted: boolean) => {
      socket.destroy();
      done(accepted);
    };
    socket.setTimeout(timeoutMs, () => {
      finish(false);
    });
    socket.once('connect', () => {
      finish(true);
    });
    socket.once('error', () => {
      finish(false);
    });
  });
}

async function portProblem(name: string, host: string, port: number): Promise<string | undefined> {
  const bindError = await bindProbe(host, port);
  const reason =
    bindError ?? ((await connectProbe(port, 200)) ? 'accepting connections' : undefined);
  return reason === undefined
    ? undefined
    : `[dev] ${name}=${String(port)} is already in use (${reason}); set ${name} in .env`;
}

// ---------------------------------------------------------------- logging

class ServiceOutput {
  private readonly log: WriteStream;
  private readonly splitters: LineSplitter[] = [];

  constructor(
    private readonly service: Service,
    logDir: string,
  ) {
    this.log = createWriteStream(join(logDir, `${service}.log`), { flags: 'a' });
  }

  // Prefixes each line of a child stream and copies it raw to the service log.
  attach(child: ChildProcess, onStdoutLine?: (line: string) => void): void {
    const prefix = `[${this.service}]`;
    const stdout = new LineSplitter((line) => {
      process.stdout.write(`${prefix} ${line}\n`);
      this.log.write(`${line}\n`);
      onStdoutLine?.(line);
    });
    const stderr = new LineSplitter((line) => {
      process.stderr.write(`${prefix} ${line}\n`);
      this.log.write(`${line}\n`);
    });
    this.splitters.push(stdout, stderr);
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
      stdout.push(chunk);
    });
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      stderr.push(chunk);
    });
    child.once('close', () => {
      stdout.flush();
      stderr.flush();
    });
  }

  line(text: string, toStderr = false): void {
    (toStderr ? process.stderr : process.stdout).write(`[${this.service}] ${text}\n`);
    this.log.write(`${text}\n`);
  }

  close(): Promise<void> {
    for (const splitter of this.splitters) splitter.flush();
    return new Promise((done) => this.log.end(done));
  }
}

// ---------------------------------------------------------------- child processes

interface Running {
  child: ChildProcess;
  exited: Promise<number>;
  done: boolean;
}

// Every process the supervisor started, so a crash of the supervisor itself can still stop them.
const started = new Set<Running>();

function startChild(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Running {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    // POSIX: own process group, so the whole tree can be signalled. Windows: own console,
    // hidden, so Ctrl+C reaches only the supervisor.
    detached: true,
    windowsHide: true,
  });
  const running: Running = {
    child,
    done: false,
    exited: new Promise((done) => {
      child.once('error', (error) => {
        fatal(`[dev] cannot start ${command}: ${error.message}`);
        running.done = true;
        done(127);
      });
      child.once('exit', (code, signal) => {
        running.done = true;
        done(exitStatus(code, signal));
      });
    }),
  };
  started.add(running);
  return running;
}

// POSIX: the group outlives its leader when, for example, `bun run` dies but `ng serve` does
// not, so the group is signalled and waited for even after the leader exited.
function groupAlive(running: Running): boolean {
  const pid = running.child.pid;
  if (pid === undefined) return false;
  if (isWindows) return !running.done;
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killTree(running: Running, signal: 'SIGTERM' | 'SIGKILL'): void {
  const pid = running.child.pid;
  if (pid === undefined) return;
  if (isWindows && running.done) return;
  try {
    if (isWindows) {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      process.kill(-pid, signal);
    }
  } catch {
    // The process group is already gone.
  }
}

async function waitFor(running: Running, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  await Promise.race([running.exited, delay(ms)]);
  while (groupAlive(running)) {
    if (Date.now() > deadline) return false;
    await delay(50);
  }
  return true;
}

// The Angular dev server and cargo never need database credentials (spec 0004 review).
function withoutSecrets(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([name]) => !/^(DATABASE_|POSTGRES_)/.test(name) && !name.endsWith('_FILE'),
    ),
  );
}

function mtimeOf(path: string): number | undefined {
  try {
    return existsSync(path) ? statSync(path).mtimeMs : undefined;
  } catch {
    return undefined;
  }
}

function tryRemove(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // Best effort: a leftover file in the state dir is cleaned on the next start.
  }
}

// ---------------------------------------------------------------- supervisor

class Supervisor {
  private readonly webOutput: ServiceOutput;
  private readonly apiOutput: ServiceOutput;
  private readonly binDir: string;
  private web: Running | undefined;
  private api: Running | undefined;
  private build: Running | undefined;
  private apiCopy: string | undefined;
  private builtAt = 0;
  private buildCount = 0;
  private firstReady = false;
  private stopping = false;
  private stopStartedAt = 0;
  private forced = false;
  private reloading = false;
  private rebuildPending = false;
  private watchTimer: ReturnType<typeof setInterval> | undefined;
  private snapshot = new Map<string, number>();
  // Backends stopped on purpose by a reload; their exit is expected and not reported.
  private readonly retired = new Set<Running>();
  private stdin: ReturnType<typeof createInterface> | undefined;
  private finished: (code: number) => void = () => undefined;
  readonly result: Promise<number>;

  constructor(
    private readonly options: DevOptions,
    private readonly settings: DevSettings,
  ) {
    const logDir = join(options.stateDir, 'logs');
    this.binDir = join(options.stateDir, 'bin');
    rmSync(logDir, { recursive: true, force: true });
    rmSync(this.binDir, { recursive: true, force: true });
    mkdirSync(logDir, { recursive: true });
    mkdirSync(this.binDir, { recursive: true });
    this.webOutput = new ServiceOutput('web', logDir);
    this.apiOutput = new ServiceOutput('api', logDir);
    this.result = new Promise((done) => {
      this.finished = done;
    });
  }

  // A method, not a field read, because the flag changes during awaits and TypeScript
  // would otherwise narrow it to its value before the await.
  private isStopping(): boolean {
    return this.stopping;
  }

  // Set by the poller while a build runs; read through a method for the same reason.
  private isRebuildPending(): boolean {
    return this.rebuildPending;
  }

  listenForStop(): void {
    const signals: NodeJS.Signals[] = isWindows
      ? ['SIGINT', 'SIGBREAK']
      : ['SIGINT', 'SIGTERM', 'SIGHUP'];
    for (const signal of signals) {
      process.on(signal, () => {
        this.trigger();
      });
    }
    this.stdin = createInterface({ input: process.stdin });
    this.stdin.on('line', (line) => {
      if (line.trim().toLowerCase() === 'q') this.trigger();
    });
  }

  private trigger(): void {
    if (!this.stopping) {
      void this.stop(0);
      return;
    }
    if (Date.now() - this.stopStartedAt < REPEAT_TRIGGER_IGNORE_MS || this.forced) return;
    this.forced = true;
    info('[dev] forcing stop');
    for (const running of [this.build, this.api, this.web]) {
      if (running !== undefined) killTree(running, 'SIGKILL');
    }
  }

  // ------------------------------------------------------------ build

  private async runBuild(): Promise<{ ok: boolean; executable: string | undefined }> {
    info('[dev] building api');
    const build = startChild(
      'cargo',
      ['build', '--locked', '-p', 'api', '--message-format=json-render-diagnostics'],
      this.options.apiDir,
      withoutSecrets(process.env),
    );
    this.build = build;
    let executable: string | undefined;
    const stdout = new LineSplitter((line) => {
      let message: {
        reason?: string;
        executable?: string | null;
        target?: { name?: string };
        message?: { rendered?: string };
      };
      try {
        message = JSON.parse(line) as typeof message;
      } catch {
        this.apiOutput.line(line);
        return;
      }
      if (
        message.reason === 'compiler-artifact' &&
        message.target?.name === 'api' &&
        message.executable
      ) {
        executable = message.executable;
      } else if (message.reason === 'compiler-message' && message.message?.rendered) {
        for (const rendered of message.message.rendered.replace(/\n$/, '').split('\n')) {
          this.apiOutput.line(rendered, true);
        }
      }
    });
    const stderr = new LineSplitter((line) => {
      this.apiOutput.line(line, true);
    });
    build.child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
      stdout.push(chunk);
    });
    build.child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      stderr.push(chunk);
    });
    const status = await build.exited;
    stdout.flush();
    stderr.flush();
    this.build = undefined;
    return { ok: status === 0 && executable !== undefined, executable };
  }

  // Copies the built binary so the next build can overwrite the original while this copy
  // runs (Windows locks a running executable).
  private copyBinary(executable: string): string {
    this.buildCount += 1;
    const name = `api-${String(process.pid)}-${String(this.buildCount)}${isWindows ? '.exe' : ''}`;
    const copy = join(this.binDir, name);
    copyFileSync(executable, copy);
    if (!isWindows) chmodSync(copy, 0o755);
    return copy;
  }

  private async removeCopy(path: string | undefined): Promise<void> {
    if (path === undefined) return;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        rmSync(path, { force: true });
        return;
      } catch {
        await delay(200);
      }
    }
  }

  // ------------------------------------------------------------ api

  private startApi(copy: string, onListening: () => void): Running {
    const api = startChild(copy, [], this.options.apiDir, process.env);
    let listening = false;
    this.apiOutput.attach(api.child, (line) => {
      if (!listening && line.startsWith('api listening on ')) {
        listening = true;
        onListening();
      }
    });
    info(`[dev] started api (pid ${String(api.child.pid)})`);
    return api;
  }

  private watchApiExit(api: Running, copy: string): void {
    void api.exited.then(async (status) => {
      await this.removeCopy(copy);
      if (this.stopping || this.retired.has(api)) return;
      if (!this.firstReady) {
        info(`[dev] api exited with status ${String(status)} before it was ready; stopping`);
        void this.stop(1);
      } else {
        info(`[dev] api exited with status ${String(status)}; waiting for changes`);
      }
    });
  }

  // ------------------------------------------------------------ web

  private startWeb(): Running {
    const env = {
      ...withoutSecrets(process.env),
      DEV_API_TARGET: apiTarget(this.settings.apiHost, this.settings.apiPort),
    };
    const web = startChild(
      process.execPath,
      [
        'run',
        '--cwd',
        'apps/web',
        'start',
        '--',
        '--host',
        '127.0.0.1',
        '--port',
        String(this.settings.webPort),
      ],
      repoRoot,
      env,
    );
    this.webOutput.attach(web.child);
    info(`[dev] started web (pid ${String(web.child.pid)})`);
    void web.exited.then((status) => {
      if (this.stopping) return;
      info(`[dev] web exited with status ${String(status)}; stopping`);
      void this.stop(1);
    });
    return web;
  }

  private async webAnswers(): Promise<boolean> {
    try {
      const response = await fetch(`http://127.0.0.1:${String(this.settings.webPort)}/`, {
        signal: AbortSignal.timeout(1000),
      });
      await response.body?.cancel();
      return response.status === 200;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------ watcher

  private scan(): Map<string, number> {
    const files = new Map<string, number>();
    const walk = (directory: string) => {
      let entries: Dirent[];
      try {
        entries = readdirSync(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'target') walk(path);
        } else if (!isIgnoredWatchFile(entry.name)) {
          try {
            files.set(path, statSync(path).mtimeMs);
          } catch {
            // Removed between the listing and the stat; the next poll sees it.
          }
        }
      }
    };
    walk(join(this.options.apiDir, 'apps', 'api'));
    walk(join(this.options.apiDir, 'crates'));
    for (const name of ['Cargo.toml', 'Cargo.lock']) {
      const path = join(this.options.apiDir, name);
      const mtime = mtimeOf(path);
      if (mtime !== undefined) files.set(path, mtime);
    }
    return files;
  }

  private changed(next: Map<string, number>): boolean {
    if (next.size !== this.snapshot.size) return true;
    for (const [path, mtime] of next) {
      if (this.snapshot.get(path) !== mtime) return true;
    }
    return false;
  }

  private startWatching(): void {
    this.watchTimer = setInterval(() => {
      if (this.stopping) return;
      const next = this.scan();
      if (!this.changed(next)) return;
      this.snapshot = next;
      if (this.reloading) {
        this.rebuildPending = true;
      } else {
        void this.reload();
      }
    }, POLL_INTERVAL_MS);
  }

  private async reload(): Promise<void> {
    this.reloading = true;
    do {
      this.rebuildPending = false;
      const { ok, executable } = await this.runBuild();
      if (this.isStopping()) break;
      if (!ok || executable === undefined) {
        info('[dev] api build failed; previous backend keeps running');
        continue;
      }
      const builtAt = mtimeOf(executable) ?? Date.now();
      // Restart when the binary changed, or when the backend is not running at all.
      if (builtAt === this.builtAt && this.api?.done === false) continue;
      this.builtAt = builtAt;
      const previous = this.api;
      if (previous !== undefined) {
        this.retired.add(previous);
        killTree(previous, 'SIGTERM');
        if (!(await waitFor(previous, RELOAD_GRACE_MS))) {
          killTree(previous, 'SIGKILL');
          await waitFor(previous, KILL_WAIT_MS);
        }
      }
      if (this.isStopping()) break;
      const copy = this.copyBinary(executable);
      this.apiCopy = copy;
      const api = this.startApi(copy, () => {
        info('[dev] api restarted');
      });
      this.api = api;
      this.watchApiExit(api, copy);
    } while (this.isRebuildPending() && !this.isStopping());
    this.reloading = false;
  }

  // ------------------------------------------------------------ lifecycle

  async start(): Promise<void> {
    this.snapshot = this.scan();
    const { ok, executable } = await this.runBuild();
    if (this.isStopping()) return;
    if (!ok || executable === undefined) {
      info('[dev] api build failed');
      await this.stop(1);
      return;
    }
    this.builtAt = mtimeOf(executable) ?? 0;
    const readyDeadline = Date.now() + READY_LIMIT_MS;
    const copy = this.copyBinary(executable);
    this.apiCopy = copy;
    const apiState = { listening: false };
    const api = this.startApi(copy, () => {
      apiState.listening = true;
    });
    this.api = api;
    this.watchApiExit(api, copy);
    this.web = this.startWeb();
    while (!this.isStopping()) {
      if (apiState.listening && (await this.webAnswers())) break;
      if (Date.now() > readyDeadline) {
        info('[dev] not ready after 120 seconds; stopping');
        await this.stop(1);
        return;
      }
      await delay(250);
    }
    if (this.isStopping()) return;
    this.firstReady = true;
    info(readyLine(this.settings));
    this.startWatching();
  }

  async stop(code: number): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.stopStartedAt = Date.now();
    info('[dev] stopping');
    if (this.watchTimer !== undefined) clearInterval(this.watchTimer);
    const children = [this.build, this.api, this.web].filter(
      (running): running is Running => running !== undefined,
    );
    for (const running of children) killTree(running, isWindows ? 'SIGKILL' : 'SIGTERM');
    const settled = await Promise.all(children.map((running) => waitFor(running, STOP_GRACE_MS)));
    if (settled.includes(false)) {
      if (!this.forced) info('[dev] forcing stop');
      this.forced = true;
      for (const running of children) killTree(running, 'SIGKILL');
      await Promise.all(children.map((running) => waitFor(running, KILL_WAIT_MS)));
    }
    await this.removeCopy(this.apiCopy);
    tryRemove(this.binDir);
    await Promise.all([this.webOutput.close(), this.apiOutput.close()]);
    this.stdin?.close();
    process.stdin.pause();
    info('[dev] stopped');
    this.finished(code);
  }
}

async function main(): Promise<number> {
  const parsed = parseDevArgs(process.argv.slice(2), process.cwd(), {
    stateDir: join(repoRoot, '.dev'),
    apiDir: repoRoot,
  });
  if ('error' in parsed) {
    fatal(parsed.error);
    return 1;
  }
  try {
    if (parsed.envFile === undefined) loadEnvFile({ required: true });
    else loadEnvFile({ path: parsed.envFile, required: true });
  } catch (error) {
    const missing = error instanceof Error && error.message.startsWith('env file not found');
    if (!missing) fatal(`[dev] cannot read env file: ${parsed.envFile ?? '.env'}`);
    else if (parsed.envFile === undefined) {
      fatal('[dev] .env not found; copy .env.example to .env and fill in the values');
    } else fatal(`[dev] env file not found: ${parsed.envFile}`);
    return 1;
  }
  const settings = validateDevEnv(process.env, DEFAULT_POSTGRES_PORT);
  if ('errors' in settings) {
    for (const error of settings.errors) fatal(error);
    return 1;
  }
  const conflicts = (
    await Promise.all([
      portProblem('WEB_DEV_PORT', '127.0.0.1', settings.webPort),
      portProblem('APP_PORT', settings.apiHost, settings.apiPort),
    ])
  ).filter((problem): problem is string => problem !== undefined);
  if (conflicts.length > 0) {
    for (const conflict of conflicts) fatal(conflict);
    return 1;
  }
  const supervisor = new Supervisor(parsed, settings);
  if (!(await connectProbe(settings.postgresPort, 1000))) {
    info(
      `[dev] PostgreSQL is not reachable on 127.0.0.1:${String(settings.postgresPort)}; run "bun run db:up" when you need the database`,
    );
  }
  supervisor.listenForStop();
  void supervisor.start();
  return supervisor.result;
}

// Last resort: an unexpected error in the supervisor still stops every child it started.
function crash(error: unknown): never {
  fatal(`[dev] internal error: ${error instanceof Error ? error.message : String(error)}`);
  for (const running of started) killTree(running, 'SIGKILL');
  process.exit(1);
}

if (import.meta.main) {
  process.on('uncaughtException', crash);
  process.on('unhandledRejection', crash);
  process.exit(await main());
}
