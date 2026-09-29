import { createDatabase, tenants, withTenant, type DatabaseHandle } from '@odudu/db';
import { SYSTEM_TENANT_ID } from '@odudu/domain-tenant';
import { consoleBaseUrl, loadConfig, OduduError } from '@odudu/kernel';
import { provisionAdminClient } from '@odudu/protocol-oidc';
import { assertConsoleConfigured } from '#/config-guard';

export interface ProvisionConsoleDeps {
  /** The serving connection: each tenant's admin client is written under its own policy. */
  readonly database: DatabaseHandle;
  /** The owner connection, for listing the tenants, which no tenant context can see. */
  readonly ownerDatabase: DatabaseHandle;
}

/**
 * Re-runs `provisionAdminClient` over every tenant, one transaction each,
 * so every admin client carries the console's URIs under `baseUrl` and
 * none left behind by an earlier base. Idempotent; returns the number of
 * tenants visited.
 */
export async function provisionConsole(
  deps: ProvisionConsoleDeps,
  baseUrl: string,
): Promise<number> {
  const rows = await deps.ownerDatabase.db
    .select({ id: tenants.id })
    .from(tenants)
    .orderBy(tenants.id);
  for (const { id } of rows) {
    await withTenant(deps.database.db, id, (tx) =>
      provisionAdminClient(tx, id, {
        crossTenant: id === SYSTEM_TENANT_ID,
        consoleBaseUrl: baseUrl,
      }),
    );
  }
  return rows.length;
}

// `odudu console provision`: the command to run after setting or changing
// ODUDU_PUBLIC_BASE_URL. Reads its own configuration and opens its own
// connections, like `odudu reap`.
export async function consoleCommand(argv: readonly string[]): Promise<string> {
  const [subcommand] = argv;
  if (subcommand !== 'provision') {
    throw new OduduError(
      'console_unknown_command',
      `unknown console subcommand ${JSON.stringify(subcommand)}; expected provision`,
    );
  }

  const config = loadConfig();
  assertConsoleConfigured(config);
  const baseUrl = consoleBaseUrl(config);
  if (baseUrl === undefined) {
    throw new OduduError(
      'config_invalid',
      'console provision has nothing to register while ODUDU_CONSOLE=false',
    );
  }

  const owner = createDatabase(config.ODUDU_DATABASE_URL);
  const runtime = config.ODUDU_APP_DATABASE_URL
    ? createDatabase(config.ODUDU_APP_DATABASE_URL)
    : owner;
  try {
    const count = await provisionConsole({ database: runtime, ownerDatabase: owner }, baseUrl);
    return `provisioned ${String(count)} tenants`;
  } finally {
    if (runtime !== owner) await runtime.close();
    await owner.close();
  }
}
