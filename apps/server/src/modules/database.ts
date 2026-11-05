import {
  bypassesRowLevelSecurity,
  MIGRATIONS_DIR,
  runMigrations,
  stampPasskeyRelyingParty,
  type DatabaseHandle,
} from '@odudu/db';
import { baseRelyingPartyId, type Logger, type OduduModule } from '@odudu/kernel';

// The stamp is an UPDATE across every tenant under FORCE ROW LEVEL SECURITY,
// so on a role that does not bypass it the statement matches nothing and
// reports success; that is said aloud instead.
export async function stampPasskeysAtStart(
  owner: DatabaseHandle,
  base: string | undefined,
  logger: Logger,
): Promise<void> {
  const rpId = baseRelyingPartyId(base);
  if (rpId === null) return;
  if (!(await bypassesRowLevelSecurity(owner))) {
    logger.warn(
      { rpId },
      'passkeys were not stamped with their relying party: ODUDU_DATABASE_URL names a role ' +
        'that neither is SUPERUSER nor has BYPASSRLS, so row-level security hides every credential',
    );
    return;
  }
  const stamped = await stampPasskeyRelyingParty(owner.db, rpId);
  if (stamped > 0) logger.info({ stamped, rpId }, 'passkeys stamped with their relying party');
}

export function databaseModule(owner: DatabaseHandle, runtime: DatabaseHandle): OduduModule {
  return {
    name: 'database',

    start: async (ctx) => {
      await runMigrations(owner.db, ctx.config.ODUDU_MIGRATIONS_DIR ?? MIGRATIONS_DIR);
      ctx.logger.info({}, 'migrations applied');
      await stampPasskeysAtStart(owner, ctx.config.ODUDU_PUBLIC_BASE_URL, ctx.logger);
    },

    stop: async () => {
      if (runtime !== owner) await runtime.close();
      await owner.close();
    },
  };
}
