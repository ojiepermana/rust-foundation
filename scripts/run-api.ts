// `bun run run:api`: runs only the backend with the root .env loaded (spec 0004).
import { spawn } from 'node:child_process';
import { exitStatus } from './dev-support';
import { loadEnvFile } from './env-file';

loadEnvFile();

const child = spawn('cargo', ['run', '--locked', '-p', 'api'], { stdio: 'inherit' });

// Ctrl+C reaches cargo and the backend through the terminal, so this script only waits.
// SIGTERM and SIGHUP are sent to this process alone, so they are passed on to cargo.
process.on('SIGINT', () => undefined);
for (const signal of ['SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
child.once('error', (error) => {
  process.stderr.write(`run-api: cannot start cargo: ${error.message}\n`);
  process.exit(1);
});
child.once('exit', (code, signal) => {
  process.exit(exitStatus(code, signal));
});
