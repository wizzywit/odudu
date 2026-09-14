import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import {
  credentialRepository,
  hashPassword,
  subjectRepository,
  userRepository,
  verifyPassword,
} from '@odudu/domain-identity';
import { type EmailMessage, type EmailSender } from '@odudu/email';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { registerActionTokenRoute } from '#/view/routes/action-token';
import { realmSettingsRepository } from '#/repository/realm-settings';
import { registerResetPasswordRoute } from '#/view/routes/reset-password';
import { actionTokens } from '#/schema/action-tokens';

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

// packages/email/src/service/templates.ts renders the link as plain text
// after "by visiting this link:\n\n"; extracting it here is what lets a
// test exercise the same URL a real inbox would show, path and query
// included — the same idiom packages/account/tests/verify-email.int.test.ts
// uses.
function extractLink(message: EmailMessage): string {
  const match = /visiting this link:\n\n(\S+)/.exec(message.text);
  if (match?.[1] === undefined) {
    throw new Error(`no link found in ${message.text}`);
  }
  return match[1];
}

function keyFromLink(link: string): string {
  const key = new URL(link).searchParams.get('key');
  if (key === null) throw new Error(`no key in ${link}`);
  return key;
}

// The real domain-identity wiring, exercised here the way
// apps/server/src/app.ts wires it for real: @odudu/account itself never
// imports @odudu/domain-identity, so this test performs the composition
// root's job on its behalf, the same way register.int.test.ts's
// createAccount does.
async function createAccount(
  tx: RealmScopedDatabase,
  realmId: string,
  input: { username: string; email: string; password: string },
): Promise<{ subjectId: string }> {
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
  return { subjectId: subject.id };
}

interface SeededRealm {
  realmId: string;
  realmName: string;
}

async function seedRealm(
  name: string,
  settings: { resetPasswordAllowed: boolean },
): Promise<SeededRealm> {
  const realmId = newId();
  await owner.db.insert(realms).values({
    id: realmId,
    name,
    resetPasswordAllowed: settings.resetPasswordAllowed,
  });
  return { realmId, realmName: name };
}

// @odudu/account never imports @odudu/domain-identity's Argon2id path
// directly either — verifying here, the way a login attempt would, is what
// lets a test tell "the reset actually changed the credential" apart from
// "the request merely returned 200".
async function passwordWorksFor(
  realmId: string,
  username: string,
  password: string,
): Promise<boolean> {
  return withRealm(app.db, realmId, async (tx) => {
    const found = await userRepository(tx).byUsername(username);
    if (found === null) return false;
    const stored = await credentialRepository(tx).passwordFor(found.subject.id);
    if (stored === null) return false;
    return verifyPassword(stored, password);
  });
}

async function rawSelectAllActionTokens(realmId: string) {
  return withRealm(app.db, realmId, (tx) => tx.select().from(actionTokens));
}

let sender: ReturnType<typeof fakeSender>;
let httpApp: FastifyInstance;

function buildHttpApp(): FastifyInstance {
  const instance = Fastify();
  instance.register(formbody);
  registerResetPasswordRoute(instance, {
    database: app,
    sender,
    findRealm: (name) => realmSettingsRepository(owner.db).byName(name),
    publicBaseUrl: 'https://idp.example.test',
    findByEmail: async (tx, email) => {
      const user = await userRepository(tx).byEmail(email);
      return user === null ? null : { subjectId: user.subjectId };
    },
  });
  registerActionTokenRoute(instance, {
    database: app,
    findRealm: (name) => realmSettingsRepository(owner.db).byName(name),
    getCurrentEmail: async (tx, subjectId) =>
      (await userRepository(tx).bySubjectId(subjectId))?.email ?? null,
    markVerified: async (tx, subjectId) => {
      await userRepository(tx).markEmailVerified(subjectId);
    },
    setPassword: async (tx, subjectId, password) => {
      await credentialRepository(tx).setPassword(subjectId, await hashPassword(password));
    },
  });
  return instance;
}

