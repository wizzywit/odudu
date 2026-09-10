import { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { httpModule } from '#/modules/http.js';

function fakeApp(): FastifyInstance & { closes: number } {
  const state = { closes: 0 };
  return {
    close: () => {
      state.closes += 1;
      return Promise.resolve();
    },
    get closes() {
      return state.closes;
    },
  } as unknown as FastifyInstance & { closes: number };
}

describe('httpModule', () => {
  it('depends on the database module, so the socket cannot open before migrations run', () => {
    const module = httpModule(fakeApp());

    expect(module.dependsOn).toEqual(['database']);
  });

  it('closes the fastify instance on stop', async () => {
    const app = fakeApp();

    await httpModule(app).stop?.();

    expect(app.closes).toBe(1);
  });
});
