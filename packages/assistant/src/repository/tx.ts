import { type PostgresJsDatabase } from 'drizzle-orm/postgres-js';

// What a repository needs of a tenant-bound transaction. @odudu/db's
// TenantScopedDatabase is assignable to it; the assistant package may not
// import that package, so the shape is stated here from the driver's type.
export type AssistantTx = Omit<PostgresJsDatabase<Record<string, unknown>>, 'transaction'>;
