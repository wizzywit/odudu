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
  evaluatePassword,
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
import { actionTokenRepository } from '#/repository/action-tokens';
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

// @odudu/account never imports @odudu/domain-identity, so the composition
// root's findByEmail closure — apps/server/src/app.ts wires this exact
// shape against userRepository.byEmail — is stood in for here.
async function findByEmail(
  tx: RealmScopedDatabase,
  email: string,
): Promise<{ subjectId: string; email: string } | null> {
  const user = await userRepository(tx).byEmail(email);
  return user?.email == null ? null : { subjectId: user.subjectId, email: user.email };
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
  await credentialRepository(tx).insert({
    realmId,
    subjectId: subject.id,
    type: 'password',
    secret: { kind: 'password', hash: await hashPassword(input.password) },
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

async function seedAda(realmId: string): Promise<void> {
  await withRealm(app.db, realmId, (tx) =>
    createAccount(tx, realmId, {
      username: 'ada',
      email: 'ada@example.test',
      password: 'correct horse battery',
    }),
  );
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
    findByEmail,
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
    getUsername: async (tx, subjectId) => {
      const user = await userRepository(tx).bySubjectId(subjectId);
      if (user === null) throw new Error(`no user found for subject ${subjectId}`);
      return user.username;
    },
    evaluatePassword,
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

async function getResetForm(link: string): Promise<{ statusCode: number; body: string }> {
  const res = await httpApp.inject({ method: 'GET', url: link });
  return { statusCode: res.statusCode, body: res.body };
}

async function submitNewPassword(
  link: string,
  password: string | undefined,
): Promise<{ statusCode: number; body: string }> {
  const key = keyFromLink(link);
  const form = new URLSearchParams(password === undefined ? { key } : { key, password });
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
    await seedAda(realmId);

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
    await seedAda(realmId);

    await requestReset(realmName, 'nobody@example.test');
    expect(sender.sent).toHaveLength(0);

    await requestReset(realmName, 'ada@example.test');
    expect(sender.sent).toHaveLength(1);
  });

  it('renders a set-password form for an unconsumed reset link, without consuming it', async () => {
    const { realmId, realmName } = await seedRealm(`realm-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await seedAda(realmId);

    await requestReset(realmName, 'ada@example.test');
    const message = sender.sent[0];
    if (message === undefined) throw new Error('no mail sent');
    const link = extractLink(message);

    const form = await getResetForm(link);
    expect(form.statusCode).toBe(200);
    expect(form.body).toContain('New password');

    // Still redeemable: rendering the form must not have consumed it.
    const submitted = await submitNewPassword(link, 'a new password');
    expect(submitted.statusCode).toBe(200);
  });

  it('sets a new password the user can then log in with', async () => {
    const { realmId, realmName } = await seedRealm(`realm-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await seedAda(realmId);

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
    await seedAda(realmId);

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
    await seedAda(realmId);

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

  it('kills a sibling reset link for the same subject once one is completed', async () => {
    const { realmId, realmName } = await seedRealm(`realm-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await seedAda(realmId);

    await requestReset(realmName, 'ada@example.test');
    await requestReset(realmName, 'ada@example.test');
    expect(sender.sent).toHaveLength(2);
    const [firstMessage, secondMessage] = sender.sent;
    if (firstMessage === undefined || secondMessage === undefined) {
      throw new Error('expected two reset mails');
    }
    const firstLink = extractLink(firstMessage);
    const secondLink = extractLink(secondMessage);
    expect(firstLink).not.toBe(secondLink);

    const completedFirst = await submitNewPassword(firstLink, 'first password');
    expect(completedFirst.statusCode).toBe(200);

    const attemptSecond = await submitNewPassword(secondLink, 'second password');
    expect(attemptSecond.statusCode).toBe(400);
    expect(await passwordWorksFor(realmId, 'ada', 'second password')).toBe(false);
    expect(await passwordWorksFor(realmId, 'ada', 'first password')).toBe(true);
  });

  it('refuses a verify_email token presented to the reset-password submission', async () => {
    const { realmId, realmName } = await seedRealm(`realm-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await seedAda(realmId);

    // No verify_email flow is wired in this file's httpApp, so a token of
    // that type is seeded directly, the same idiom
    // packages/account/tests/action-tokens.int.test.ts uses.
    const subjectId = await withRealm(app.db, realmId, async (tx) => {
      const found = await userRepository(tx).byUsername('ada');
      if (found === null) throw new Error('ada not found');
      return found.subject.id;
    });
    const { token } = await withRealm(app.db, realmId, (tx) =>
      actionTokenRepository(tx).issue({
        realmId,
        subjectId,
        type: 'verify_email',
        ttlSeconds: 3600,
      }),
    );

    const res = await httpApp.inject({
      method: 'POST',
      url: `/realms/${realmName}/login-actions/action-token`,
      payload: new URLSearchParams({ key: token, password: 'whatever' }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.statusCode).toBe(400);
    expect(await passwordWorksFor(realmId, 'ada', 'whatever')).toBe(false);
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

  it('rejects a request naming a realm that does not exist, on the form and on the submission', async () => {
    const formRes = await httpApp.inject({
      url: '/realms/does-not-exist/login-actions/reset-password',
    });
    expect(formRes.statusCode).toBe(404);

    const submitRes = await requestReset('does-not-exist', 'ada@example.test');
    expect(submitRes.statusCode).toBe(404);
  });

  it('closes redemption once reset_password_allowed is turned off, for both the form and the submission', async () => {
    const { realmId, realmName } = await seedRealm(`realm-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await seedAda(realmId);

    await requestReset(realmName, 'ada@example.test');
    const message = sender.sent[0];
    if (message === undefined) throw new Error('no mail sent');
    const link = extractLink(message);

    await owner.db
      .update(realms)
      .set({ resetPasswordAllowed: false })
      .where(eq(realms.id, realmId));

    const form = await getResetForm(link);
    expect(form.statusCode).toBe(400);

    const submitted = await submitNewPassword(link, 'a new password');
    expect(submitted.statusCode).toBe(400);
    expect(await passwordWorksFor(realmId, 'ada', 'a new password')).toBe(false);
  });

  it('a verify_email link still redeems while reset_password_allowed is off', async () => {
    const { realmId, realmName } = await seedRealm(`realm-${newId()}`, {
      resetPasswordAllowed: false,
    });
    await seedAda(realmId);
    const subjectId = await withRealm(app.db, realmId, async (tx) => {
      const found = await userRepository(tx).byUsername('ada');
      if (found === null) throw new Error('ada not found');
      return found.subject.id;
    });
    const { token } = await withRealm(app.db, realmId, (tx) =>
      actionTokenRepository(tx).issue({
        realmId,
        subjectId,
        type: 'verify_email',
        email: 'ada@example.test',
        ttlSeconds: 3600,
      }),
    );

    const res = await httpApp.inject({
      method: 'GET',
      url: `/realms/${realmName}/login-actions/action-token?key=${token}`,
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a POST missing only the password as a distinct, non-misleading refusal', async () => {
    const { realmId, realmName } = await seedRealm(`realm-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await seedAda(realmId);

    await requestReset(realmName, 'ada@example.test');
    const message = sender.sent[0];
    if (message === undefined) throw new Error('no mail sent');
    const link = extractLink(message);

    const missingPassword = await submitNewPassword(link, undefined);
    expect(missingPassword.statusCode).toBe(400);
    expect(missingPassword.body).not.toContain("can't be used");

    // The link itself is still perfectly good.
    const retried = await submitNewPassword(link, 'a new password');
    expect(retried.statusCode).toBe(200);
  });

  it('absorbs a mail transport failure and answers the fixed 200 anyway, after the token is durably stored', async () => {
    const { realmId, realmName } = await seedRealm(`realm-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await seedAda(realmId);

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
      findByEmail,
    });
    await instance.ready();

    const form = new URLSearchParams({ email: 'ada@example.test' });
    const res = await instance.inject({
      method: 'POST',
      url: `/realms/${realmName}/login-actions/reset-password`,
      payload: form.toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    // Order proven the way the previous tasks establish it: the transaction
    // that issued the token committed before send was even attempted — the
    // row survives a send that then failed — but the failure never reaches
    // the caller as a different status, which is the property this test
    // exists for: an SMTP outage must not become a 500-for-known,
    // 200-for-unknown oracle.
    expect(res.statusCode).toBe(200);
    const stored = await rawSelectAllActionTokens(realmId);
    expect(stored).toHaveLength(1);
  });

  it('refuses when no public base url is configured, identically for a known and an unknown address', async () => {
    const { realmId, realmName } = await seedRealm(`realm-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await seedAda(realmId);

    const instance = Fastify();
    await instance.register(formbody);
    registerResetPasswordRoute(instance, {
      database: app,
      sender,
      findRealm: (name) => realmSettingsRepository(owner.db).byName(name),
      publicBaseUrl: undefined,
      findByEmail,
    });
    await instance.ready();

    async function submit(email: string) {
      const form = new URLSearchParams({ email });
      const res = await instance.inject({
        method: 'POST',
        url: `/realms/${realmName}/login-actions/reset-password`,
        payload: form.toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      return { statusCode: res.statusCode, body: res.body };
    }

    const known = await submit('ada@example.test');
    const unknown = await submit('nobody@example.test');

    expect(known.statusCode).toBe(500);
    expect(unknown.statusCode).toBe(500);
    expect(known.body).toBe(unknown.body);
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
