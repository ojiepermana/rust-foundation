// `bun run check:generated`: fails when any generated root holds a file that its
// generator did not write exactly as recorded in the manifest.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGeneratedRoots, verifyGeneratedRoot } from './generated';

// An explicit directory argument lets tests point the check at a fixture repo.
const repoRoot = process.argv[2] ?? fileURLToPath(new URL('../', import.meta.url));
const problems = readGeneratedRoots(repoRoot).flatMap((root) =>
  verifyGeneratedRoot(join(repoRoot, root)).map((problem) => problem.replace(repoRoot, '')),
);

if (problems.length > 0) {
  process.stderr.write(`check-generated: generated files must not be edited by hand\n`);
  for (const problem of problems) process.stderr.write(`  ${problem}\n`);
  process.exit(1);
}
