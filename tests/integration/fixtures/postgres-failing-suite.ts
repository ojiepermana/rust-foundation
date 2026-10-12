// Fixture suite for tests/integration/postgres.test.ts (AC-6). It starts a temporary project,
// prints `started <project>`, and then fails on purpose, so the parent test can prove the
// afterAll cleanup still removes the project when a test fails. Never part of a normal run:
// bun test only finds *.test.ts files, and this one is run by path.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { startPostgres, type TestPostgres } from '../../../scripts/testing/postgres';

let database: TestPostgres | undefined;

beforeAll(async () => {
  database = await startPostgres();
  process.stdout.write(`started ${database.project}\n`);
}, 180_000);

afterAll(() => {
  database?.stop();
});

test('fails on purpose after the project started', () => {
  expect(database?.project).toBe('a project name that never exists');
});
