import { createDatabase, tenantIdPages, withTenant, type DatabaseHandle } from '@odudu/db';
import { loadConfig, OduduError } from '@odudu/kernel';
import { clientOidcConfigRepository } from '@odudu/protocol-oidc';

// Clients read and rewritten per transaction: a tenant's clients are not held
// in memory or under one lock whatever their number.
const CLIENTS_PER_PAGE = 500;

export interface RebuildClientOriginsDeps {
  /** The serving connection: each tenant's rows are written under its own policy. */
  readonly database: DatabaseHandle;
  /** The owner connection, for listing the tenants, which no tenant context can see. */
  readonly ownerDatabase: DatabaseHandle;
}

/**
 * Rewrites every client's `client_origins` from its `web_origins` and
 * `redirect_uris` with the normaliser the request side uses, one tenant at a
 * time. For rows written before the table existed whose lists the migration's
 * backfill declined (an internationalised host, a padded port, an IPv6
 * literal). Idempotent; returns the clients visited.
 */
export async function rebuildClientOrigins(
  deps: RebuildClientOriginsDeps,
): Promise<{ clients: number }> {
  let clients = 0;
  for await (const page of tenantIdPages(deps.ownerDatabase.db)) {
    for (const tenantId of page) {
      let after: string | undefined;
      for (;;) {
        const configs = await withTenant(deps.database.db, tenantId, async (tx) => {
          const repository = clientOidcConfigRepository(tx);
          const found = await repository.page(after, CLIENTS_PER_PAGE);
          for (const config of found) await repository.rewriteOrigins(config);
          return found;
        });
        clients += configs.length;
        const last = configs[configs.length - 1];
        if (last === undefined || configs.length < CLIENTS_PER_PAGE) break;
        after = last.clientId;
      }
    }
  }
  return { clients };
}

// `odudu client-origins rebuild`: the command to run once after upgrading past
// the migration that added `client_origins`. Reads its own configuration and
// opens its own connections, like `odudu console provision`.
export async function clientOriginsCommand(argv: readonly string[]): Promise<string> {
  const [subcommand] = argv;
  if (subcommand !== 'rebuild') {
    throw new OduduError(
      'client_origins_unknown_command',
      `unknown client-origins subcommand ${JSON.stringify(subcommand)}; expected rebuild`,
    );
  }
  const config = loadConfig();
  const owner = createDatabase(config.ODUDU_DATABASE_URL);
  const runtime = config.ODUDU_APP_DATABASE_URL
    ? createDatabase(config.ODUDU_APP_DATABASE_URL)
    : owner;
  try {
    const { clients } = await rebuildClientOrigins({ database: runtime, ownerDatabase: owner });
    return `rebuilt the origins of ${String(clients)} clients`;
  } finally {
    if (runtime !== owner) await runtime.close();
    await owner.close();
  }
}
