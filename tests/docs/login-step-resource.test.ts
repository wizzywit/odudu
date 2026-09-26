import { describe, expect, it } from 'vitest';
import { loadDocument } from './markdown.js';

// A login step's row names its authentication session by the sha256 hex of
// the `auth_session_id`, never the id, which would continue the login
// (spec §16 of docs/superpowers/specs/2026-09-26-p4e-audit-events-design.md).
const DOCUMENTS = ['README.md', 'docs/request-paths.md', 'docs/admin-paths.md'] as const;

const TYPE_LINE = /^resource_type\s+\|\s+authentication_session\s*$/u;
const ID_LINE = /^resource_id\s+\|\s+(?<value>\S+)\s*$/u;
const DIGEST = /^[0-9a-f]{64}$/u;

function shownResourceIds(name: string): { line: number; value: string }[] {
  const { lines } = loadDocument(name);
  return lines.flatMap((line, index) => {
    if (!TYPE_LINE.test(line)) return [];
    const value = ID_LINE.exec(lines[index + 1] ?? '')?.groups?.value ?? '';
    return [{ line: index + 2, value }];
  });
}

describe('a login step a transcript shows names its session by a digest', () => {
  it.each(DOCUMENTS)('%s', (name) => {
    const bare = shownResourceIds(name).filter(({ value }) => !DIGEST.test(value));
    expect(bare.map(({ line, value }) => `${name}:${String(line)} shows ${value}`)).toEqual([]);
  });

  it('finds the rows it checks, rather than passing on none', () => {
    expect(DOCUMENTS.flatMap(shownResourceIds).length).toBeGreaterThan(0);
  });
});
