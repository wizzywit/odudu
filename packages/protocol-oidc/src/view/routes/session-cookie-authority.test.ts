import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROUTES_DIR = import.meta.dirname;
const ATTRIBUTES = ['HttpOnly', 'SameSite=Lax', 'Max-Age=', 'Secure'];
const AUTHORITY = 'packages/authn-flows/src/service/session-cookie.ts';

async function routeFiles(): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(ROUTES_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) {
      continue;
    }
    found.push(join(ROUTES_DIR, entry.name));
  }
  return found;
}

describe('the session cookie has one authority', () => {
  it('is named by no route of its own', async () => {
    const offenders: string[] = [];
    for (const file of await routeFiles()) {
      const source = await readFile(file, 'utf8');
      for (const attribute of ATTRIBUTES) {
        if (source.includes(attribute)) offenders.push(`${file} names ${attribute}`);
      }
    }
    expect(offenders, `only ${AUTHORITY} decides these`).toEqual([]);
  });
});
