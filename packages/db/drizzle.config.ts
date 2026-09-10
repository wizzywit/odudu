import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.ODUDU_DATABASE_URL ?? 'postgres://odudu:odudu@localhost:5432/odudu',
  },
});
