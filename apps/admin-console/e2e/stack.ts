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

export function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

// The id of the tenant of that name, as a subquery to compare a tenant_id with.
export function inTenant(name: string): string {
  return `(select id from tenants where name = ${sqlText(name)})`;
}

const subjectSelect = (tenant: string, username: string): string =>
  `select u.subject_id from users u join tenants t on t.id = u.tenant_id where t.name = ${sqlText(tenant)} and u.username = ${sqlText(username)}`;

export function subjectIdOf(tenant: string, username: string): string {
  return psql(subjectSelect(tenant, username));
}

// The subject's id as a subquery to compare a subject_id with.
export function inSubject(tenant: string, username: string): string {
  return `(${subjectSelect(tenant, username)})`;
}

// A name no narrow line can break, seeded for the layout tests that look for it.
export const UNBROKEN = 'segment'.repeat(8);

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
  // A system administrator whose console session a test ends mid-edit.
  resumer: account,
  // Tenants the System area's tests change, one per test that changes one.
  tenants: z.object({
    // Edited, disabled and enabled again.
    general: z.string(),
    // Holds a confidential client, and is exported and imported.
    source: z.string(),
    // Changed behind an open page, for a 412.
    conflict: z.string(),
    // Edited by `resumer` when the session ends.
    resume: z.string(),
    // The prefix every tenant a test creates starts with.
    prefix: z.string(),
    // Deleted by a test each: disabled and deleted by hand, deleted by
    // keyboard from a tenant seeded disabled, enabled again behind an open
    // page, and deleted at a phone's width.
    doomed: z.object({ main: z.string(), keyed: z.string(), raced: z.string(), phone: z.string() }),
  }),
  // Subjects of system the System administrators tests grant, revoke or sign in as.
  systemAdmins: z.object({
    // Holds no role, and is granted tenant-admin.
    candidate: account,
    // A system administrator whose tenant-admin is revoked.
    revokee: account,
    // Holds manage-tenants and view-users alone.
    limited: account,
    // Holds no role, and is offered a grant that meets a 412.
    bystander: account,
    // The username the guided step creates.
    created: z.string(),
  }),
  // A tenant of its own for the Subjects tests, and the subjects each changes.
  subjects: z.object({
    // Holds tenant-admin there.
    admin: account,
    // Holds view-users alone.
    viewer: account,
    // Usernames of subjects whose profiles a test edits, one per test.
    edited: z.string(),
    conflict: z.string(),
    // Whose details a test enters through the typed fields, and whose
    // birthdate another enters by keyboard alone.
    typed: z.string(),
    keyed: z.string(),
    // Whose filled-in profile the layout tests measure, and nothing changes.
    measured: z.string(),
    // Locked out by a test, then cleared.
    locked: account,
    // Issued a one-time password, which then signs in.
    issued: account,
    // Deleted by a test.
    doomed: z.string(),
    // Each holds a second factor and recovery codes: one has its codes revoked,
    // the other its only factor removed.
    revoker: z.string(),
    remover: z.string(),
    // A tenant administrator who deletes their own subject.
    departing: account,
    // An administrator of a second tenant, where a test turns renaming on.
    renamer: account,
    // The subject of that tenant the test renames.
    renamed: z.string(),
    // The prefix every subject a test creates starts with.
    prefix: z.string(),
    // Joins a group and is given a role.
    member: z.string(),
    // Given a required action, then signs in to meet it.
    asked: account,
    // Given an admin capability by a tenant administrator.
    holder: z.string(),
    // Holds view-audit, and is given more from the System area by keyboard.
    listed: z.string(),
    // A tenant administrator who ends their own sessions.
    ender: account,
    // Whose groups change behind an open page, for a 412.
    raced: z.string(),
    // A tenant administrator whose console session a test ends mid-edit,
    // and the subject whose profile they were editing.
    resumer: account,
    drafted: z.string(),
  }),
  // A tenant of its own for the Clients tests.
  clients: z.object({
    // Holds tenant-admin there.
    admin: account,
    // Holds manage-clients alone.
    limited: account,
    // Holds manage-clients and manage-sessions.
    sessions: account,
    // Sign in through a client, to have a session and a grant of their own.
    walkers: z.array(account),
  }),
  // A tenant of its own for the Groups and Roles tests.
  groupsRoles: z.object({
    // Holds tenant-admin there.
    admin: account,
    // Holds manage-tenant alone.
    limited: account,
    // A member of /eng.
    member: z.string(),
  }),
  // Tenants of their own for the Registration tokens and Sign-in flow tests.
  access: z.object({
    // The tokens tenant: tenant-admin, manage-tenant alone, manage-clients alone.
    tokens: z.object({ admin: account, tenantOnly: account, clientsOnly: account }),
    // One flow tenant per test that changes its flow, each with its administrator.
    flows: z.object({
      main: account,
      keyed: account,
      conflict: account,
      refused: account,
      // Read only: a phone's pages, and an operator holding manage-tenant alone or manage-clients alone.
      fixed: account,
      fixedTenantOnly: account,
      fixedClientsOnly: account,
    }),
    // One keys tenant per test that changes its keys, each with its administrator.
    keys: z.object({
      main: account,
      young: account,
      raced: account,
      keyed: account,
      // Read only: a phone's pages, and operators holding manage-keys alone or manage-tenant alone.
      fixed: account,
      fixedKeysOnly: account,
      fixedTenantOnly: account,
    }),
  }),
  // Tenants of their own for the Settings and Email tests.
  config: z.object({
    // One settings tenant per test that changes its settings, each with its administrator.
    settings: z.object({
      main: account,
      rebase: account,
      behind: account,
      keyed: account,
      general: account,
      disable: account,
      // Read only: a phone's pages, and an operator holding manage-clients alone.
      fixed: account,
      fixedClientsOnly: account,
    }),
    // One email tenant per test that changes its relay, each with its administrator.
    email: z.object({
      main: account,
      keyed: account,
      removal: account,
      refused: account,
      fixed: account,
      fixedClientsOnly: account,
    }),
    // One tenant per test that clears its lockouts, each holding locked subjects.
    lockouts: z.object({
      main: account,
      keyed: account,
      // Read only: a phone's page, and an operator holding manage-tenant alone.
      fixed: account,
      fixedTenantOnly: account,
    }),
    // One tenant per test that changes its theme, each with its administrator
    // and an application whose sign-in page it themes.
    branding: z.object({
      publish: account,
      upload: account,
      contrast: account,
      reset: account,
      keyed: account,
      // Read only: the editors' layout at each width.
      layout: account,
      // The Mail tab's frame and the Languages tab's overrides.
      mail: account,
      languages: account,
      // The stylesheet editor: a refusal marked on its line, then a published one.
      styled: account,
      // The Pages tab's message picker and the preview's notice.
      catalogue: account,
      // A client's own theme over the tenant's, and its name in French.
      client: account,
      // The selectors list: a stylesheet saved with what it offered.
      selectors: account,
    }),
    // One tenant per test that reads its mail, each with its outbox seeded.
    mail: z.object({
      main: account,
      keyed: account,
      // Read only: a phone's page, and an operator holding manage-tenant alone.
      fixed: account,
      fixedTenantOnly: account,
    }),
  }),
  // A tenant of its own for the Audit tests, with its trail seeded.
  audit: z.object({
    // Holds tenant-admin there.
    admin: account,
    // Holds view-audit alone: reads the trail, but no subject's name.
    viewer: account,
    // Holds view-users alone: not the audit trail.
    usersOnly: account,
    // The tenant's client the seeded rows name, by its audit resource id.
    clientId: z.string(),
  }),
  // Tenants of their own for the Sessions tests.
  sessions: z.object({
    // A tenant administrator who ends their own tenant's sessions, hers among them.
    own: account,
    // A tenant a system administrator ends every session in, once its administrator has signed in.
    flow: z.object({ tenant: z.string(), walker: account }),
    // The same, by keyboard alone.
    keyed: z.object({ tenant: z.string(), walker: account }),
    // A tenant holding sixty more sessions than one page, read and never changed.
    list: z.object({ admin: account, tenantOnly: account }),
  }),
  // A tenant of its own for the Scopes tests.
  scopes: z.object({
    // Holds tenant-admin there.
    admin: account,
    // Holds manage-tenant alone: the scopes, but no search over the clients.
    tenantOnly: account,
    // Holds manage-clients alone: no scopes at all.
    clientsOnly: account,
  }),
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

// Sends the Logout Tokens that are due, as an operator would from the command line.
export function sendLogouts(): string {
  return compose(['exec', '-T', 'odudu', 'node', 'dist/main.js', 'send-logouts']);
}

const THROTTLED_NAME = `${PROJECT}-throttled`;

// A second server from the same image on its own port with a budget of one
// request, because every other test shares the origin budget of the stack
// and a throttled page cannot be reached there without starving them.
export function startThrottledServer(port: number): void {
  stopThrottledServer();
  compose([
    'run',
    '-d',
    '--no-deps',
    '--name',
    THROTTLED_NAME,
    '-e',
    'ODUDU_THROTTLE_LIMIT=1',
    '-p',
    `127.0.0.1:${String(port)}:3000`,
    'odudu',
  ]);
}

export function stopThrottledServer(): void {
  execFileSync('docker', ['rm', '-f', THROTTLED_NAME], { stdio: 'ignore' });
}