beforeEach(async () => {
  sender = fakeSender();
  httpApp = buildHttpApp();
  await httpApp.ready();
});

async function requestReset(
  realmName: string,
  email: string,
): Promise<{ statusCode: number; body: string }> {
  const form = new URLSearchParams({ email });
  const res = await httpApp.inject({
    method: 'POST',
    url: `/realms/${realmName}/login-actions/reset-password`,
    payload: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  return { statusCode: res.statusCode, body: res.body };
}

async function submitNewPassword(
  link: string,
  password: string,
): Promise<{ statusCode: number; body: string }> {
  const form = new URLSearchParams({ key: keyFromLink(link), password });
  const res = await httpApp.inject({
    method: 'POST',
    url: new URL(link).pathname,
    payload: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  return { statusCode: res.statusCode, body: res.body };
}

describe('password reset', () => {
  it('answers identically for a known and an unknown address', async () => {
    const { realmId, realmName } = await seedRealm(`realm-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await withRealm(app.db, realmId, (tx) =>
      createAccount(tx, realmId, {
        username: 'ada',
        email: 'ada@example.test',
        password: 'correct horse battery',
      }),
    );

    const known = await requestReset(realmName, 'ada@example.test');
    const unknown = await requestReset(realmName, 'nobody@example.test');

    expect(unknown.statusCode).toBe(known.statusCode);
    expect(unknown.body).toBe(known.body);
    expect(known.statusCode).toBe(200);
  });

  it('sends mail only for the address that exists', async () => {
    const { realmId, realmName } = await seedRealm(`realm-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await withRealm(app.db, realmId, (tx) =>
      createAccount(tx, realmId, {
        username: 'ada',
        email: 'ada@example.test',
        password: 'correct horse battery',
      }),
    );

    await requestReset(realmName, 'nobody@example.test');
    expect(sender.sent).toHaveLength(0);

    await requestReset(realmName, 'ada@example.test');
    expect(sender.sent).toHaveLength(1);
  });

  it('sets a new password the user can then log in with', async () => {
    const { realmId, realmName } = await seedRealm(`realm-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await withRealm(app.db, realmId, (tx) =>
      createAccount(tx, realmId, {
        username: 'ada',
        email: 'ada@example.test',
        password: 'correct horse battery',
      }),
    );

    await requestReset(realmName, 'ada@example.test');
    const message = sender.sent[0];
    if (message === undefined) throw new Error('no mail sent');
    const link = extractLink(message);

    const submitted = await submitNewPassword(link, 'a new password');
    expect(submitted.statusCode).toBe(200);

    expect(await passwordWorksFor(realmId, 'ada', 'a new password')).toBe(true);
  });

  it('stops the old password working', async () => {
    const { realmId, realmName } = await seedRealm(`realm-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await withRealm(app.db, realmId, (tx) =>
      createAccount(tx, realmId, {
        username: 'ada',
        email: 'ada@example.test',
        password: 'correct horse battery',
      }),
    );

    await requestReset(realmName, 'ada@example.test');
    const message = sender.sent[0];
    if (message === undefined) throw new Error('no mail sent');
    await submitNewPassword(extractLink(message), 'a new password');

    expect(await passwordWorksFor(realmId, 'ada', 'correct horse battery')).toBe(false);
    expect(await passwordWorksFor(realmId, 'ada', 'a new password')).toBe(true);
  });

  it('refuses a reset link a second time', async () => {
    const { realmId, realmName } = await seedRealm(`realm-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await withRealm(app.db, realmId, (tx) =>
      createAccount(tx, realmId, {
        username: 'ada',
        email: 'ada@example.test',
        password: 'correct horse battery',
      }),
    );

    await requestReset(realmName, 'ada@example.test');
    const message = sender.sent[0];
    if (message === undefined) throw new Error('no mail sent');
    const link = extractLink(message);

    const first = await submitNewPassword(link, 'first password');
    expect(first.statusCode).toBe(200);

    const second = await submitNewPassword(link, 'second password');
    expect(second.statusCode).toBe(400);

    expect(await passwordWorksFor(realmId, 'ada', 'second password')).toBe(false);
    expect(await passwordWorksFor(realmId, 'ada', 'first password')).toBe(true);
  });

  it('is not served when the realm has not enabled it', async () => {
    const { realmName } = await seedRealm(`realm-${newId()}`, { resetPasswordAllowed: false });

    const res = await httpApp.inject({
      url: `/realms/${realmName}/login-actions/reset-password`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('refuses the submission itself, not just the form, when reset is off', async () => {
    const { realmName } = await seedRealm(`realm-${newId()}`, { resetPasswordAllowed: false });

    const res = await requestReset(realmName, 'ada@example.test');
    expect(res.statusCode).toBe(404);
  });

  it('refuses the form once the realm has been disabled', async () => {
    const { realmId, realmName } = await seedRealm(`realm-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await owner.db.update(realms).set({ enabled: false }).where(eq(realms.id, realmId));

    const res = await httpApp.inject({
      url: `/realms/${realmName}/login-actions/reset-password`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('refuses the submission once the realm has been disabled', async () => {
    const { realmId, realmName } = await seedRealm(`realm-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await owner.db.update(realms).set({ enabled: false }).where(eq(realms.id, realmId));

    const res = await requestReset(realmName, 'ada@example.test');
    expect(res.statusCode).toBe(404);
  });

  it('rejects a request naming a realm that does not exist', async () => {
    const res = await httpApp.inject({
      url: '/realms/does-not-exist/login-actions/reset-password',
    });
    expect(res.statusCode).toBe(404);
  });

  it('sends the mail only after the transaction that issued the token commits', async () => {
    const { realmId, realmName } = await seedRealm(`realm-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await withRealm(app.db, realmId, (tx) =>
      createAccount(tx, realmId, {
        username: 'ada',
        email: 'ada@example.test',
        password: 'correct horse battery',
      }),
    );

    const throwingSender: EmailSender = {
      send: () => Promise.reject(new Error('mail transport unavailable')),
    };
    const instance = Fastify();
    await instance.register(formbody);
    registerResetPasswordRoute(instance, {
      database: app,
      sender: throwingSender,
      findRealm: (name) => realmSettingsRepository(owner.db).byName(name),
      publicBaseUrl: 'https://idp.example.test',
      findByEmail: async (tx, email) => {
        const user = await userRepository(tx).byEmail(email);
        return user === null ? null : { subjectId: user.subjectId };
      },
    });
    await instance.ready();

    const form = new URLSearchParams({ email: 'ada@example.test' });
    const res = await instance.inject({
      method: 'POST',
      url: `/realms/${realmName}/login-actions/reset-password`,
      payload: form.toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(res.statusCode).toBe(500);
    const stored = await rawSelectAllActionTokens(realmId);
    expect(stored).toHaveLength(1);
  });

  it('refuses when no public base url is configured, for every address the same way', async () => {
    const { realmName } = await seedRealm(`realm-${newId()}`, { resetPasswordAllowed: true });
    const instance = Fastify();
    await instance.register(formbody);
    registerResetPasswordRoute(instance, {
      database: app,
      sender,
      findRealm: (name) => realmSettingsRepository(owner.db).byName(name),
      publicBaseUrl: undefined,
      findByEmail: async (tx, email) => {
        const user = await userRepository(tx).byEmail(email);
        return user === null ? null : { subjectId: user.subjectId };
      },
    });
    await instance.ready();

    const form = new URLSearchParams({ email: 'ada@example.test' });
    const res = await instance.inject({
      method: 'POST',
      url: `/realms/${realmName}/login-actions/reset-password`,
      payload: form.toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(res.statusCode).toBe(500);
    expect(sender.sent).toHaveLength(0);
  });

  it('refuses a submission missing the email field as a 400', async () => {
    const { realmName } = await seedRealm(`realm-${newId()}`, { resetPasswordAllowed: true });

    const res = await httpApp.inject({
      method: 'POST',
      url: `/realms/${realmName}/login-actions/reset-password`,
      payload: '',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.statusCode).toBe(400);
  });
});
