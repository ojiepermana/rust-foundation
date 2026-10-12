// `bun run check:generated`: fails when any generated root holds a file that its
// generator did not write exactly as recorded in the manifest.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGeneratedRoots, verifyGeneratedRoot } from './generated';

// An explicit directory argument lets tests point the check at a fixture repo.
const repoRoot = process.argv[2] ?? fileURLToPath(new URL('../', import.meta.url));
// Problems name files relative to the repo with the root exactly as declared, so the
// output reads the same on every OS.
const problems = readGeneratedRoots(repoRoot).flatMap((root) => {
  const absolute = join(repoRoot, root);
  return verifyGeneratedRoot(absolute).map((problem) =>
    problem.startsWith(absolute) ? `${root}${problem.slice(absolute.length)}` : problem,
  );
});

if (problems.length > 0) {
  process.stderr.write(`check-generated: generated files must not be edited by hand\n`);
  for (const problem of problems) process.stderr.write(`  ${problem}\n`);
  process.exit(1);
}
