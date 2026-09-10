import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { type Database } from '#/client.js';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../drizzle', import.meta.url));

export async function runMigrations(db: Database, folder: string = MIGRATIONS_DIR): Promise<void> {
  await migrate(db, { migrationsFolder: folder });
}
