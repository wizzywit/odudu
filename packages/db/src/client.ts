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
  // Sees every statement sent, with its parameters; for a test asserting
  // what a path issues, or explaining the statement it issued.
  onQuery?: (query: string, parameters: readonly unknown[]) => void;
}

export function createDatabase(url: string, options: DatabaseOptions = {}): DatabaseHandle {
  const onQuery = options.onQuery;
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
