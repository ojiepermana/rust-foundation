// Loads a dotenv file into process.env for root scripts that run with `bun --no-env-file`
// (spec 0003). Values already set and not empty in the process environment win; an empty
// value counts as not set, so the file value applies. No `$VAR` expansion is done.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export interface LoadEnvFileOptions {
  // Path of the file, relative to the working directory. Defaults to `.env` in the repo root.
  path?: string;
  // Throw when the file does not exist, even for the default path.
  required?: boolean;
}

export interface LoadEnvFileResult {
  loaded: boolean;
  path: string;
}

const defaultEnvPath = fileURLToPath(new URL('../.env', import.meta.url));

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export function loadEnvFile(options: LoadEnvFileOptions = {}): LoadEnvFileResult {
  const explicit = options.path !== undefined;
  const path = explicit ? resolve(process.cwd(), options.path ?? '') : defaultEnvPath;
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch (error) {
    if (isMissingFile(error)) {
      if (explicit || options.required === true) {
        throw new Error(`env file not found: ${path}`, { cause: error });
      }
      return { loaded: false, path };
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot read env file ${path}: ${reason}`, { cause: error });
  }
  for (const [name, value] of Object.entries(parseEnv(content))) {
    const current = process.env[name];
    if (current === undefined || current === '') process.env[name] = value;
  }
  return { loaded: true, path };
}
