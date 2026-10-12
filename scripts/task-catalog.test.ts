import { describe, expect, test } from 'bun:test';
import { readPackageManifest, readRepoFile } from './test-helpers';

// Spec 0004 AC-1: docs/development.md and the root package.json scripts never drift apart.
interface Row {
  cells: string[];
}

function tableAfter(markdown: string, heading: string): Row[] {
  const lines = markdown.split('\n');
  const start = lines.indexOf(heading);
  if (start === -1) throw new Error(`heading not found: ${heading}`);
  const rows: Row[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('#')) break;
    if (!line.startsWith('|')) continue;
    const cells = line
      .replaceAll('\\|', '\u0000')
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.replaceAll('\u0000', '|').trim());
    rows.push({ cells });
  }
  // The first row is the header and the second the separator.
  return rows.slice(2);
}

function backticked(cell: string): string | undefined {
  return /`([^`]+)`/.exec(cell)?.[1];
}

const markdown = readRepoFile('docs/development.md');
const available = tableAfter(markdown, '## Tersedia');
const reserved = tableAfter(markdown, '## Dicadangkan');
const scripts = readPackageManifest('package.json').scripts ?? {};
const availableNames = available.map((row) => backticked(row.cells[0] ?? ''));
const reservedNames = reserved.map((row) => backticked(row.cells[0] ?? ''));

describe('task catalog', () => {
  test('parses both tables with the expected columns', () => {
    expect(available.length).toBeGreaterThan(0);
    expect(reserved.length).toBeGreaterThan(0);
    for (const row of available) expect(row.cells).toHaveLength(5);
    for (const row of reserved) expect(row.cells).toHaveLength(3);
    expect(availableNames).not.toContain(undefined);
    expect(reservedNames).not.toContain(undefined);
  });

  test('every root script has exactly one Tersedia row with the same command', () => {
    for (const [name, command] of Object.entries(scripts)) {
      const rows = available.filter((row) => backticked(row.cells[0] ?? '') === name);
      expect(rows).toHaveLength(1);
      expect(backticked(rows[0]?.cells[1] ?? '')).toBe(command);
    }
  });

  test('every Tersedia row is a root script', () => {
    for (const name of availableNames) expect(Object.keys(scripts)).toContain(name ?? '');
  });

  test('task names are unique and never in both tables', () => {
    const all = [...availableNames, ...reservedNames];
    expect(new Set(all).size).toBe(all.length);
  });

  test('reserved names are not registered as scripts yet', () => {
    for (const name of reservedNames) expect(Object.keys(scripts)).not.toContain(name ?? '');
  });

  test('prerequisites use the allowed values only', () => {
    for (const row of available)
      expect(['-', 'env', 'docker', 'env, docker']).toContain(row.cells[3] ?? '');
  });

  test('every Bun file or bun test segment in root scripts runs with --no-env-file', () => {
    const offending: string[] = [];
    for (const [name, command] of Object.entries(scripts)) {
      for (const segment of command.split('&&').map((part) => part.trim())) {
        const direct =
          /^bun\s/.test(segment) && !/^bun\s+(run|install|ci|x|add|remove|update)\b/.test(segment);
        if (direct && !segment.includes('--no-env-file')) offending.push(`${name}: ${segment}`);
      }
    }
    expect(offending).toEqual([]);
  });
});
