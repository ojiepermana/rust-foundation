import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { repoRoot } from '../../scripts/test-helpers';

// Spec 0004, AC-3 to AC-8: the dev supervisor started for real, with free ports, a temporary
// env file and state dir, no developer .env, and no Docker.
const isWindows = process.platform === 'win32';
const STEP_TIMEOUT_MS = 6 * 60 * 1000;
const READY_TIMEOUT_MS = 4 * 60 * 1000;

// Variables a child needs from the outside; everything else (APP_*, DATABASE_*, POSTGRES_*,
// NODE_ENV, GIT_*, COMPOSE_*, WEB_DEV_PORT) is left out on purpose.
const INHERITED = [
  'PATH',
  'Path',
  'PATHEXT',
  'HOME',
  'USERPROFILE',
  'SYSTEMROOT',
  'SystemRoot',
  'COMSPEC',
  'ComSpec',
  'TEMP',
  'TMP',
  'TMPDIR',
  'APPDATA',
  'LOCALAPPDATA',
  'LANG',
  'USER',
  'USERNAME',
  'CARGO_HOME',
  'RUSTUP_HOME',
  'BUN_INSTALL',
  'CI',
];

function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of INHERITED) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => {
        done(port);
      });
    });
  });
}

async function distinctPorts(count: number): Promise<number[]> {
  const ports: number[] = [];
  while (ports.length < count) {
    const port = await freePort();
    if (port >= 1024 && !ports.includes(port)) ports.push(port);
  }
  return ports;
}

