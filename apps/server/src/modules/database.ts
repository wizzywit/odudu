import {
  MIGRATIONS_DIR,
  runMigrations,
  stampPasskeyRelyingParty,
  type DatabaseHandle,
} from '@odudu/db';
import { baseRelyingPartyId, type OduduModule } from '@odudu/kernel';

export function databaseModule(owner: DatabaseHandle, runtime: DatabaseHandle): OduduModule {
  return {
    name: 'database',

    start: async (ctx) => {
      await runMigrations(owner.db, ctx.config.ODUDU_MIGRATIONS_DIR ?? MIGRATIONS_DIR);
      ctx.logger.info({}, 'migrations applied');
      const rpId = baseRelyingPartyId(ctx.config.ODUDU_PUBLIC_BASE_URL);
      if (rpId !== null) {
        const stamped = await stampPasskeyRelyingParty(owner.db, rpId);
        if (stamped > 0)
          ctx.logger.info({ stamped, rpId }, 'passkeys stamped with their relying party');
      }
    },

    stop: async () => {
      if (runtime !== owner) await runtime.close();
      await owner.close();
    },
  };
}
