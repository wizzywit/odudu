import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from '#/schema/index';

export type Database = PostgresJsDatabase<typeof schema>;

export interface DatabaseHandle {
  readonly db: Database;
  readonly sql: Sql;
  close(): Promise<void>;
}

export interface DatabaseOptions {
  max?: number;
  // Tests only (tests/lint/query-hook-tests-only.test.ts): sees every
  // statement sent with its parameters, which carry password hashes, secret
  // hashes, emails and TOTP seeds. Never log what it is handed. `connection`
  // numbers the pooled connection that sent the statement, so a caller can
  // follow one transaction's tenant binding; `types` are the parameter type
  // OIDs the driver declared, 0 where it left the server to infer one.
  onQueryForTests?: (
    query: string,
    parameters: readonly unknown[],
    connection: number,
    types: readonly number[],
  ) => void;
}

export function createDatabase(url: string, options: DatabaseOptions = {}): DatabaseHandle {
  const onQuery = options.onQueryForTests;
  const sql = postgres(url, {
    max: options.max ?? 10,
    // A closure over roles or groups is costed above jit_above_cost whatever it
    // reads, and compiling ~400 functions for a seventeen-row lookup took 1.2 s.
    connection: { jit: 'off' },
    onnotice: () => undefined,
    ...(onQuery === undefined
      ? {}
      : {
          debug: (
            connection: number,
            query: string,
            parameters: readonly unknown[],
            types: readonly number[],
          ) => {
            onQuery(query, parameters, connection, types);
          },
        }),
  });

  return {
    db: drizzle(sql, { schema }),
    sql,
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}
