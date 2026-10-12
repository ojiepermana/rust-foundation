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
