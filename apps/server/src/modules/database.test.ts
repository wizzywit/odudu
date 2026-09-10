import { type DatabaseHandle } from '@odudu/db';
import { describe, expect, it } from 'vitest';
import { databaseModule } from '#/modules/database.js';

function fakeHandle(): DatabaseHandle & { closes: number } {
  const state = { closes: 0 };
  return {
    db: {} as DatabaseHandle['db'],
    sql: (() => Promise.resolve([])) as unknown as DatabaseHandle['sql'],
    close: () => {
      state.closes += 1;
      return Promise.resolve();
    },
    get closes() {
      return state.closes;
    },
  };
}

describe('databaseModule', () => {
  it('closes the shared handle exactly once when runtime and owner are the same', async () => {
    const owner = fakeHandle();

    await databaseModule(owner, owner).stop?.();

    expect(owner.closes).toBe(1);
  });

  it('closes both handles exactly once when runtime and owner differ', async () => {
    const owner = fakeHandle();
    const runtime = fakeHandle();

    await databaseModule(owner, runtime).stop?.();

    expect(owner.closes).toBe(1);
    expect(runtime.closes).toBe(1);
  });
});
