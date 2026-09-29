import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { z } from 'zod';

const DOCKER_DIR = path.resolve(import.meta.dirname, '../../../infra/docker');
// Never the development stack's project: its containers are somebody's work.
const PROJECT = process.env.COMPOSE_PROJECT_NAME ?? 'odudu-e2e';

function compose(args: readonly string[]): string {
  return execFileSync(
    'docker',
    ['compose', '--project-directory', DOCKER_DIR, '-p', PROJECT, ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

export function seed(args: readonly string[]): string {
  return compose(['exec', '-T', 'odudu', 'node', 'dist/main.js', 'seed', ...args]);
}

// As the database owner, which row level security does not filter.
export function psql(sql: string): string {
  return compose([
    'exec',
    '-T',
    'postgres',
    'sh',
    '-c',
    'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -c "$0"',
    sql,
  ]).trim();
}

const account = z.object({ tenant: z.string(), username: z.string(), password: z.string() });

const seededSchema = z.object({
  // A tenant administrator, and one of the same tenant who must change a password.
  admin: account,
  forced: account,
  // One whose console session a test ends, so no other test loses its own.
  expiring: account,
  // An administrator of a second tenant, to switch to.
  other: account,
  // A system administrator, signed in to `system`.
  system: account,
  // An operator of `admin`'s tenant holding manage-tenant alone.
  limited: account,
  // A tenant administrator of a tenant of its own, whose settings a test changes.
  overview: account,
});

export type Account = z.infer<typeof account>;
export type Seeded = z.infer<typeof seededSchema>;

const STATE = 'E2E_SEEDED';

export function publish(seeded: Seeded): void {
  process.env[STATE] = JSON.stringify(seeded);
}

export function seeded(): Seeded {
  const raw = process.env[STATE];
  if (raw === undefined) throw new Error(`${STATE} is unset; run through e2e/run.sh`);
  return seededSchema.parse(JSON.parse(raw));
}