function listen(port: number): Promise<Server> {
  return new Promise((done, fail) => {
    const server = createServer((socket) => socket.destroy());
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => {
      done(server);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((done) => {
    server.close(() => {
      done();
    });
  });
}

function bindable(port: number): Promise<boolean> {
  return new Promise((done) => {
    const server = createServer();
    server.once('error', () => {
      done(false);
    });
    server.listen(port, '127.0.0.1', () => {
      server.close(() => {
        done(true);
      });
    });
  });
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killTree(pid: number): void {
  if (isWindows) {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    process.kill(pid, 'SIGTERM');
  }
}

interface DevRun {
  child: ChildProcess;
  output: () => string;
  waitFor: (text: string, timeoutMs?: number) => Promise<void>;
  exited: Promise<number | null>;
  pid: (service: 'web' | 'api') => number;
}

const scratch = mkdtempSync(join(tmpdir(), 'foundation-dev-test-'));
let counter = 0;
const running: DevRun[] = [];

interface Ports {
  api: number;
  web: number;
  postgres: number;
}

function writeEnv(ports: Ports, extra: Record<string, string> = {}): string {
  counter += 1;
  const path = join(scratch, `env-${String(counter)}`);
  const values: Record<string, string> = {
    APP_ENV: 'development',
    APP_HOST: '127.0.0.1',
    APP_PORT: String(ports.api),
    WEB_DEV_PORT: String(ports.web),
    POSTGRES_PORT: String(ports.postgres),
    DATABASE_URL: 'postgres://app:placeholder@127.0.0.1:5432/app_test',
    ...extra,
  };
  writeFileSync(
    path,
    Object.entries(values)
      .map(([name, value]) => `${name}=${value}\n`)
      .join(''),
  );
  return path;
}

function startDev(
  args: string[],
  options: { viaBunRun?: boolean; env?: Record<string, string> } = {},
): DevRun {
  const command =
    options.viaBunRun === true
      ? ['run', 'dev', ...args]
      : ['--no-env-file', 'scripts/dev.ts', ...args];
  const child = spawn(process.execPath, command, {
    cwd: repoRoot,
    env: { ...childEnv(), ...options.env },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: options.viaBunRun === true && !isWindows,
  });
  let text = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    text += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    text += chunk;
  });
  const exited = new Promise<number | null>((done) => {
    child.once('exit', (code) => {
      done(code);
    });
  });
  const run: DevRun = {
    child,
    exited,
    output: () => text,
    waitFor: async (expected, timeoutMs = READY_TIMEOUT_MS) => {
      const deadline = Date.now() + timeoutMs;
      while (!text.includes(expected)) {
        if (Date.now() > deadline)
          throw new Error(`timed out waiting for "${expected}"\n${text.slice(-4000)}`);
        if (child.exitCode !== null)
          throw new Error(`dev exited before "${expected}"\n${text.slice(-4000)}`);
        await Bun.sleep(100);
      }
    },
    pid: (service) => {
      const match = new RegExp(`\\[dev\\] started ${service} \\(pid (\\d+)\\)`).exec(text);
      if (match?.[1] === undefined) throw new Error(`no pid line for ${service}`);
      return Number(match[1]);
    },
  };
  running.push(run);
  return run;
}

async function stopWithQ(run: DevRun): Promise<number | null> {
  run.child.stdin?.write('q\n');
  return run.exited;
}

function linesOf(text: string): string[] {
  return text.split('\n').filter((line) => line !== '');
}

// Stops whatever a failed test left running: q first, then the printed child pids and the
// supervisor itself, and waits so the scratch folder is not removed under a live process.
afterEach(async () => {
  for (const run of running.splice(0)) {
    if (run.child.exitCode !== null) continue;
    run.child.stdin?.write('q\n');
    const stopped = await Promise.race([
      run.exited.then(() => true),
      Bun.sleep(15_000).then(() => false),
    ]);
    if (stopped) continue;
    for (const service of ['web', 'api'] as const) {
      try {
        killTree(run.pid(service));
      } catch {
        // No pid line or already gone.
      }
    }
    run.child.kill('SIGKILL');
    await run.exited;
  }
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('bun run dev', () => {
  // covers: 0004 AC-3, AC-6, AC-7, AC-8
  test(
    'serves web, proxies /api to the backend, logs per service, and stops cleanly with q',
    async () => {
      const [api = 0, web = 0, postgres = 0] = await distinctPorts(3);
      const stateDir = join(scratch, 'state-main');
      const run = startDev([
        '--env-file',
        writeEnv({ api, web, postgres }),
        '--state-dir',
        stateDir,
      ]);
      await run.waitFor('[dev] ready:');
      expect(run.output()).toContain(
        `[dev] ready: web http://127.0.0.1:${String(web)}, api http://127.0.0.1:${String(api)}`,
      );
      expect(run.output()).toContain(
        `[dev] PostgreSQL is not reachable on 127.0.0.1:${String(postgres)}; run "bun run db:up" when you need the database`,
      );

      const index = await fetch(`http://127.0.0.1:${String(web)}/`);
      expect(index.status).toBe(200);
      expect(await index.text()).toContain('<app-root');
      const config = await fetch(`http://127.0.0.1:${String(web)}/config.json`);
      expect(await config.json()).toEqual({ apiBaseUrl: '/api' });
      const proxied = await fetch(
        `http://127.0.0.1:${String(web)}/api/no-such-route-${String(Date.now())}`,
      );
      expect(proxied.status).toBe(404);
      expect(await proxied.text()).toBe('');
      const notProxied = await fetch(`http://127.0.0.1:${String(web)}/apiary`);
      expect(await notProxied.text()).toContain('<app-root');

      const pids = [run.pid('web'), run.pid('api')];
      expect(await stopWithQ(run)).toBe(0);
      const lines = linesOf(run.output());
      for (const line of lines) expect(line).toMatch(/^\[(dev|api|web)\] /);
      expect(lines.at(-1)).toBe('[dev] stopped');
      expect(lines.indexOf('[dev] stopping')).toBeGreaterThan(
        lines.findIndex((line) => line.startsWith('[dev] ready:')),
      );
      expect(readFileSync(join(stateDir, 'logs', 'api.log'), 'utf8')).toContain('api listening on');
      expect(readFileSync(join(stateDir, 'logs', 'web.log'), 'utf8').length).toBeGreaterThan(0);
      expect(existsSync(join(stateDir, 'bin')) ? readdirSync(join(stateDir, 'bin')) : []).toEqual(
        [],
      );
      await Bun.sleep(200);
      for (const pid of pids) expect(alive(pid)).toBe(false);
      expect(await bindable(api)).toBe(true);
      expect(await bindable(web)).toBe(true);
    },
    STEP_TIMEOUT_MS,
  );

  // covers: 0004 AC-4
  test(
    'reports every busy port and starts nothing',
    async () => {
      const [api = 0, web = 0, postgres = 0] = await distinctPorts(3);
      const blockers = [await listen(api), await listen(web)];
      try {
        const stateDir = join(scratch, 'state-ports');
        const run = startDev([
          '--env-file',
          writeEnv({ api, web, postgres }),
          '--state-dir',
          stateDir,
        ]);
        expect(await run.exited).toBe(1);
        const output = run.output();
        expect(output).toMatch(
          new RegExp(
            `\\[dev\\] WEB_DEV_PORT=${String(web)} is already in use \\((EADDRINUSE|accepting connections)\\); set WEB_DEV_PORT in \\.env`,
          ),
        );
        expect(output).toMatch(
          new RegExp(
            `\\[dev\\] APP_PORT=${String(api)} is already in use \\((EADDRINUSE|accepting connections)\\); set APP_PORT in \\.env`,
          ),
        );
        expect(output).not.toContain('[dev] started');
        expect(output).not.toContain('[api]');
        expect(output).not.toContain('[web]');
        expect(existsSync(join(stateDir, 'bin'))).toBe(false);
      } finally {
        await Promise.all(blockers.map(close));
      }
    },
    STEP_TIMEOUT_MS,
  );

  // covers: 0004 AC-4
  test('rejects invalid variables, a missing env file, and unknown options before starting anything', async () => {
    const [api = 0, postgres = 0] = await distinctPorts(2);
    const invalid = startDev([
      '--env-file',
      writeEnv({ api, web: api, postgres }, { APP_ENV: 'production', POSTGRES_PORT: '80' }),
    ]);
    expect(await invalid.exited).toBe(1);
    expect(invalid.output()).toContain('[dev] APP_ENV: must be development for bun run dev');
    expect(invalid.output()).toContain('[dev] WEB_DEV_PORT: must differ from APP_PORT');
    expect(invalid.output()).toContain(
      '[dev] POSTGRES_PORT: must be an integer from 1024 to 65535',
    );
    expect(invalid.output()).not.toContain('[dev] started');

    const missing = startDev(['--env-file', join(scratch, 'no-such.env')]);
    expect(await missing.exited).toBe(1);
    expect(missing.output()).toContain(`[dev] env file not found: ${join(scratch, 'no-such.env')}`);

    const unknown = startDev(['--verbose']);
    expect(await unknown.exited).toBe(1);
    expect(unknown.output()).toContain('[dev] unknown option: --verbose');
  });

  // covers: 0004 AC-7
  test(
    'stops everything with status 1 when the backend exits before it is ready',
    async () => {
      const [api = 0, web = 0, postgres = 0] = await distinctPorts(3);
      const run = startDev([
        '--env-file',
        writeEnv({ api, web, postgres }, { DATABASE_URL: 'not-a-url' }),
        '--state-dir',
        join(scratch, 'state-early-exit'),
      ]);
      expect(await run.exited).toBe(1);
      expect(run.output()).toContain(
        '[dev] api exited with status 78 before it was ready; stopping',
      );
      expect(run.output()).toContain('[dev] stopped');
      expect(await bindable(web)).toBe(true);
    },
    STEP_TIMEOUT_MS,
  );

  // covers: 0004 AC-7
  test(
    'stops everything with status 1 when the dev server exits by itself',
    async () => {
      const [api = 0, web = 0, postgres = 0] = await distinctPorts(3);
      const run = startDev([
        '--env-file',
        writeEnv({ api, web, postgres }),
        '--state-dir',
        join(scratch, 'state-web-exit'),
      ]);
      await run.waitFor('[dev] ready:');
      const apiPid = run.pid('api');
      killTree(run.pid('web'));
      expect(await run.exited).toBe(1);
      expect(run.output()).toMatch(/\[dev\] web exited with status \d+; stopping/);
      await Bun.sleep(200);
      expect(alive(apiPid)).toBe(false);
      expect(await bindable(api)).toBe(true);
      expect(await bindable(web)).toBe(true);
    },
    STEP_TIMEOUT_MS,
  );

  // covers: 0004 AC-7 (POSIX terminal Ctrl+C sends SIGINT twice through bun run)
  test.skipIf(isWindows)(
    'Ctrl+C on the bun run dev process group stops with status 0 and no forced stop',
    async () => {
      const [api = 0, web = 0, postgres = 0] = await distinctPorts(3);
      const run = startDev(
        [
          '--env-file',
          writeEnv({ api, web, postgres }),
          '--state-dir',
          join(scratch, 'state-sigint'),
        ],
        { viaBunRun: true },
      );
      await run.waitFor('[dev] ready:');
      const pids = [run.pid('web'), run.pid('api')];
      process.kill(-(run.child.pid ?? 0), 'SIGINT');
      expect(await run.exited).toBe(0);
      expect(run.output()).toContain('[dev] stopped');
      expect(run.output()).not.toContain('[dev] forcing stop');
      await Bun.sleep(200);
      for (const pid of pids) expect(alive(pid)).toBe(false);
      expect(await bindable(api)).toBe(true);
    },
    STEP_TIMEOUT_MS,
  );

  // covers: 0004 AC-7 (review finding: the group outlives its leader)
  test.skipIf(isWindows)(
    'stops the whole dev server group when only its bun run leader is killed',
    async () => {
      const [api = 0, web = 0, postgres = 0] = await distinctPorts(3);
      const run = startDev([
        '--env-file',
        writeEnv({ api, web, postgres }),
        '--state-dir',
        join(scratch, 'state-leader-kill'),
      ]);
      await run.waitFor('[dev] ready:');
      process.kill(run.pid('web'), 'SIGKILL');
      expect(await run.exited).toBe(1);
      expect(run.output()).toContain('[dev] web exited with status 137; stopping');
      await Bun.sleep(200);
      expect(await bindable(web)).toBe(true);
      expect(await bindable(api)).toBe(true);
    },
    STEP_TIMEOUT_MS,
  );

  // covers: 0004 AC-7 (POSIX signals sent to the supervisor alone)
  test.skipIf(isWindows).each(['SIGTERM', 'SIGHUP'] as const)(
    '%s stops everything with status 0',
    async (signal) => {
      const [api = 0, web = 0, postgres = 0] = await distinctPorts(3);
      const run = startDev([
        '--env-file',
        writeEnv({ api, web, postgres }),
        '--state-dir',
        join(scratch, `state-${signal}`),
      ]);
      await run.waitFor('[dev] ready:');
      const pids = [run.pid('web'), run.pid('api')];
      run.child.kill(signal);
      expect(await run.exited).toBe(0);
      expect(run.output()).toContain('[dev] stopped');
      await Bun.sleep(200);
      for (const pid of pids) expect(alive(pid)).toBe(false);
    },
    STEP_TIMEOUT_MS,
  );

  // covers: 0004 AC-4, AC-7 (a missing toolchain is reported, not swallowed)
  test.skipIf(isWindows)('reports a cargo it cannot start and stops with status 1', async () => {
    const [api = 0, web = 0, postgres = 0] = await distinctPorts(3);
    const run = startDev(
      [
        '--env-file',
        writeEnv({ api, web, postgres }),
        '--state-dir',
        join(scratch, 'state-no-cargo'),
      ],
      { env: { PATH: dirname(process.execPath) } },
    );
    expect(await run.exited).toBe(1);
    expect(run.output()).toMatch(/\[dev\] cannot start cargo: /);
    expect(run.output()).toContain('[dev] api build failed');
    expect(run.output()).not.toContain('[dev] started web');
  });

  // covers: 0004 AC-4
  test('reports an env file it cannot read', async () => {
    const run = startDev(['--env-file', scratch]);
    expect(await run.exited).toBe(1);
    expect(run.output()).toContain(`[dev] cannot read env file: ${scratch}`);
  });

  // covers: 0004 AC-3 (Angular runs on the Node.js that bun run recorded in NODE)
  test.skipIf(isWindows)(
    'runs the dev server on the node recorded in NODE when PATH lists another node first',
    async () => {
      const realNode = Bun.which('node');
      if (realNode === null) throw new Error('node is not on PATH');
      const fakeBin = join(scratch, 'fake-node-bin');
      mkdirSync(fakeBin, { recursive: true });
      writeFileSync(join(fakeBin, 'node'), '#!/bin/sh\necho "fake node" >&2\nexit 1\n', {
        mode: 0o755,
      });
      const [api = 0, web = 0, postgres = 0] = await distinctPorts(3);
      const run = startDev(
        [
          '--env-file',
          writeEnv({ api, web, postgres }),
          '--state-dir',
          join(scratch, 'state-node-pin'),
        ],
        { env: { PATH: `${fakeBin}:${process.env.PATH ?? ''}`, NODE: realNode } },
      );
      await run.waitFor('[dev] ready:');
      expect(run.output()).not.toContain('fake node');
      run.child.stdin?.write('q\n');
      expect(await run.exited).toBe(0);
    },
    STEP_TIMEOUT_MS,
  );
});

describe('backend reload', () => {
  let workspace = '';
  const mainSource = (version: string) => `use std::io::{Read, Write};
use std::net::TcpListener;

fn main() {
    let host = std::env::var("APP_HOST").expect("APP_HOST");
    let port = std::env::var("APP_PORT").expect("APP_PORT");
    let listener = TcpListener::bind(format!("{host}:{port}")).expect("bind");
    println!("api listening on http://{}", listener.local_addr().expect("address"));
    for stream in listener.incoming() {
        let Ok(mut stream) = stream else { continue };
        let mut buffer = [0u8; 4096];
        let read = stream.read(&mut buffer).unwrap_or(0);
        if String::from_utf8_lossy(&buffer[..read]).starts_with("GET /api/exit ") {
            std::process::exit(3);
        }
        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\\r\\ncontent-length: 2\\r\\nconnection: close\\r\\n\\r\\n${version}");
    }
}
`;

  beforeAll(() => {
    workspace = join(scratch, 'api-workspace');
    mkdirSync(join(workspace, 'apps', 'api', 'src'), { recursive: true });
    copyFileSync(join(repoRoot, 'rust-toolchain.toml'), join(workspace, 'rust-toolchain.toml'));
    writeFileSync(
      join(workspace, 'Cargo.toml'),
      '[workspace]\nresolver = "3"\nmembers = ["apps/api"]\n',
    );
    writeFileSync(
      join(workspace, 'apps', 'api', 'Cargo.toml'),
      '[package]\nname = "api"\nversion = "0.1.0"\nedition = "2024"\npublish = false\n',
    );
    writeFileSync(join(workspace, 'apps', 'api', 'src', 'main.rs'), mainSource('v1'));
    const lock = spawnSync('cargo', ['generate-lockfile', '--offline'], {
      cwd: workspace,
      encoding: 'utf8',
    });
    if (lock.status !== 0) throw new Error(`cargo generate-lockfile failed: ${lock.stderr}`);
  });

  async function version(web: number): Promise<string> {
    const response = await fetch(`http://127.0.0.1:${String(web)}/api/version`);
    return response.text();
  }

  // covers: 0004 AC-5, AC-8
  test(
    'rebuilds and restarts on change, keeps the old backend when the build fails',
    async () => {
      const [api = 0, web = 0, postgres = 0] = await distinctPorts(3);
      const database = await listen(postgres);
      try {
        const run = startDev([
          '--env-file',
          writeEnv({ api, web, postgres }),
          '--state-dir',
          join(scratch, 'state-reload'),
          '--api-dir',
          workspace,
        ]);
        await run.waitFor('[dev] ready:');
        expect(run.output()).not.toContain('PostgreSQL is not reachable');
        expect(await version(web)).toBe('v1');

        writeFileSync(join(workspace, 'apps', 'api', 'src', 'main.rs'), mainSource('v2'));
        await run.waitFor('[dev] api restarted');
        expect(await version(web)).toBe('v2');

        writeFileSync(
          join(workspace, 'apps', 'api', 'src', 'main.rs'),
          'fn main() { this does not compile }\n',
        );
        await run.waitFor('[dev] api build failed; previous backend keeps running');
        expect(run.output()).toMatch(/\[api\] error/);
        expect(await version(web)).toBe('v2');

        expect(await stopWithQ(run)).toBe(0);
      } finally {
        await close(database);
        writeFileSync(join(workspace, 'apps', 'api', 'src', 'main.rs'), mainSource('v1'));
      }
    },
    STEP_TIMEOUT_MS,
  );
  // covers: 0004 AC-7 (a backend that stops after it was ready)
  test(
    'reports a backend exit after ready and keeps waiting for changes',
    async () => {
      const [api = 0, web = 0, postgres = 0] = await distinctPorts(3);
      const run = startDev([
        '--env-file',
        writeEnv({ api, web, postgres }),
        '--state-dir',
        join(scratch, 'state-post-ready-exit'),
        '--api-dir',
        workspace,
      ]);
      await run.waitFor('[dev] ready:');
      await fetch(`http://127.0.0.1:${String(web)}/api/exit`).catch(() => undefined);
      await run.waitFor('[dev] api exited with status 3; waiting for changes');
      expect(run.child.exitCode).toBeNull();
      expect((await fetch(`http://127.0.0.1:${String(web)}/`)).status).toBe(200);
      expect(await stopWithQ(run)).toBe(0);
    },
    STEP_TIMEOUT_MS,
  );

  // covers: 0004 AC-7 (a first build that fails)
  test(
    'stops with status 1 when the first build fails, before starting anything',
    async () => {
      const broken = join(scratch, 'broken-workspace');
      cpSync(workspace, broken, { recursive: true });
      rmSync(join(broken, 'target'), { recursive: true, force: true });
      writeFileSync(join(broken, 'apps', 'api', 'src', 'main.rs'), 'fn main() { broken }\n');
      const [api = 0, web = 0, postgres = 0] = await distinctPorts(3);
      const run = startDev([
        '--env-file',
        writeEnv({ api, web, postgres }),
        '--state-dir',
        join(scratch, 'state-first-build'),
        '--api-dir',
        broken,
      ]);
      expect(await run.exited).toBe(1);
      expect(run.output()).toContain('[dev] api build failed');
      expect(run.output()).toContain('[dev] stopped');
      expect(run.output()).not.toContain('[dev] started');
    },
    STEP_TIMEOUT_MS,
  );
});
