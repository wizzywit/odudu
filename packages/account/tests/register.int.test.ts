import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { effectiveRoles, roleRepository } from '@odudu/domain-authz';
import {
  credentialRepository,
  evaluatePassword,
  hashPassword,
  subjectRepository,
  userRepository,
} from '@odudu/domain-identity';
import {
  emailOutbox,
  sendPending,
  type EmailMessage,
  type EmailSender,
  type SendPendingOptions,
} from '@odudu/email';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { tenantSettingsRepository } from '#/repository/tenant-settings';
import { actionTokens } from '#/schema/action-tokens';
import { type CreateAccountResult, type NewAccountInput } from '#/usecase/register';
import { registerRegistrationRoute } from '#/view/routes/registration';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;

  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);

  const appUrl = await createAppRole(container.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

function fakeSender(): EmailSender & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    send(message: EmailMessage): Promise<void> {
      sent.push(message);
      return Promise.resolve();
    },
  };
}

// The real domain-identity and domain-authz wiring, exercised here the way
// apps/server/src/app.ts wires it for real: @odudu/account itself never
// imports either package (packages/account/src/usecase/register.ts explains
// why), so createAccount is a composition-root concern this test performs
// on its behalf.
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
    secret: { kind: 'password', hash: await hashPassword(input.password) },
  });
  const defaults = await roleRepository(tx).defaultsForTenant();
  for (const role of defaults) {
    await roleRepository(tx).assignToSubject(subject.id, role.id);
  }
  return { subjectId: subject.id };
}

interface SeededTenant {
  tenantId: string;
  tenantName: string;
}

async function seedTenant(
  name: string,
  settings: { registrationAllowed: boolean; verifyEmail?: boolean },
): Promise<SeededTenant> {
  const tenantId = newId();
  await owner.db.insert(tenants).values({
    id: tenantId,
    name,
    registrationAllowed: settings.registrationAllowed,
    verifyEmail: settings.verifyEmail ?? false,
  });
  return { tenantId, tenantName: name };
}

async function createDefaultRole(tenantId: string, name: string): Promise<void> {
  await withTenant(app.db, tenantId, (tx) =>
    roleRepository(tx).create({ tenantId, name, defaultForNewSubjects: true }),
  );
}

async function roleNamesFor(tenantId: string, subjectId: string): Promise<string[]> {
  const roles = await withTenant(app.db, tenantId, (tx) => effectiveRoles(tx, subjectId));
  return roles.map((role) => role.name);
}

async function subjectIdForUsername(tenantId: string, username: string): Promise<string> {
  const found = await withTenant(app.db, tenantId, (tx) => userRepository(tx).byUsername(username));
  if (found === null) throw new Error(`no user named ${username}`);
  return found.subject.id;
}

async function rawSelectAllActionTokens(tenantId: string) {
  return withTenant(app.db, tenantId, (tx) => tx.select().from(actionTokens));
}

async function outboxRows(tenantId: string) {
  return withTenant(app.db, tenantId, (tx) => tx.select().from(emailOutbox));
}

const OUTBOX_OPTIONS: SendPendingOptions = {
  batchSize: 10,
  maxAttempts: 3,
  retryBackoffSeconds: 60,
};

// Registration only queues the mail; the pass that hands it to a transport
// is packages/email/src/usecase/send-pending.ts, and a test that cares
// where the mail ended up runs it here the way the server's schedule runs
// it there.

async function drainOutbox(into: EmailSender = sender): Promise<void> {
  await sendPending(
    { database: app, ownerDatabase: owner, resolveSender: () => Promise.resolve(into) },
    new Date(),
    OUTBOX_OPTIONS,
  );
}

let sender: ReturnType<typeof fakeSender>;
// Defaults to a configured base so most tests exercise the ordinary path;
// the one test for the fail-closed case overrides it to undefined.
let publicBaseUrl: string | undefined;

function buildHttpApp(): FastifyInstance {
  const instance = Fastify();
  instance.register(formbody);
  registerRegistrationRoute(instance, {
    database: app,
    findTenant: (name) => tenantSettingsRepository(owner.db).byName(name),
    publicBaseUrl,
    createAccount,
    evaluatePassword,
  });
  return instance;
}

let httpApp: FastifyInstance;

beforeEach(async () => {
  sender = fakeSender();
  publicBaseUrl = 'https://idp.example.test';
  httpApp = buildHttpApp();
  await httpApp.ready();
});

