import { expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { repoRoot } from '../../scripts/test-helpers';

// Spec 0004: `bun run run:api` loads the env, runs the backend, and passes SIGTERM on to it.
const STEP_TIMEOUT_MS = 6 * 60 * 1000;
const INHERITED = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'USER', 'CARGO_HOME', 'RUSTUP_HOME', 'CI'];

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

// covers: 0004 run:api
test.skipIf(process.platform === 'win32')(
  'run:api passes SIGTERM on to the backend and exits with its status',
  async () => {
    const port = await freePort();
    const env: Record<string, string> = {};
    for (const name of INHERITED) {
      const value = process.env[name];
      if (value !== undefined) env[name] = value;
    }
    const child = spawn(process.execPath, ['--no-env-file', 'scripts/run-api.ts'], {
      cwd: repoRoot,
      env: {
        ...env,
        APP_ENV: 'development',
        APP_HOST: '127.0.0.1',
        APP_PORT: String(port),
        DATABASE_URL: 'postgres://app:placeholder@127.0.0.1:5432/app_test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      output += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      output += chunk;
    });
    const exited = new Promise<number | null>((done) => {
      child.once('exit', (code, signal) => {
        done(code ?? (signal === 'SIGTERM' ? 143 : null));
      });
    });
    const deadline = Date.now() + STEP_TIMEOUT_MS - 30_000;
    while (!output.includes(`api listening on http://127.0.0.1:${String(port)}`)) {
      if (Date.now() > deadline || child.exitCode !== null) {
        throw new Error(`run:api did not start\n${output.slice(-4000)}`);
      }
      await Bun.sleep(100);
    }
    child.kill('SIGTERM');
    expect(await exited).toBe(143);
    await Bun.sleep(200);
    expect(await bindable(port)).toBe(true);
  },
  STEP_TIMEOUT_MS,
);
