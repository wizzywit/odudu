import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
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
import { realmSettingsRepository } from '#/repository/realm-settings';
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
  tx: RealmScopedDatabase,
  realmId: string,
  input: NewAccountInput,
): Promise<CreateAccountResult> {
  const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
  await userRepository(tx).create({
    subjectId: subject.id,
    realmId,
    username: input.username,
    email: input.email,
  });
  await credentialRepository(tx).insert({
    realmId,
    subjectId: subject.id,
    type: 'password',
    secret: { kind: 'password', hash: await hashPassword(input.password) },
  });
  const defaults = await roleRepository(tx).defaultsForRealm();
  for (const role of defaults) {
    await roleRepository(tx).assignToSubject(subject.id, role.id);
  }
  return { subjectId: subject.id };
}

interface SeededRealm {
  realmId: string;
  realmName: string;
}

async function seedRealm(
  name: string,
  settings: { registrationAllowed: boolean; verifyEmail?: boolean },
): Promise<SeededRealm> {
  const realmId = newId();
  await owner.db.insert(realms).values({
    id: realmId,
    name,
    registrationAllowed: settings.registrationAllowed,
    verifyEmail: settings.verifyEmail ?? false,
  });
  return { realmId, realmName: name };
}

async function createDefaultRole(realmId: string, name: string): Promise<void> {
  await withRealm(app.db, realmId, (tx) =>
    roleRepository(tx).create({ realmId, name, defaultForNewSubjects: true }),
  );
}

async function roleNamesFor(realmId: string, subjectId: string): Promise<string[]> {
  const roles = await withRealm(app.db, realmId, (tx) => effectiveRoles(tx, subjectId));
  return roles.map((role) => role.name);
}

async function subjectIdForUsername(realmId: string, username: string): Promise<string> {
  const found = await withRealm(app.db, realmId, (tx) => userRepository(tx).byUsername(username));
  if (found === null) throw new Error(`no user named ${username}`);
  return found.subject.id;
}

async function rawSelectAllActionTokens(realmId: string) {
  return withRealm(app.db, realmId, (tx) => tx.select().from(actionTokens));
}

