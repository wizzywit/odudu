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
  // hashes, emails and TOTP seeds. Never log what it is handed.
  onQueryForTests?: (query: string, parameters: readonly unknown[]) => void;
}

export function createDatabase(url: string, options: DatabaseOptions = {}): DatabaseHandle {
  const onQuery = options.onQueryForTests;
  const sql = postgres(url, {
    max: options.max ?? 10,
    onnotice: () => undefined,
    ...(onQuery === undefined
      ? {}
      : {
          debug: (_connection: number, query: string, parameters: readonly unknown[]) => {
            onQuery(query, parameters);
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