async function submitRegistration(
  tenantName: string,
  input: NewAccountInput,
): Promise<{ statusCode: number; body: string }> {
  const form = new URLSearchParams({
    username: input.username,
    email: input.email,
    password: input.password,
  });
  const res = await httpApp.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/login-actions/registration`,
    payload: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  return { statusCode: res.statusCode, body: res.body };
}

// Every test below reads either what the queue holds or what a drain
// delivered, so each starts with the queue empty rather than with whatever
// an earlier test left in it.
beforeEach(async () => {
  await owner.db.delete(emailOutbox);
});

describe('self-registration', () => {
  it('is not served at all when the tenant has not enabled it', async () => {
    const { tenantName } = await seedTenant(`tenant-${newId()}`, { registrationAllowed: false });

    const res = await httpApp.inject({ url: `/tenants/${tenantName}/login-actions/registration` });

    expect(res.statusCode).toBe(404);
  });

  it('rejects a request naming a tenant that does not exist', async () => {
    const res = await httpApp.inject({ url: '/tenants/does-not-exist/login-actions/registration' });
    expect(res.statusCode).toBe(404);
  });

  it('creates a user and applies the tenant default roles', async () => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      registrationAllowed: true,
    });
    await createDefaultRole(tenantId, 'offline_access');

    const res = await submitRegistration(tenantName, {
      username: 'ada',
      email: 'ada@example.test',
      password: 'correct horse battery',
    });

    expect(res.statusCode).toBe(201);
    const subjectId = await subjectIdForUsername(tenantId, 'ada');
    expect(await roleNamesFor(tenantId, subjectId)).toEqual(['offline_access']);
  });

  it('refuses a password that fails the tenant policy, and creates nothing', async () => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      registrationAllowed: true,
    });

    const res = await submitRegistration(tenantName, {
      username: 'ada',
      email: 'ada@example.test',
      password: 'short',
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('at least');
    const notCreated = await withTenant(app.db, tenantId, (tx) =>
      userRepository(tx).byUsername('ada'),
    );
    expect(notCreated).toBeNull();
  });

  it('refuses an address another user in the tenant already holds', async () => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      registrationAllowed: true,
    });

    const first = await submitRegistration(tenantName, {
      username: 'ada',
      email: 'ada@example.test',
      password: 'correct horse battery',
    });
    expect(first.statusCode).toBe(201);

    const second = await submitRegistration(tenantName, {
      username: 'grace',
      email: 'ada@example.test',
      password: 'correct horse battery',
    });
    expect(second.statusCode).toBe(400);

    // The refused registration must not have touched the address it
    // collided with — 'ada' still resolves to exactly the account created
    // by the first request, not a row the second one partially wrote.
    const stillAda = await withTenant(app.db, tenantId, (tx) =>
      userRepository(tx).byUsername('ada'),
    );
    expect(stillAda?.user.email).toBe('ada@example.test');
    const grace = await withTenant(app.db, tenantId, (tx) =>
      userRepository(tx).byUsername('grace'),
    );
    expect(grace).toBeNull();
  });

  it('permits the same address in a different tenant', async () => {
    const tenantA = await seedTenant(`tenant-a-${newId()}`, { registrationAllowed: true });
    const tenantB = await seedTenant(`tenant-b-${newId()}`, { registrationAllowed: true });

    const inA = await submitRegistration(tenantA.tenantName, {
      username: 'ada',
      email: 'ada@example.test',
      password: 'correct horse battery',
    });
    expect(inA.statusCode).toBe(201);

    const inB = await submitRegistration(tenantB.tenantName, {
      username: 'ada',
      email: 'ada@example.test',
      password: 'correct horse battery',
    });
    expect(inB.statusCode).toBe(201);

    const userA = await withTenant(app.db, tenantA.tenantId, (tx) =>
      userRepository(tx).byUsername('ada'),
    );
    const userB = await withTenant(app.db, tenantB.tenantId, (tx) =>
      userRepository(tx).byUsername('ada'),
    );
    expect(userA?.user.email).toBe('ada@example.test');
    expect(userB?.user.email).toBe('ada@example.test');
  });

  it('sends a verification email when the tenant requires one, and none when it does not', async () => {
    const withVerify = await seedTenant(`tenant-${newId()}`, {
      registrationAllowed: true,
      verifyEmail: true,
    });
    const withoutVerify = await seedTenant(`tenant-${newId()}`, {
      registrationAllowed: true,
      verifyEmail: false,
    });

    await submitRegistration(withVerify.tenantName, {
      username: 'ada',
      email: 'ada@example.test',
      password: 'correct horse battery',
    });
    // Queued by the request, sent by the pass: nothing left during the
    // request itself, which is what the reset endpoint's timing test
    // (tests/reset-timing.int.test.ts) exists to hold.
    expect(sender.sent).toHaveLength(0);
    await drainOutbox();
    expect(sender.sent).toHaveLength(1);

    await submitRegistration(withoutVerify.tenantName, {
      username: 'grace',
      email: 'grace@example.test',
      password: 'correct horse battery',
    });
    await drainOutbox();
    expect(sender.sent).toHaveLength(1);
  });

  it('refuses a tenant that has been disabled since registration was enabled for it', async () => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      registrationAllowed: true,
    });
    await owner.db.update(tenants).set({ enabled: false }).where(eq(tenants.id, tenantId));

    const res = await httpApp.inject({ url: `/tenants/${tenantName}/login-actions/registration` });
    expect(res.statusCode).toBe(404);
  });

  // The GET tests above prove the form is hidden; an implementation that
  // hid the form but still accepted a submission would pass every one of
  // them, so the submission path needs its own refusals proven directly.
  it('refuses the submission itself, not just the form, when registration is off', async () => {
    const { tenantName } = await seedTenant(`tenant-${newId()}`, { registrationAllowed: false });
    const res = await submitRegistration(tenantName, {
      username: 'ada',
      email: 'ada@example.test',
      password: 'correct horse battery',
    });
    expect(res.statusCode).toBe(404);
  });

  it('refuses the submission for a tenant that does not exist', async () => {
    const res = await submitRegistration('does-not-exist', {
      username: 'ada',
      email: 'ada@example.test',
      password: 'correct horse battery',
    });
    expect(res.statusCode).toBe(404);
  });

  it('refuses the submission once the tenant has been disabled', async () => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      registrationAllowed: true,
    });
    await owner.db.update(tenants).set({ enabled: false }).where(eq(tenants.id, tenantId));

    const res = await submitRegistration(tenantName, {
      username: 'ada',
      email: 'ada@example.test',
      password: 'correct horse battery',
    });
    expect(res.statusCode).toBe(404);
  });

  it('refuses a blank username rather than creating an unnamed account', async () => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      registrationAllowed: true,
    });

    const res = await submitRegistration(tenantName, {
      username: '',
      email: 'ada@example.test',
      password: 'correct horse battery',
    });

    expect(res.statusCode).toBe(400);
    const stillNone = await withTenant(app.db, tenantId, (tx) =>
      userRepository(tx).byUsername('ada'),
    );
    expect(stillNone).toBeNull();
  });

  it('refuses a username another user in the tenant already holds, as a 400', async () => {
    const { tenantName } = await seedTenant(`tenant-${newId()}`, { registrationAllowed: true });

    const first = await submitRegistration(tenantName, {
      username: 'ada',
      email: 'ada@example.test',
      password: 'correct horse battery',
    });
    expect(first.statusCode).toBe(201);

    const second = await submitRegistration(tenantName, {
      username: 'ada',
      email: 'grace@example.test',
      password: 'correct horse battery',
    });

    expect(second.statusCode).toBe(400);
  });

  it('refuses a malformed address as a 400, not an unhandled error', async () => {
    const { tenantName } = await seedTenant(`tenant-${newId()}`, { registrationAllowed: true });

    const res = await submitRegistration(tenantName, {
      username: 'ada',
      email: 'not-an-email',
      password: 'correct horse battery',
    });

    expect(res.statusCode).toBe(400);
  });

  it('registers the account whatever the transport later does with the mail', async () => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      registrationAllowed: true,
      verifyEmail: true,
    });
    const throwingSender: EmailSender = {
      send: () => Promise.reject(new Error('mail transport unavailable')),
    };

    const res = await submitRegistration(tenantName, {
      username: 'ada',
      email: 'ada@example.test',
      password: 'correct horse battery',
    });

    // The transport is not on this path at all, so its failures cannot
    // reach the caller: the account is created, the token is stored, and
    // the message waits for a pass that can retry it.
    expect(res.statusCode).toBe(201);
    expect(await rawSelectAllActionTokens(tenantId)).toHaveLength(1);

    await drainOutbox(throwingSender);

    const queued = await outboxRows(tenantId);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.sentAt).toBeNull();
    expect(queued[0]?.lastError).toBe('mail transport unavailable');
    const created = await withTenant(app.db, tenantId, (tx) =>
      userRepository(tx).byUsername('ada'),
    );
    expect(created).not.toBeNull();
  });

  it('refuses to register when verify_email is on but no public base url is configured', async () => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      registrationAllowed: true,
      verifyEmail: true,
    });
    publicBaseUrl = undefined;
    httpApp = buildHttpApp();
    await httpApp.ready();

    const res = await submitRegistration(tenantName, {
      username: 'ada',
      email: 'ada@example.test',
      password: 'correct horse battery',
    });

    expect(res.statusCode).toBe(500);
    const notCreated = await withTenant(app.db, tenantId, (tx) =>
      userRepository(tx).byUsername('ada'),
    );
    expect(notCreated).toBeNull();
    expect(await outboxRows(tenantId)).toEqual([]);
  });
});
