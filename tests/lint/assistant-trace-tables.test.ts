import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The trace holds what the audit trail must not: message text, tool inputs and
// outputs. Only the assistant package's own repository and schema name its
// tables, so no admin route, MCP tool or other package reads them, and the
// agent has no way to; reading them for a person is a capability-gated route
// that goes through that repository.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const TABLES = /\bassistant_(?:turns|steps|events)\b/u;
const ALLOWED = [
  /^packages\/assistant\/src\/repository\//u,
  /^packages\/assistant\/src\/schema\//u,
  // Tests state what the tables hold, and the migration and its journal make them.
  /\.test\.tsx?$/u,
  /^packages\/assistant\/tests\//u,
  /^packages\/db\/drizzle\//u,
  // The pages that describe them.
  /\.mdx?$/u,
  /^CHANGELOG\.md$/u,
  /^docs\//u,
];

function files(): string[] {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((file) => file !== '' && /\.(?:tsx?|mdx?|sql|json|cjs|js)$/u.test(file));
}

describe('the assistant’s trace tables', () => {
  it('are named only by the assistant package’s repository and schema', () => {
    const offenders = files()
      .filter((file) => !ALLOWED.some((pattern) => pattern.test(file)))
      .filter((file) => TABLES.test(readFileSync(path.join(REPO_ROOT, file), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('are named by the repository, so the check above looks at something', () => {
    expect(
      TABLES.test(
        readFileSync(
          path.join(REPO_ROOT, 'packages/assistant/src/schema/assistant-trace.ts'),
          'utf8',
        ),
      ),
    ).toBe(true);
  });
});
