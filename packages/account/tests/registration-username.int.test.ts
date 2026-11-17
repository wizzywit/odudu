import formbody from '@fastify/formbody';
import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import {
  credentialRepository,
  evaluatePassword,
  hashUserPassword,
  subjectRepository,
  userRepository,
  users,
} from '@odudu/domain-identity';
import { emailOutbox } from '@odudu/email';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tenantSettingsRepository } from '#/repository/tenant-settings';
import { pendingRegistrations } from '#/schema/pending-registrations';
import { type CreateAccountResult, type NewAccountInput } from '#/usecase/register';
import { accountTestDeps, linkRouteDeps, openAndPress } from '#/testing/support';
import { en } from '#/view/messages';
import { registerActionTokenRoute } from '#/view/routes/action-token';
import { registerRegistrationRoute } from '#/view/routes/registration';

let container: TestDatabase | undefined;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), { max: 5 });
}, 120_000);

afterAll(async () => {
  await app.close();
  await owner.close();
  await container?.stop();
});

async function createAccount(
  tx: TenantScopedDatabase,
  tenantId: string,
  input: NewAccountInput,
): Promise<CreateAccountResult> {
  const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
  await userRepository(tx).create({
    subjectId: subject.id,
    tenantId,
    username: input.username,
    email: input.email,
  });
  await credentialRepository(tx).insert({
    tenantId,
    subjectId: subject.id,
    type: 'password',
    secret: { kind: 'password', hash: await hashUserPassword(input.password) },
  });
  return { subjectId: subject.id };
}

// What findTaken is told about a username, in order; a draw past the list is free.
let takenAnswers: boolean[] = [];
let asked: string[] = [];

function build(): FastifyInstance {
  const http = Fastify();
  http.register(formbody);
  const findTenant = (name: string) => tenantSettingsRepository(owner.db).byName(name);
  registerRegistrationRoute(http, {
    ...accountTestDeps,
    findHeldSignIn: () => Promise.resolve(null),
    database: app,
    findTenant,
    publicBaseUrl: 'https://idp.example.test',
    createAccount,
    evaluatePassword,
    findTaken: async (tx, tenantId, who) => {
      asked.push(who.username);
      const forced = takenAnswers.shift();
      const real = await accountTestDeps.findTaken(tx, tenantId, who);
      return forced === undefined ? real : { ...real, username: forced };
    },
  });
  registerActionTokenRoute(http, {
    ...accountTestDeps,
    ...linkRouteDeps(),
    database: app,
    findTenant,
    findHeldSignIn: () => Promise.resolve(null),
  });
  return http;
}

let http: FastifyInstance;
beforeAll(async () => {
  http = build();
  await http.ready();
});

async function seed(
  mode: 'required' | 'optional' | 'generated',
  verifyEmail = false,
): Promise<{ id: string; name: string }> {
  const id = newId();
  const name = `regname-${id.slice(-12)}`;
  await owner.db.insert(tenants).values({
    id,
    name,
    registrationAllowed: true,
    registrationUsername: mode,
    verifyEmail,
    loginWithEmail: mode !== 'required',
  });
  takenAnswers = [];
  asked = [];
  return { id, name };
}

