import { describe, expect, it } from 'vitest';
import { loadDocument } from './markdown.js';

// A session cookie entry is `<session id>:<secret>` (spec §16 of
// docs/superpowers/specs/2026-09-26-p4e-audit-events-design.md). A
// transcript showing a bare id as the cookie shows the defect that shape
// closed, so it passes only as a capture older than the secret, and only
// with the re-run naming the migration placed right after it.
const DOCUMENTS = ['README.md', 'docs/request-paths.md', 'docs/admin-paths.md'] as const;

const SET_COOKIE = /^set-cookie: [a-z0-9-]+-session(?:-persistent)?=(?<value>[^;]*);/u;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ENTRY = new RegExp(`^${UUID}:[A-Za-z0-9_-]{43}$`, 'u');
const RERUN_WITHIN = 12;

function problems(name: string): string[] {
  const { lines } = loadDocument(name);
  const found: string[] = [];
  lines.forEach((line, index) => {
    const value = SET_COOKIE.exec(line)?.groups?.value;
    if (value === undefined || value === '' || value.includes('…')) return;
    const bare = value.split('.').filter((entry) => !ENTRY.test(entry));
    if (bare.length === 0) return;
    const after = lines.slice(index + 1, index + 1 + RERUN_WITHIN).join('\n');
    if (after.includes('0071_session_secret.sql')) return;
    found.push(`${name}:${String(index + 1)} shows ${bare.join(', ')} as a session cookie entry`);
  });
  return found;
}

describe('a session cookie a transcript shows is an entry, not a bare id', () => {
  it.each(DOCUMENTS)('%s', (name) => {
    expect(problems(name)).toEqual([]);
  });

  it('finds the entries it checks, rather than passing on none', () => {
    const shown = DOCUMENTS.flatMap((name) =>
      loadDocument(name).lines.filter((line) => {
        const value = SET_COOKIE.exec(line)?.groups?.value;
        return value !== undefined && ENTRY.test(value);
      }),
    );
    expect(shown.length).toBeGreaterThan(0);
  });
});