async function outboxRows(realmId: string) {
  return withRealm(app.db, realmId, (tx) => tx.select().from(emailOutbox));
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
    { database: app, ownerDatabase: owner, sender: into },
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
    findRealm: (name) => realmSettingsRepository(owner.db).byName(name),
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
  realmName: string,
  input: NewAccountInput,
): Promise<{ statusCode: number; body: string }> {
  const form = new URLSearchParams({
    username: input.username,
    email: input.email,
    password: input.password,
  });
  const res = await httpApp.inject({
    method: 'POST',
    url: `/realms/${realmName}/login-actions/registration`,
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
  it('is not served at all when the realm has not enabled it', async () => {
    const { realmName } = await seedRealm(`realm-${newId()}`, { registrationAllowed: false });

    const res = await httpApp.inject({ url: `/realms/${realmName}/login-actions/registration` });

    expect(res.statusCode).toBe(404);
  });

  it('rejects a request naming a realm that does not exist', async () => {
    const res = await httpApp.inject({ url: '/realms/does-not-exist/login-actions/registration' });
    expect(res.statusCode).toBe(404);
  });

  it('creates a user and applies the realm default roles', async () => {
    const { realmId, realmName } = await seedRealm(`realm-${newId()}`, {
      registrationAllowed: true,
    });
    await createDefaultRole(realmId, 'offline_access');

    const res = await submitRegistration(realmName, {
      username: 'ada',
      email: 'ada@example.test',
      password: 'correct horse battery',
    });

    expect(res.statusCode).toBe(201);
    const subjectId = await subjectIdForUsername(realmId, 'ada');
    expect(await roleNamesFor(realmId, subjectId)).toEqual(['offline_access']);
  });

  it('refuses a password that fails the realm policy, and creates nothing', async () => {
    const { realmId, realmName } = await seedRealm(`realm-${newId()}`, {
      registrationAllowed: true,
    });

    const res = await submitRegistration(realmName, {
      username: 'ada',
      email: 'ada@example.test',
      password: 'short',
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('at least');
    const notCreated = await withRealm(app.db, realmId, (tx) =>
      userRepository(tx).byUsername('ada'),
    );
    expect(notCreated).toBeNull();
  });

  it('refuses an address another user in the realm already holds', async () => {
    const { realmId, realmName } = await seedRealm(`realm-${newId()}`, {
      registrationAllowed: true,
    });

    const first = await submitRegistration(realmName, {
      username: 'ada',
      email: 'ada@example.test',
      password: 'correct horse battery',
    });
    expect(first.statusCode).toBe(201);

    const second = await submitRegistration(realmName, {
      username: 'grace',
      email: 'ada@example.test',
      password: 'correct horse battery',
    });
    expect(second.statusCode).toBe(400);

    // The refused registration must not have touched the address it
    // collided with — 'ada' still resolves to exactly the account created
    // by the first request, not a row the second one partially wrote.
    const stillAda = await withRealm(app.db, realmId, (tx) => userRepository(tx).byUsername('ada'));
    expect(stillAda?.user.email).toBe('ada@example.test');
    const grace = await withRealm(app.db, realmId, (tx) => userRepository(tx).byUsername('grace'));
    expect(grace).toBeNull();
  });

  it('permits the same address in a different realm', async () => {
    const realmA = await seedRealm(`realm-a-${newId()}`, { registrationAllowed: true });
    const realmB = await seedRealm(`realm-b-${newId()}`, { registrationAllowed: true });

    const inA = await submitRegistration(realmA.realmName, {
      username: 'ada',
      email: 'ada@example.test',
      password: 'correct horse battery',
    });
    expect(inA.statusCode).toBe(201);

    const inB = await submitRegistration(realmB.realmName, {
      username: 'ada',
      email: 'ada@example.test',
      password: 'correct horse battery',
    });
    expect(inB.statusCode).toBe(201);

    const userA = await withRealm(app.db, realmA.realmId, (tx) =>
      userRepository(tx).byUsername('ada'),
    );
    const userB = await withRealm(app.db, realmB.realmId, (tx) =>
      userRepository(tx).byUsername('ada'),
    );
    expect(userA?.user.email).toBe('ada@example.test');
    expect(userB?.user.email).toBe('ada@example.test');
  });

  it('sends a verification email when the realm requires one, and none when it does not', async () => {
    const withVerify = await seedRealm(`realm-${newId()}`, {
      registrationAllowed: true,
      verifyEmail: true,
    });
    const withoutVerify = await seedRealm(`realm-${newId()}`, {
      registrationAllowed: true,
      verifyEmail: false,
    });

    await submitRegistration(withVerify.realmName, {
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

    await submitRegistration(withoutVerify.realmName, {
      username: 'grace',
      email: 'grace@example.test',
      password: 'correct horse battery',
    });
    await drainOutbox();
    expect(sender.sent).toHaveLength(1);
  });

  it('refuses a realm that has been disabled since registration was enabled for it', async () => {
    const { realmId, realmName } = await seedRealm(`realm-${newId()}`, {
      registrationAllowed: true,
    });
    await owner.db.update(realms).set({ enabled: false }).where(eq(realms.id, realmId));

    const res = await httpApp.inject({ url: `/realms/${realmName}/login-actions/registration` });
    expect(res.statusCode).toBe(404);
  });

  // The GET tests above prove the form is hidden; an implementation that
  // hid the form but still accepted a submission would pass every one of
  // them, so the submission path needs its own refusals proven directly.
  it('refuses the submission itself, not just the form, when registration is off', async () => {
    const { realmName } = await seedRealm(`realm-${newId()}`, { registrationAllowed: false });
    const res = await submitRegistration(realmName, {
      username: 'ada',
      email: 'ada@example.test',
      password: 'correct horse battery',
    });
    expect(res.statusCode).toBe(404);
  });

  it('refuses the submission for a realm that does not exist', async () => {
    const res = await submitRegistration('does-not-exist', {
      username: 'ada',
      email: 'ada@example.test',
      password: 'correct horse battery',
    });
    expect(res.statusCode).toBe(404);
  });

  it('refuses the submission once the realm has been disabled', async () => {
    const { realmId, realmName } = await seedRealm(`realm-${newId()}`, {
      registrationAllowed: true,
    });
    await owner.db.update(realms).set({ enabled: false }).where(eq(realms.id, realmId));

    const res = await submitRegistration(realmName, {
      username: 'ada',
      email: 'ada@example.test',
      password: 'correct horse battery',
    });
    expect(res.statusCode).toBe(404);
  });

  it('refuses a blank username rather than creating an unnamed account', async () => {
    const { realmId, realmName } = await seedRealm(`realm-${newId()}`, {
      registrationAllowed: true,
    });

    const res = await submitRegistration(realmName, {
      username: '',
      email: 'ada@example.test',
      password: 'correct horse battery',
    });

    expect(res.statusCode).toBe(400);
    const stillNone = await withRealm(app.db, realmId, (tx) =>
      userRepository(tx).byUsername('ada'),
    );
    expect(stillNone).toBeNull();
  });

  it('refuses a username another user in the realm already holds, as a 400', async () => {
    const { realmName } = await seedRealm(`realm-${newId()}`, { registrationAllowed: true });

    const first = await submitRegistration(realmName, {
      username: 'ada',
      email: 'ada@example.test',
      password: 'correct horse battery',
    });
    expect(first.statusCode).toBe(201);

    const second = await submitRegistration(realmName, {
      username: 'ada',
      email: 'grace@example.test',
      password: 'correct horse battery',
    });

    expect(second.statusCode).toBe(400);
  });

  it('refuses a malformed address as a 400, not an unhandled error', async () => {
    const { realmName } = await seedRealm(`realm-${newId()}`, { registrationAllowed: true });

    const res = await submitRegistration(realmName, {
      username: 'ada',
      email: 'not-an-email',
      password: 'correct horse battery',
    });

    expect(res.statusCode).toBe(400);
  });

  it('registers the account whatever the transport later does with the mail', async () => {
    const { realmId, realmName } = await seedRealm(`realm-${newId()}`, {
      registrationAllowed: true,
      verifyEmail: true,
    });
    const throwingSender: EmailSender = {
      send: () => Promise.reject(new Error('mail transport unavailable')),
    };

    const res = await submitRegistration(realmName, {
      username: 'ada',
      email: 'ada@example.test',
      password: 'correct horse battery',
    });

    // The transport is not on this path at all, so its failures cannot
    // reach the caller: the account is created, the token is stored, and
    // the message waits for a pass that can retry it.
    expect(res.statusCode).toBe(201);
    expect(await rawSelectAllActionTokens(realmId)).toHaveLength(1);

    await drainOutbox(throwingSender);

    const queued = await outboxRows(realmId);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.sentAt).toBeNull();
    expect(queued[0]?.lastError).toBe('mail transport unavailable');
    const created = await withRealm(app.db, realmId, (tx) => userRepository(tx).byUsername('ada'));
    expect(created).not.toBeNull();
  });

  it('refuses to register when verify_email is on but no public base url is configured', async () => {
    const { realmId, realmName } = await seedRealm(`realm-${newId()}`, {
      registrationAllowed: true,
      verifyEmail: true,
    });
    publicBaseUrl = undefined;
    httpApp = buildHttpApp();
    await httpApp.ready();

    const res = await submitRegistration(realmName, {
      username: 'ada',
      email: 'ada@example.test',
      password: 'correct horse battery',
    });

    expect(res.statusCode).toBe(500);
    const notCreated = await withRealm(app.db, realmId, (tx) =>
      userRepository(tx).byUsername('ada'),
    );
    expect(notCreated).toBeNull();
    expect(await outboxRows(realmId)).toEqual([]);
  });
});
