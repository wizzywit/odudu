import { generateClientKey } from '@odudu/crypto';
import { createDatabase, tenantIdPages, withTenant, type DatabaseHandle } from '@odudu/db';
import { SYSTEM_TENANT_ID } from '@odudu/domain-tenant';
import { loadConfig, OduduError } from '@odudu/kernel';
import { type ClientJwks, provisionAdminClient } from '@odudu/protocol-oidc';
import { assertConsoleConfigured } from '#/config-guard';
import { consoleProvisioning } from '#/console-key';

export interface ProvisionConsoleDeps {
  /** The serving connection: each tenant's admin client is written under its own policy. */
  readonly database: DatabaseHandle;
  /** The owner connection, for listing the tenants, which no tenant context can see. */
  readonly ownerDatabase: DatabaseHandle;
}

export interface ConsoleRegistration {
  readonly consoleBaseUrl: string;
  readonly consoleClientJwks: ClientJwks;
}

/**
 * Re-runs `provisionAdminClient` over every tenant, one transaction each,
 * so every admin client carries the console's URIs under the base and none
 * left behind by an earlier one, is confidential, and registers exactly the
 * console's keys. Idempotent; returns the number of tenants visited.
 */
export async function provisionConsole(
  deps: ProvisionConsoleDeps,
  registration: ConsoleRegistration,
): Promise<number> {
  let visited = 0;
  for await (const page of tenantIdPages(deps.ownerDatabase.db)) {
    for (const id of page) {
      await withTenant(deps.database.db, id, (tx) =>
        provisionAdminClient(tx, id, {
          crossTenant: id === SYSTEM_TENANT_ID,
          ...registration,
        }),
      );
      visited += 1;
    }
  }
  return visited;
}

// `odudu console keygen` prints the configuration line for a new client key.
// `odudu console provision` is the command to run after setting or changing
// ODUDU_PUBLIC_BASE_URL or the console's client key: it reads its own
// configuration and opens its own connections, like `odudu reap`.
export async function consoleCommand(argv: readonly string[]): Promise<string> {
  const [subcommand] = argv;
  if (subcommand === 'keygen') return `ODUDU_CONSOLE_CLIENT_KEY=${await generateClientKey()}`;
  if (subcommand !== 'provision') {
    throw new OduduError(
      'console_unknown_command',
      `unknown console subcommand ${JSON.stringify(subcommand)}; expected provision or keygen`,
    );
  }

  const config = loadConfig();
  assertConsoleConfigured(config);
  const { consoleBaseUrl, consoleClientJwks } = await consoleProvisioning(config);
  if (consoleBaseUrl === undefined || consoleClientJwks === undefined) {
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
    const count = await provisionConsole(
      { database: runtime, ownerDatabase: owner },
      { consoleBaseUrl, consoleClientJwks },
    );
    return `provisioned ${String(count)} tenants`;
  } finally {
    if (runtime !== owner) await runtime.close();
    await owner.close();
  }
}
