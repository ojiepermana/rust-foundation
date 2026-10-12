// Points git at the committed `.githooks` folder. Runs from the root `prepare`
// script on every install; outside a git work tree (for example an unpacked
// archive) it does nothing, so installs never fail because of hooks.
import { spawnSync } from 'node:child_process';

const insideWorkTree = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
  encoding: 'utf8',
});

if (insideWorkTree.status === 0 && insideWorkTree.stdout.trim() === 'true') {
  const result = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' });
  if (result.status !== 0) {
    process.stderr.write('install-hooks: could not set core.hooksPath to .githooks\n');
    process.exit(result.status ?? 1);
  }
}
