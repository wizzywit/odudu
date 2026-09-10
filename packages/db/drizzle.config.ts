import { defineConfig } from 'drizzle-kit';

// Falls back to the throwaway compose stack's published port, 5442 — never
// to Postgres's default 5432, which commonly hosts a real, native database
// on the developer's own machine. Guessing 5432 risks talking to (and, for
// `drizzle-kit push`, modifying) the wrong server; 5442 carries no such
// risk, since nothing but this repo's disposable compose stack uses it.
const databaseUrl = process.env.ODUDU_DATABASE_URL ?? 'postgres://odudu:odudu@localhost:5442/odudu';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: databaseUrl,
  },
});
