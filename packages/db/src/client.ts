import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from '#/schema/index';

export type Database = PostgresJsDatabase<typeof schema>;

export interface DatabaseHandle {
  readonly db: Database;
  readonly sql: Sql;
  close(): Promise<void>;
}

export function createDatabase(url: string, options: { max?: number } = {}): DatabaseHandle {
  const sql = postgres(url, {
    max: options.max ?? 10,
    onnotice: () => undefined,
  });

  return {
    db: drizzle(sql, { schema }),
    sql,
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}
