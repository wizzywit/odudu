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
  hashPassword,
  subjectRepository,
  userRepository,
} from '@odudu/domain-identity';
import { type EmailMessage, type EmailSender } from '@odudu/email';
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
  await credentialRepository(tx).create({
    realmId,
    subjectId: subject.id,
    type: 'password',
    secretData: await hashPassword(input.password),
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

let sender: ReturnType<typeof fakeSender>;
// Defaults to a configured base so most tests exercise the ordinary path;
// the one test for the fail-closed case overrides it to undefined.
let publicBaseUrl: string | undefined;

function buildHttpApp(): FastifyInstance {
  const instance = Fastify();
  instance.register(formbody);
  registerRegistrationRoute(instance, {
    database: app,
    sender,
    findRealm: (name) => realmSettingsRepository(owner.db).byName(name),
    publicBaseUrl,
    createAccount,
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

  it('refuses an address another user in the realm already holds', async () => {
    const { realmId, realmName } = await seedRealm(`realm-${newId()}`, {
      registrationAllowed: true,
    });

    const first = await submitRegistration(realmName, {
      username: 'ada',
      email: 'ada@example.test',
      password: 'p',
    });
    expect(first.statusCode).toBe(201);

    const second = await submitRegistration(realmName, {
      username: 'grace',
      email: 'ada@example.test',
      password: 'p',
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
      password: 'p',
    });
    expect(inA.statusCode).toBe(201);

    const inB = await submitRegistration(realmB.realmName, {
      username: 'ada',
      email: 'ada@example.test',
      password: 'p',
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
      password: 'p',
    });
    expect(sender.sent).toHaveLength(1);

    await submitRegistration(withoutVerify.realmName, {
      username: 'grace',
      email: 'grace@example.test',
      password: 'p',
    });
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
      password: 'p',
    });
    expect(res.statusCode).toBe(404);
  });

  it('refuses the submission for a realm that does not exist', async () => {
    const res = await submitRegistration('does-not-exist', {
      username: 'ada',
      email: 'ada@example.test',
      password: 'p',
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
      password: 'p',
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
      password: 'p',
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
      password: 'p',
    });
    expect(first.statusCode).toBe(201);

    const second = await submitRegistration(realmName, {
      username: 'ada',
      email: 'grace@example.test',
      password: 'p',
    });

    expect(second.statusCode).toBe(400);
  });

  it('refuses a malformed address as a 400, not an unhandled error', async () => {
    const { realmName } = await seedRealm(`realm-${newId()}`, { registrationAllowed: true });

    const res = await submitRegistration(realmName, {
      username: 'ada',
      email: 'not-an-email',
      password: 'p',
    });

    expect(res.statusCode).toBe(400);
  });

  it('sends the mail only after the transaction that issued the token commits', async () => {
    const { realmId, realmName } = await seedRealm(`realm-${newId()}`, {
      registrationAllowed: true,
      verifyEmail: true,
    });
    // A sender that throws still leaves the token stored: proof that the
    // insert already committed before send was even attempted, not proof
    // merely that both eventually happened.
    const throwingSender: EmailSender = {
      send: () => Promise.reject(new Error('mail transport unavailable')),
    };
    const instance = Fastify();
    await instance.register(formbody);
    registerRegistrationRoute(instance, {
      database: app,
      sender: throwingSender,
      findRealm: (name) => realmSettingsRepository(owner.db).byName(name),
      publicBaseUrl: 'https://idp.example.test',
      createAccount,
    });
    await instance.ready();

    const form = new URLSearchParams({
      username: 'ada',
      email: 'ada@example.test',
      password: 'p',
    });
    const res = await instance.inject({
      method: 'POST',
      url: `/realms/${realmName}/login-actions/registration`,
      payload: form.toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(res.statusCode).toBe(500);
    const stored = await rawSelectAllActionTokens(realmId);
    expect(stored).toHaveLength(1);
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
      password: 'p',
    });

    expect(res.statusCode).toBe(500);
    const notCreated = await withRealm(app.db, realmId, (tx) =>
      userRepository(tx).byUsername('ada'),
    );
    expect(notCreated).toBeNull();
    expect(sender.sent).toHaveLength(0);
  });
});
