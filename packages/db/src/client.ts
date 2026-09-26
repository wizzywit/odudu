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
  // Sees the text of every statement sent, never its parameters; for a test
  // asserting that two paths issue the same statements.
  onQuery?: (query: string) => void;
}

export function createDatabase(url: string, options: DatabaseOptions = {}): DatabaseHandle {
  const onQuery = options.onQuery;
  const sql = postgres(url, {
    max: options.max ?? 10,
    onnotice: () => undefined,
    ...(onQuery === undefined
      ? {}
      : {
          debug: (_connection: number, query: string) => {
            onQuery(query);
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
