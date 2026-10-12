// Fixture for tests/integration/postgres.test.ts (AC-6): starts a temporary project through
// the harness, prints `ready <project>`, then waits until a signal stops the process.
import { startPostgres } from '../../../scripts/testing/postgres';

const database = await startPostgres();
process.stdout.write(`ready ${database.project}\n`);
setInterval(() => undefined, 60_000);
