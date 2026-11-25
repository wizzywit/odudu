import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAgentStack, withHeldLock, type AgentStack } from '#/testing/agent-fixture';

let stack: AgentStack;

beforeAll(async () => {
  stack = await startAgentStack();
}, 120_000);

afterAll(async () => {
  await stack.stop();
});

describe('withHeldLock', () => {
  it('leaves no rejection unhandled while the body waits, and still hands it to the caller', async () => {
    const unhandled: unknown[] = [];
    const listen = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', listen);
    try {
      const caught = await withHeldLock(
        stack.app.db,
        stack.tenantId,
        {
          lock: async (tx) => {
            await tx.execute(sql`select 1`);
          },
        },
        async (held) => {
          const failing = held.started(Promise.reject(new Error('boom')));
          await new Promise((resolve) => setTimeout(resolve, 200));
          return failing.then(
            () => null,
            (error: unknown) => error,
          );
        },
      );
      expect(unhandled).toEqual([]);
      expect(caught).toEqual(new Error('boom'));
    } finally {
      process.off('unhandledRejection', listen);
    }
  });
});
