import { type OduduModule } from '@odudu/kernel';
import { type FastifyInstance } from 'fastify';

export function httpModule(app: FastifyInstance): OduduModule {
  return {
    name: 'http',
    dependsOn: ['database'],

    start: async (ctx) => {
      await app.listen({
        host: ctx.config.ODUDU_HTTP_HOST,
        port: ctx.config.ODUDU_HTTP_PORT,
      });
    },

    stop: async () => {
      await app.close();
    },
  };
}
