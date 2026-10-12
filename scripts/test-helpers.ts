import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../', import.meta.url));

export interface PackageManifest {
  name?: string;
  packageManager?: string;
  workspaces?: string[];
  engines?: { node?: string };
  devEngines?: { packageManager?: { name: string; version: string; onFail: string } };
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  overrides?: Record<string, unknown>;
  resolutions?: Record<string, unknown>;
}

export interface CargoManifest {
  package?: {
    name?: string;
    publish?: boolean;
    version?: unknown;
    edition?: unknown;
    'rust-version'?: unknown;
  };
  workspace?: {
    resolver?: string;
    members?: string[];
    package?: { version?: string; edition?: string; 'rust-version'?: string };
    dependencies?: Record<string, unknown>;
    lints?: Record<string, Record<string, unknown>>;
  };
  dependencies?: Record<string, unknown>;
  lints?: { workspace?: boolean };
}

export interface RustToolchainFile {
  toolchain: { channel: string; components?: string[]; profile?: string };
}

export interface Bunfig {
  install?: { linker?: string; exact?: boolean; trustedDependencies?: unknown };
  run?: unknown;
  test?: { root?: string };
}

export interface AngularTarget {
  builder: string;
  options?: Record<string, unknown>;
}

export interface AngularWorkspace {
  cli?: Record<string, unknown>;
  projects: Record<string, { architect: Record<string, AngularTarget> } | undefined>;
}

// Backend configuration names from spec 0002 that have no shared prefix.
const BACKEND_CONFIG_NAMES = new Set([
  'COOKIE_SECURE',
  'CORS_ALLOWED_ORIGINS',
  'DEV_SEED_ENABLED',
  'WEB_API_BASE_URL',
]);

// bun test sets NODE_ENV=test and loads a developer .env and .env.test into the
// test process, and a git hook may export GIT_DIR or GIT_INDEX_FILE. A child
// process must see a normal environment, its own repository only, and no
// backend configuration it did not ask for.
function inheritable(name: string): boolean {
  return !(
    name === 'NODE_ENV' ||
    name.startsWith('GIT_') ||
    name.startsWith('APP_') ||
    name.startsWith('DATABASE_') ||
    name.endsWith('_FILE') ||
    BACKEND_CONFIG_NAMES.has(name)
  );
}

// The environment for a child process: the inheritable part of this process
// plus extraEnv, which wins on conflicts.
export function childEnv(extraEnv: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && inheritable(name)) env[name] = value;
  }
  return { ...env, ...extraEnv };
}

// Files git would put in a commit: tracked plus untracked files that are not ignored.
export function gitVisibleFiles(): string[] {
  const run = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (run.status !== 0) throw new Error(`git ls-files failed: ${run.stderr}`);
  return run.stdout.split('\0').filter(Boolean);
}

export function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8');
}

export function readPackageManifest(path: string): PackageManifest {
  return JSON.parse(readRepoFile(path)) as PackageManifest;
}

export function readAngularWorkspace(path: string): AngularWorkspace {
  return JSON.parse(readRepoFile(path)) as AngularWorkspace;
}

export function readCargoManifest(path: string): CargoManifest {
  return Bun.TOML.parse(readRepoFile(path));
}

export function readRustToolchain(): RustToolchainFile {
  return Bun.TOML.parse(readRepoFile('rust-toolchain.toml')) as RustToolchainFile;
}

export function readBunfig(): Bunfig {
  return Bun.TOML.parse(readRepoFile('bunfig.toml'));
}
