import { afterEach, describe, expect, it } from 'vitest';
import { parseReconcileArguments, reconcileAccountsCommand } from '#/cli/reconcile-accounts';

describe('the arguments of reconcile-accounts', () => {
  it('runs for real by default', () => {
    expect(parseReconcileArguments([])).toEqual({ dryRun: false });
  });

  it('only looks when asked to with --dry-run', () => {
    expect(parseReconcileArguments(['--dry-run'])).toEqual({ dryRun: true });
  });

  it('refuses an argument it does not know, naming the help', () => {
    expect(() => parseReconcileArguments(['--force'])).toThrow(/odudu help reconcile-accounts/u);
    expect(() => parseReconcileArguments(['acme'])).toThrow(/odudu help reconcile-accounts/u);
  });
});

describe('the connections the command runs on', () => {
  afterEach(() => {
    delete process.env.ODUDU_DATABASE_URL;
    delete process.env.ODUDU_APP_DATABASE_URL;
    delete process.env.ODUDU_KEK;
  });

  // The owner role escapes row-level security, so a fallback to it would run
  // every move without the tenant policy scoping it.
  it('refuses to run without a serving connection', async () => {
    process.env.ODUDU_DATABASE_URL = 'postgres://localhost:5432/odudu';
    process.env.ODUDU_KEK = Buffer.alloc(32, 7).toString('base64');

    await expect(reconcileAccountsCommand([])).rejects.toThrow(/ODUDU_APP_DATABASE_URL/u);
  });
});
