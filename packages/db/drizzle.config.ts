import { defineConfig } from 'drizzle-kit';

// No fallback: a default here would silently point at whatever Postgres
// happens to be listening on the developer's machine. This repo's compose
// stack publishes Postgres on 5442, not the Postgres default 5432, because
// 5432 is commonly a real, native database on the host — a hardcoded
// fallback of either port is a guess that risks talking to (and, for
// `drizzle-kit push`, modifying) the wrong server. Fail instead.
const databaseUrl = process.env.ODUDU_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'ODUDU_DATABASE_URL is not set. Set it before running drizzle-kit — see infra/docker/.env.example (compose, port 5442) or .env.example (host-run server).',
  );
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: databaseUrl,
  },
});
