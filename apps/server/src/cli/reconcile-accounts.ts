import { parseArgs } from 'node:util';
import { bypassesRowLevelSecurity, createDatabase, tenantIdPages } from '@odudu/db';
import type { DatabaseHandle } from '@odudu/db';
import { loadConfig, OduduError } from '@odudu/kernel';
import { reconcileDuplicateAccounts, type ReconcileReport } from '@odudu/protocol-admin';
import { RECONCILE_OPTIONS } from '#/cli/reconcile-options';

export function parseReconcileArguments(argv: readonly string[]): { dryRun: boolean } {
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: RECONCILE_OPTIONS,
      allowPositionals: false,
    });
    return { dryRun: values['dry-run'] === true };
  } catch {
    throw new OduduError(
      'reconcile_accounts_usage',
      'usage: odudu reconcile-accounts [--dry-run]; see odudu help reconcile-accounts',
    );
  }
}

async function* allTenantIds(owner: DatabaseHandle): AsyncGenerator<string> {
  for await (const page of tenantIdPages(owner.db)) yield* page;
}

async function assertRolesAreRight(owner: DatabaseHandle, serving: DatabaseHandle): Promise<void> {
  if (!(await bypassesRowLevelSecurity(owner))) {
    throw new OduduError(
      'reconcile_cannot_enumerate_tenants',
      'reconcile-accounts lists tenants on a connection that bypasses row-level security; ' +
        'ODUDU_DATABASE_URL names a role that is neither SUPERUSER nor BYPASSRLS',
    );
  }
  if (await bypassesRowLevelSecurity(serving)) {
    throw new OduduError(
      'reconcile_serving_role_bypasses_rls',
      'reconcile-accounts moves rows under the tenant policy, so its serving connection must ' +
        'be subject to it; ODUDU_APP_DATABASE_URL names a SUPERUSER or BYPASSRLS role',
    );
  }
}

/**
 * Reads its own configuration and opens its own connections, like `odudu
 * reap`: the owner lists the tenants and the serving role does every read
 * and write under each tenant's policy.
 */
export async function reconcileAccountsCommand(argv: readonly string[]): Promise<ReconcileReport> {
  const options = parseReconcileArguments(argv);
  const config = loadConfig();
  const appUrl = config.ODUDU_APP_DATABASE_URL;
  if (appUrl === undefined) {
    throw new OduduError(
      'reconcile_requires_app_database_url',
      'reconcile-accounts requires ODUDU_APP_DATABASE_URL: it moves rows under the tenant ' +
        'policy, which the owner role the migrations use escapes',
    );
  }
  const owner = createDatabase(config.ODUDU_DATABASE_URL);
  const serving = createDatabase(appUrl);
  try {
    await assertRolesAreRight(owner, serving);
    return await reconcileDuplicateAccounts(serving.db, allTenantIds(owner), new Date(), options);
  } finally {
    await serving.close();
    await owner.close();
  }
}
