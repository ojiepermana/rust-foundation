// Generated files live only under the roots listed in `generated-roots.json`.
// A generator writes `.generated-manifest.json` in its root with a SHA-256 hash
// per file; `verifyGeneratedRoot` rejects any file added, removed, or edited by
// hand afterwards.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const MANIFEST_FILE = '.generated-manifest.json';

export interface GeneratedManifest {
  generator: string;
  files: Record<string, string>;
}

interface RootEntries {
  files: string[];
  links: string[];
}

// Symbolic links are collected separately: a generator never writes them, and
// following one could hide a hand written file outside the root.
function listEntries(
  directory: string,
  found: RootEntries = { files: [], links: [] },
): RootEntries {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) found.links.push(path);
    else if (entry.isDirectory()) listEntries(path, found);
    else if (entry.isFile()) found.files.push(path);
  }
  return found;
}

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function toManifestPath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/');
}

export function hashGeneratedRoot(root: string): Record<string, string> {
  const { files, links } = listEntries(root);
  if (links.length > 0) {
    throw new Error(`${root}: symbolic links are not allowed in a generated root`);
  }
  const hashes: Record<string, string> = {};
  for (const path of files.sort()) {
    const name = toManifestPath(root, path);
    if (name !== MANIFEST_FILE) hashes[name] = hashFile(path);
  }
  return hashes;
}

export function writeGeneratedManifest(root: string, generator: string): GeneratedManifest {
  const manifest: GeneratedManifest = { generator, files: hashGeneratedRoot(root) };
  writeFileSync(join(root, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function verifyGeneratedRoot(root: string): string[] {
  if (!existsSync(root) || !statSync(root).isDirectory()) return [];
  const manifestPath = join(root, MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    return [`${root}: ${MANIFEST_FILE} is missing; regenerate the files with their generator`];
  }
  const links = listEntries(root).links;
  if (links.length > 0) {
    return links.map(
      (path) => `${root}/${toManifestPath(root, path)}: symbolic links are not allowed`,
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as GeneratedManifest;
  const recorded = manifest.files;
  const actual = hashGeneratedRoot(root);
  const problems: string[] = [];
  for (const [name, hash] of Object.entries(actual)) {
    const expected = recorded[name];
    if (expected === undefined) problems.push(`${root}/${name}: not written by the generator`);
    else if (expected !== hash) problems.push(`${root}/${name}: edited by hand after generation`);
  }
  for (const name of Object.keys(recorded)) {
    if (!(name in actual)) problems.push(`${root}/${name}: removed after generation`);
  }
  return problems;
}

export function readGeneratedRoots(repoRoot: string): string[] {
  const config = JSON.parse(readFileSync(join(repoRoot, 'generated-roots.json'), 'utf8')) as {
    roots: string[];
  };
  return config.roots;
}
