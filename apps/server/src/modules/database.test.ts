import { type DatabaseHandle } from '@odudu/db';
import { describe, expect, it } from 'vitest';
import { type Logger } from '@odudu/kernel';
import { databaseModule, stampPasskeysAtStart } from '#/modules/database';

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

describe('stampPasskeysAtStart', () => {
  function handleAnswering(bypasses: boolean): { handle: DatabaseHandle; statements: string[] } {
    const statements: string[] = [];
    const db = {
      execute: (query: { queryChunks?: unknown[] }) => {
        statements.push(JSON.stringify(query.queryChunks ?? []));
        return Promise.resolve(Object.assign([{ bypasses }], { count: 2 }));
      },
    };
    return { handle: { ...fakeHandle(), db: db as unknown as DatabaseHandle['db'] }, statements };
  }

  function recording(): { logger: Logger; warnings: string[] } {
    const warnings: string[] = [];
    const logger: Logger = {
      debug: () => undefined,
      info: () => undefined,
      warn: (_payload, message) => {
        warnings.push(message ?? '');
      },
      error: () => undefined,
      child: () => logger,
    };
    return { logger, warnings };
  }

  it('warns and stamps nothing when the owner role does not bypass row-level security', async () => {
    const { handle, statements } = handleAnswering(false);
    const { logger, warnings } = recording();

    await stampPasskeysAtStart(handle, 'https://idp.example.com', logger);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/not stamped.*BYPASSRLS/su);
    expect(statements).toHaveLength(1);
  });

  it('stamps when the owner bypasses, and does nothing without a usable base URL', async () => {
    const { handle, statements } = handleAnswering(true);
    const { logger, warnings } = recording();

    await stampPasskeysAtStart(handle, 'https://idp.example.com', logger);
    expect(statements).toHaveLength(2);

    await stampPasskeysAtStart(handle, undefined, logger);
    await stampPasskeysAtStart(handle, 'http://127.0.0.1:3000', logger);
    expect(statements).toHaveLength(2);
    expect(warnings).toEqual([]);
  });
});
