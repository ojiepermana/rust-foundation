// Guards every Angular CLI script: the CLI, build, and tests must run on real
// Node.js (never the Bun runtime), on the major pinned in `.nvmrc`, and at or
// above the lower bound of `engines.node` in the root `package.json`.
// Bun silently swaps in its own runtime when `node` is missing from PATH or
// when `--bun` is used, so this check runs before `ng` in apps/web scripts.
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(text ?? '').trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function lowerBound(enginesNode) {
  const match = />=\s*(v?\d+\.\d+\.\d+)/.exec(String(enginesNode ?? ''));
  return match ? parseVersion(match[1]) : null;
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export function checkRuntime({ versions, nvmrc, enginesNode }) {
  const pinnedText = String(nvmrc ?? '').trim();
  if (versions.bun !== undefined) {
    return {
      ok: false,
      reason: `Angular tooling must run on Node.js, but this process runs on the Bun runtime ${versions.bun}. Put Node.js ${pinnedText} on PATH and do not use "bun --bun".`,
    };
  }
  const current = parseVersion(versions.node);
  if (!current) {
    return { ok: false, reason: `cannot read the Node.js version (found "${versions.node}").` };
  }
  const pinned = parseVersion(pinnedText);
  if (!pinned) {
    return { ok: false, reason: `.nvmrc does not hold a version (found "${pinnedText}").` };
  }
  const minimum = lowerBound(enginesNode);
  if (!minimum) {
    return {
      ok: false,
      reason: `engines.node in package.json has no ">=" lower bound (found "${enginesNode}").`,
    };
  }
  if (current[0] !== pinned[0]) {
    return {
      ok: false,
      reason: `Node.js ${versions.node} found, but .nvmrc pins major ${pinned[0]} (${pinnedText}).`,
    };
  }
  if (compareVersions(current, minimum) < 0) {
    return {
      ok: false,
      reason: `Node.js ${versions.node} found, but engines.node requires ${enginesNode}.`,
    };
  }
  return { ok: true };
}

function readRootInputs() {
  const root = new URL('../', import.meta.url);
  const nvmrc = readFileSync(new URL('.nvmrc', root), 'utf8');
  const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  return { nvmrc, enginesNode: manifest.engines?.node };
}

// True when this file is the entry point. If the paths cannot be resolved the
// check still compares plain absolute paths, so the guard fails closed rather
// than silently skipping itself.
function runsAsScript() {
  if (!process.argv[1]) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(process.argv[1]) === realpathSync(self);
  } catch {
    return resolve(process.argv[1]) === resolve(self);
  }
}

if (runsAsScript()) {
  let result;
  try {
    result = checkRuntime({ versions: process.versions, ...readRootInputs() });
  } catch (error) {
    result = { ok: false, reason: `cannot read .nvmrc or package.json: ${error.message}` };
  }
  if (!result.ok) {
    process.stderr.write(`guard-node: ${result.reason}\n`);
    process.exit(1);
  }
}
