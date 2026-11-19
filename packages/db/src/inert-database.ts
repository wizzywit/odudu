import { drizzle } from 'drizzle-orm/postgres-js';
import { type Database } from '#/client';
import * as schema from '#/schema/index';

// A real Database that holds no connection, for a test that hands one to code
// which must not reach it. `stubs` replaces the methods the test expects the
// code under test to call; anything else answers with the driver's own
// "no client" refusal.
export function inertDatabase<T extends object = object>(stubs?: T): Database & T {
  const mock: unknown = drizzle.mock({ schema });
  return Object.assign(mock as Database, stubs);
}

// A Database whose every property read goes to `onRead` first, and which
// reads nothing else: a use of it at all, even a `typeof db.select`, is seen.
export function watchedDatabase(onRead: (name: string) => never): Database {
  return new Proxy(inertDatabase(), {
    get: (_target, name) => onRead(String(name)),
  });
}

// Every property read throws `message`, so a use of it at all fails the test
// with a reason.
export function forbiddenDatabase(message: string): Database {
  return watchedDatabase(() => {
    throw new Error(message);
  });
}
