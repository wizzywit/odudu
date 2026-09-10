import { MIGRATIONS_DIR, runMigrations, type DatabaseHandle } from '@odudu/db';
import { type OduduModule } from '@odudu/kernel';

export function databaseModule(owner: DatabaseHandle, runtime: DatabaseHandle): OduduModule {
  return {
    name: 'database',

    start: async (ctx) => {
      await runMigrations(owner.db, ctx.config.ODUDU_MIGRATIONS_DIR ?? MIGRATIONS_DIR);
      ctx.logger.info({}, 'migrations applied');
    },

    stop: async () => {
      if (runtime !== owner) await runtime.close();
      await owner.close();
    },
  };
}
