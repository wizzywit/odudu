import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROUTES_DIR = fileURLToPath(new URL('.', import.meta.url));
const BARE_WITH_TENANT = /\bwithTenant\(/u;

function routeFiles(): string[] {
  return readdirSync(ROUTES_DIR)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .filter((name) => name !== 'admin-tx.ts');
}

describe('view/routes never calls withTenant directly', () => {
  it('every route goes through adminTx, so a request always carries its context', () => {
    const offenders = routeFiles().flatMap((name) => {
      const filePath = path.join(ROUTES_DIR, name);
      const lines = readFileSync(filePath, 'utf8').split('\n');
      return lines.flatMap((line, index) =>
        BARE_WITH_TENANT.test(line) ? [`${name}:${String(index + 1)}`] : [],
      );
    });

    expect(offenders, 'a route under view/routes/ calls withTenant instead of adminTx').toEqual([]);
  });
});