function submit(name: string, fields: Record<string, string>) {
  return http.inject({
    method: 'POST',
    url: `/tenants/${name}/login-actions/registration`,
    payload: new URLSearchParams({
      email: 'ada@example.test',
      password: 'correct horse battery',
      password_confirm: 'correct horse battery',
      ...fields,
    }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

async function usernames(tenantId: string): Promise<string[]> {
  const rows = await withTenant(app.db, tenantId, (tx) => tx.select().from(users));
  return rows.map((row) => row.username);
}

const HANDLE = /^u-[a-z2-7]{10}$/u;

describe('registering under registration_username', () => {
  it('keeps asking for a username while it is required', async () => {
    const t = await seed('required');
    const res = await submit(t.name, { username: '' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain(en['registration.refusal.usernameRequired']);
    expect(await usernames(t.id)).toEqual([]);
  });

  it('stores a typed username as it was typed while required', async () => {
    const t = await seed('required');
    expect((await submit(t.name, { username: 'ann' })).statusCode).toBe(201);
    expect(await usernames(t.id)).toEqual(['ann']);
  });

  it('assigns a handle in generated mode and never stores the posted name', async () => {
    const t = await seed('generated');
    expect((await submit(t.name, { username: 'mallory' })).statusCode).toBe(201);
    const [stored] = await usernames(t.id);
    expect(stored).toMatch(HANDLE);
  });

  it('generates when optional and blank, and keeps a typed name', async () => {
    const blank = await seed('optional');
    expect((await submit(blank.name, { username: '' })).statusCode).toBe(201);
    expect((await usernames(blank.id))[0]).toMatch(HANDLE);

    const typed = await seed('optional');
    expect((await submit(typed.name, { username: 'ann' })).statusCode).toBe(201);
    expect(await usernames(typed.id)).toEqual(['ann']);
  });

  it('draws again when a handle is held, and succeeds on the third draw', async () => {
    const t = await seed('generated');
    takenAnswers = [true, true];
    expect((await submit(t.name, {})).statusCode).toBe(201);
    expect(asked).toHaveLength(3);
    expect(new Set(asked).size).toBe(3);
    expect(await usernames(t.id)).toEqual([asked[2]]);
  });

  it('ends on the failure page when every draw is held', async () => {
    const t = await seed('generated');
    takenAnswers = [true, true, true];
    const res = await submit(t.name, {});
    expect(res.statusCode).toBe(500);
    expect(res.body).toContain(en['registration.refusal.unavailable']);
    expect(asked).toHaveLength(3);
    expect(await usernames(t.id)).toEqual([]);
  });

  it('does not draw again for a chosen name that is held', async () => {
    const t = await seed('optional');
    takenAnswers = [true];
    const res = await submit(t.name, { username: 'ann' });
    expect(res.statusCode).toBe(400);
    expect(asked).toEqual(['ann']);
  });

  it('puts the same handle in the pending row and in the account it becomes', async () => {
    const t = await seed('generated', true);
    expect((await submit(t.name, { username: 'mallory' })).statusCode).toBe(201);
    const pending = await withTenant(app.db, t.id, (tx) => tx.select().from(pendingRegistrations));
    expect(pending).toHaveLength(1);
    const handle = pending[0]?.username ?? '';
    expect(handle).toMatch(HANDLE);

    const mail = await withTenant(app.db, t.id, (tx) => tx.select().from(emailOutbox));
    const link = /finish:\n\n(\S+)/u.exec(mail.at(-1)?.bodyText ?? '')?.[1];
    const key = link === undefined ? null : new URL(link).searchParams.get('key');
    if (key === null) throw new Error('no verification link was queued');
    expect((await openAndPress(http, t.name, key)).statusCode).toBe(200);
    expect(await usernames(t.id)).toEqual([handle]);
  });

  it('uses a whitespace-only username as typed while required, as the form always has', async () => {
    const t = await seed('required');
    const res = await submit(t.name, { username: '  ' });
    const stored = await usernames(t.id);
    expect(res.statusCode).toBe(201);
    expect(stored).toEqual(['  ']);
  });

  it.each([
    ['a password mismatch', { password_confirm: 'another passphrase entirely' }],
    ['fields left empty', { email: '', password: '', password_confirm: '' }],
  ])('gives back no username in a generated form refused for %s', async (_label, extra) => {
    const t = await seed('generated');
    const res = await submit(t.name, { username: 'mallory-posted', ...extra });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('name="username"');
    expect(res.body).not.toContain('mallory-posted');
    expect(await usernames(t.id)).toEqual([]);
  });
});
