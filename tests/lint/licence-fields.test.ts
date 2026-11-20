import { createHash } from 'node:crypto';
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, loadDocument, tableWithHeadings } from '../docs/markdown.js';

function read(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), 'utf8');
}

function assignedLicences(): Map<string, string> {
  const table = tableWithHeadings(loadDocument('LICENSING.md'), ['Path', 'Licence']);
  return new Map(
    table.rows.map((row) => [
      (row[0] ?? '').replaceAll('`', ''),
      (row[1] ?? '').replaceAll('`', ''),
    ]),
  );
}

function manifests(): string[] {
  return [
    'package.json',
    ...globSync('{apps,packages,tools,examples,sdks}/*/package.json', { cwd: REPO_ROOT }),
    'tests/package.json',
  ].sort();
}

function licenceFor(table: Map<string, string>, manifest: string): string | undefined {
  const directory = path.dirname(manifest);
  return table.get(directory) ?? table.get(`${path.dirname(directory)}/*`);
}

describe('licence fields', () => {
  it('gives every workspace manifest the licence LICENSING.md assigns its directory', () => {
    const table = assignedLicences();
    for (const manifest of manifests()) {
      const parsed: unknown = JSON.parse(read(manifest));
      const field =
        typeof parsed === 'object' && parsed !== null && 'license' in parsed
          ? parsed.license
          : undefined;
      expect(field, manifest).toBe(licenceFor(table, manifest));
    }
  });

  it('has no manifest the table does not cover', () => {
    const table = assignedLicences();
    const uncovered = manifests().filter((manifest) => licenceFor(table, manifest) === undefined);
    expect(uncovered).toEqual([]);
  });

  it('ships both licence texts unaltered', () => {
    const digest = (relative: string) =>
      createHash('sha256')
        .update(readFileSync(path.join(REPO_ROOT, relative)))
        .digest('hex');
    expect(read('LICENSE').length).toBe(34523);
    expect(digest('LICENSE')).toBe(
      '0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0',
    );
    expect(read('LICENSES/Apache-2.0.txt').length).toBe(11358);
    expect(digest('LICENSES/Apache-2.0.txt')).toBe(
      'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
    );
  });

  it('licenses any package under the Apache directories as Apache-2.0', () => {
    const found = globSync('{examples,sdks,apps/docs/content}/**/package.json', {
      cwd: REPO_ROOT,
      exclude: (name) => name === 'node_modules',
    });
    for (const manifest of found) {
      const parsed: unknown = JSON.parse(read(manifest));
      const field =
        typeof parsed === 'object' && parsed !== null && 'license' in parsed
          ? parsed.license
          : undefined;
      expect(field, manifest).toBe('Apache-2.0');
    }
  });

  it('keeps the name and mark out of both licences', () => {
    expect(read('LICENSING.md')).toContain('The name Odudu and the staff mark are not licensed');
  });
});
