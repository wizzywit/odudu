import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const MAIN_TS = path.join(REPO_ROOT, 'apps/server/src/main.ts');

// `assertProductionNoPrivateClientUrls(config)` in main.ts has no data
// dependency on `ModuleRegistry`, so nothing stops a refactor moving it
// below `logoutSenderModule`'s registration — building a logout transport
// that could reach a private address before production refuses the flag
// that widens it. `sendLogoutsCommand` guards itself; this positional
// property covers only the server-boot path.
describe('the production private-URL guard runs before the logout transport is built', () => {
  it('is called earlier in main.ts than logoutSenderModule is registered', () => {
    const source = readFileSync(MAIN_TS, 'utf8');
    const guardIndex = source.indexOf('assertProductionNoPrivateClientUrls(config)');
    const registrationIndex = source.indexOf('logoutSenderModule(');

    expect(guardIndex, 'assertProductionNoPrivateClientUrls(config) call').toBeGreaterThan(-1);
    expect(registrationIndex, 'logoutSenderModule( call').toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(registrationIndex);
  });
});
