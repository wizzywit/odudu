import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import {
  credentialRepository,
  evaluatePassword,
  hashPassword,
  REUSED_PASSWORD,
  subjectRepository,
  userRepository,
  verifyPassword,
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
import { accountTestDeps } from '#/testing/support';
import { registerActionTokenRoute } from '#/view/routes/action-token';
import { actionTokenRepository } from '#/repository/action-tokens';
import { tenantSettingsRepository } from '#/repository/tenant-settings';
import { registerResetPasswordRoute } from '#/view/routes/reset-password';
import { actionTokens } from '#/schema/action-tokens';

// Set by a test that reads the year a mail carries; the system clock otherwise.
let mailNow: Date | null = null;

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
  tx: TenantScopedDatabase,
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
  tx: TenantScopedDatabase,
  tenantId: string,
  input: { username: string; email: string; password: string },
): Promise<{ subjectId: string }> {
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
  return { subjectId: subject.id };
}

interface SeededTenant {
  tenantId: string;
  tenantName: string;
}

async function seedTenant(
  name: string,
  settings: { resetPasswordAllowed: boolean },
): Promise<SeededTenant> {
  const tenantId = newId();
  await owner.db.insert(tenants).values({
    id: tenantId,
    name,
    resetPasswordAllowed: settings.resetPasswordAllowed,
    supportedLocales: ['en', 'fr'],
  });
  return { tenantId, tenantName: name };
}

async function seedAda(tenantId: string): Promise<void> {
  await withTenant(app.db, tenantId, (tx) =>
    createAccount(tx, tenantId, {
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
  tenantId: string,
  username: string,
  password: string,
): Promise<boolean> {
  return withTenant(app.db, tenantId, async (tx) => {
    const found = await userRepository(tx).byUsername(username);
    if (found === null) return false;
    const stored = await credentialRepository(tx).passwordFor(found.subject.id);
    if (stored === null) return false;
    return verifyPassword(stored, password);
  });
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

// The request only queues the mail — that is what keeps an SMTP round trip
// out of the response and out of the timing of one
// (tests/reset-timing.int.test.ts). The pass that hands a queued message to
// a transport is packages/email/src/usecase/send-pending.ts, and a test
// that wants the mailed link runs it here.

async function drainOutbox(into: EmailSender = sender): Promise<void> {
  await sendPending(
    { database: app, ownerDatabase: owner, resolveSender: () => Promise.resolve(into) },
    new Date(),
    OUTBOX_OPTIONS,
  );
}

let sender: ReturnType<typeof fakeSender>;
let httpApp: FastifyInstance;
let resetGate: (tenantId: string, address: string) => boolean = () => true;

function buildHttpApp(): FastifyInstance {
  const instance = Fastify();
  instance.register(formbody);
  registerResetPasswordRoute(instance, {
    ...accountTestDeps,
    mailGate: (_kind, tenantId, address) => resetGate(tenantId, address),
    findHeldSignIn: () => Promise.resolve(null),
    database: app,
    findTenant: (name) => tenantSettingsRepository(owner.db).byName(name),
    publicBaseUrl: 'https://idp.example.test',
    now: () => mailNow ?? new Date(),
    findByEmail,
  });
  registerActionTokenRoute(instance, {
    ...accountTestDeps,
    findHeldSignIn: () => Promise.resolve(null),
    database: app,
    findTenant: (name) => tenantSettingsRepository(owner.db).byName(name),
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
    unchangedPasswordViolations: async (tx, subjectId, candidate) => {
      const current = await credentialRepository(tx).passwordFor(subjectId);
      if (current === null) return [];
      return (await verifyPassword(current, candidate)) ? [REUSED_PASSWORD] : [];
    },
    // No required action exists in this package's tests: user_required_actions
    // belongs to @odudu/authn-flows, which @odudu/account does not depend on.
    // apps/server/tests/reset-password.int.test.ts holds the real wiring.
    clearPasswordUpdateAction: () => Promise.resolve(),
    addRequiredActions: () => Promise.resolve(),
  });
  return instance;
}

beforeEach(async () => {
  sender = fakeSender();
  httpApp = buildHttpApp();
  await httpApp.ready();
});

async function requestReset(
  tenantName: string,
  email: string,
): Promise<{ statusCode: number; body: string }> {
  const form = new URLSearchParams({ email });
  const res = await httpApp.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/login-actions/reset-password`,
    payload: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  // The request itself mails nothing, so the tests below that read a link
  // out of `sender.sent` need the pass to have run.
  await drainOutbox();
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

// Every test below reads either what the queue holds or what a drain
// delivered, so each starts with the queue empty rather than with whatever
// an earlier test left in it.
beforeEach(async () => {
  resetGate = () => true;
  await owner.db.delete(emailOutbox);
});

describe('password reset', () => {
  it('answers identically for a known and an unknown address', async () => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await seedAda(tenantId);

    const known = await requestReset(tenantName, 'ada@example.test');
    const unknown = await requestReset(tenantName, 'nobody@example.test');

    expect(unknown.statusCode).toBe(known.statusCode);
    expect(unknown.body).toBe(known.body);
    expect(known.statusCode).toBe(200);
  });

  it('answers a known and an unknown address identically in every page locale, headers included', async () => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await seedAda(tenantId);
    const instance = Fastify();
    await instance.register(formbody);
    registerResetPasswordRoute(instance, {
      ...accountTestDeps,
      findHeldSignIn: () => Promise.resolve(null),
      database: app,
      findTenant: (name) => tenantSettingsRepository(owner.db).byName(name),
      publicBaseUrl: 'https://idp.example.test',
      now: () => mailNow ?? new Date(),
      findByEmail,
    });
    await instance.ready();

    async function submit(email: string, language: string) {
      const res = await instance.inject({
        method: 'POST',
        url: `/tenants/${tenantName}/login-actions/reset-password`,
        payload: new URLSearchParams({ email }).toString(),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'accept-language': language,
        },
      });
      return { statusCode: res.statusCode, body: res.body, headers: res.headers };
    }

    for (const language of ['en', 'fr', 'ar;q=0.1, fr']) {
      const known = await submit('ada@example.test', language);
      const unknown = await submit('nobody@example.test', language);
      expect(unknown.statusCode, language).toBe(known.statusCode);
      expect(unknown.body, language).toBe(known.body);
      expect(unknown.headers['content-language'], language).toBe(known.headers['content-language']);
      expect(unknown.headers['content-length'], language).toBe(known.headers['content-length']);
    }
    await instance.close();
  });

  it.each([
    ['2026-12-31T23:59:59Z', '2026'],
    ['2027-01-01T00:00:00Z', '2027'],
    ['2031-06-01T12:00:00Z', '2031'],
  ])('stamps the reset mail with the year of the clock it was given: %s', async (instant, year) => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await seedAda(tenantId);
    mailNow = new Date(instant);
    try {
      await requestReset(tenantName, 'ada@example.test');
    } finally {
      mailNow = null;
    }

    const [queued] = await outboxRows(tenantId);
    expect(queued?.bodyHtml).toContain(`\u00a9 ${year} Odudu`);
    expect(queued?.bodyText).toContain(`\u00a9 ${year} Odudu`);
  });

  it('sends mail only for the address that exists', async () => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await seedAda(tenantId);

    await requestReset(tenantName, 'nobody@example.test');
    expect(sender.sent).toHaveLength(0);
    expect(await outboxRows(tenantId)).toHaveLength(0);

    await requestReset(tenantName, 'ada@example.test');
    expect(sender.sent).toHaveLength(1);
    expect(await outboxRows(tenantId)).toHaveLength(1);
  });

  it('queues no mail once the address has had its share, and answers the same', async () => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await seedAda(tenantId);
    let allowed = 2;
    resetGate = () => allowed-- > 0;

    const answers = [];
    for (let i = 0; i < 4; i += 1) answers.push(await requestReset(tenantName, 'ada@example.test'));

    expect(await outboxRows(tenantId)).toHaveLength(2);
    for (const answer of answers) {
      expect(answer.statusCode).toBe(200);
      expect(answer.body).toBe(answers[0]?.body);
    }
  });

  it('renders a set-password form for an unconsumed reset link, without consuming it', async () => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await seedAda(tenantId);

    await requestReset(tenantName, 'ada@example.test');
    const message = sender.sent[0];
    if (message === undefined) throw new Error('no mail sent');
    const link = extractLink(message);

    const form = await getResetForm(link);
    expect(form.statusCode).toBe(200);
    expect(form.body).toContain('New password');

    // Still redeemable: rendering the form must not have consumed it.
    const submitted = await submitNewPassword(link, 'a brand new password');
    expect(submitted.statusCode).toBe(200);
  });

  it('sets a new password the user can then log in with', async () => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await seedAda(tenantId);

    await requestReset(tenantName, 'ada@example.test');
    const message = sender.sent[0];
    if (message === undefined) throw new Error('no mail sent');
    const link = extractLink(message);

    const submitted = await submitNewPassword(link, 'a brand new password');
    expect(submitted.statusCode).toBe(200);

    expect(await passwordWorksFor(tenantId, 'ada', 'a brand new password')).toBe(true);
  });

  it('refuses a password that fails the tenant policy, without spending the link', async () => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await seedAda(tenantId);

    await requestReset(tenantName, 'ada@example.test');
    const message = sender.sent[0];
    if (message === undefined) throw new Error('no mail sent');
    const link = extractLink(message);

    const rejected = await submitNewPassword(link, 'short');
    expect(rejected.statusCode).toBe(400);
    expect(rejected.body).toContain('>Password must be at least 15 characters long.</li>');
    expect(await passwordWorksFor(tenantId, 'ada', 'correct horse battery')).toBe(true);

    // The link is still the same unconsumed token: a compliant password on
    // the very same link now succeeds.
    const retried = await submitNewPassword(link, 'a compliant password');
    expect(retried.statusCode).toBe(200);
    expect(await passwordWorksFor(tenantId, 'ada', 'a compliant password')).toBe(true);
  });

  it('refuses a common password or the tenant name, without spending the link', async () => {
    const tenantName = `tenant-${newId()}`;
    const { tenantId } = await seedTenant(tenantName, { resetPasswordAllowed: true });
    await seedAda(tenantId);

    await requestReset(tenantName, 'ada@example.test');
    const message = sender.sent[0];
    if (message === undefined) throw new Error('no mail sent');
    const link = extractLink(message);

    for (const candidate of ['1qaz2wsx3edc4rfv', tenantName]) {
      const rejected = await submitNewPassword(link, candidate);
      expect(rejected.statusCode, candidate).toBe(400);
      expect(rejected.body, candidate).toContain(
        '>That password is too easy to guess. Choose a different one.</li>',
      );
    }
    expect(await passwordWorksFor(tenantId, 'ada', 'correct horse battery')).toBe(true);

    const retried = await submitNewPassword(link, 'a compliant password');
    expect(retried.statusCode).toBe(200);
  });

  it('stops the old password working', async () => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await seedAda(tenantId);

    await requestReset(tenantName, 'ada@example.test');
    const message = sender.sent[0];
    if (message === undefined) throw new Error('no mail sent');
    await submitNewPassword(extractLink(message), 'a brand new password');

    expect(await passwordWorksFor(tenantId, 'ada', 'correct horse battery')).toBe(false);
    expect(await passwordWorksFor(tenantId, 'ada', 'a brand new password')).toBe(true);
  });

  it('refuses a reset link a second time', async () => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await seedAda(tenantId);

    await requestReset(tenantName, 'ada@example.test');
    const message = sender.sent[0];
    if (message === undefined) throw new Error('no mail sent');
    const link = extractLink(message);

    const first = await submitNewPassword(link, 'my first password');
    expect(first.statusCode).toBe(200);

    const second = await submitNewPassword(link, 'my second password');
    expect(second.statusCode).toBe(400);

    expect(await passwordWorksFor(tenantId, 'ada', 'my second password')).toBe(false);
    expect(await passwordWorksFor(tenantId, 'ada', 'my first password')).toBe(true);
  });

  it('kills a sibling reset link for the same subject once one is completed', async () => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await seedAda(tenantId);

    await requestReset(tenantName, 'ada@example.test');
    await requestReset(tenantName, 'ada@example.test');
    expect(sender.sent).toHaveLength(2);
    const [firstMessage, secondMessage] = sender.sent;
    if (firstMessage === undefined || secondMessage === undefined) {
      throw new Error('expected two reset mails');
    }
    const firstLink = extractLink(firstMessage);
    const secondLink = extractLink(secondMessage);
    expect(firstLink).not.toBe(secondLink);

    const completedFirst = await submitNewPassword(firstLink, 'my first password');
    expect(completedFirst.statusCode).toBe(200);

    const attemptSecond = await submitNewPassword(secondLink, 'my second password');
    expect(attemptSecond.statusCode).toBe(400);
    expect(await passwordWorksFor(tenantId, 'ada', 'my second password')).toBe(false);
    expect(await passwordWorksFor(tenantId, 'ada', 'my first password')).toBe(true);
  });

  it('refuses a verify_email token presented to the reset-password submission', async () => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await seedAda(tenantId);

    // No verify_email flow is wired in this file's httpApp, so a token of
    // that type is seeded directly, the same idiom
    // packages/account/tests/action-tokens.int.test.ts uses.
    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      const found = await userRepository(tx).byUsername('ada');
      if (found === null) throw new Error('ada not found');
      return found.subject.id;
    });
    const { token } = await withTenant(app.db, tenantId, (tx) =>
      actionTokenRepository(tx).issue({
        tenantId,
        subjectId,
        type: 'verify_email',
        ttlSeconds: 3600,
      }),
    );

    const res = await httpApp.inject({
      method: 'POST',
      url: `/tenants/${tenantName}/login-actions/action-token`,
      payload: new URLSearchParams({ key: token, password: 'whatever' }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.statusCode).toBe(400);
    expect(await passwordWorksFor(tenantId, 'ada', 'whatever')).toBe(false);
  });

  it('is not served when the tenant has not enabled it', async () => {
    const { tenantName } = await seedTenant(`tenant-${newId()}`, { resetPasswordAllowed: false });

    const res = await httpApp.inject({
      url: `/tenants/${tenantName}/login-actions/reset-password`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('refuses the submission itself, not just the form, when reset is off', async () => {
    const { tenantName } = await seedTenant(`tenant-${newId()}`, { resetPasswordAllowed: false });

    const res = await requestReset(tenantName, 'ada@example.test');
    expect(res.statusCode).toBe(404);
  });

  it('refuses the form once the tenant has been disabled', async () => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await owner.db.update(tenants).set({ enabled: false }).where(eq(tenants.id, tenantId));

    const res = await httpApp.inject({
      url: `/tenants/${tenantName}/login-actions/reset-password`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('refuses the submission once the tenant has been disabled', async () => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await owner.db.update(tenants).set({ enabled: false }).where(eq(tenants.id, tenantId));

    const res = await requestReset(tenantName, 'ada@example.test');
    expect(res.statusCode).toBe(404);
  });

  it('rejects a request naming a tenant that does not exist, on the form and on the submission', async () => {
    const formRes = await httpApp.inject({
      url: '/tenants/does-not-exist/login-actions/reset-password',
    });
    expect(formRes.statusCode).toBe(404);

    const submitRes = await requestReset('does-not-exist', 'ada@example.test');
    expect(submitRes.statusCode).toBe(404);
  });

  it('closes redemption once reset_password_allowed is turned off, for both the form and the submission', async () => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await seedAda(tenantId);

    await requestReset(tenantName, 'ada@example.test');
    const message = sender.sent[0];
    if (message === undefined) throw new Error('no mail sent');
    const link = extractLink(message);

    await owner.db
      .update(tenants)
      .set({ resetPasswordAllowed: false })
      .where(eq(tenants.id, tenantId));

    const form = await getResetForm(link);
    expect(form.statusCode).toBe(400);

    const submitted = await submitNewPassword(link, 'a brand new password');
    expect(submitted.statusCode).toBe(400);
    expect(await passwordWorksFor(tenantId, 'ada', 'a brand new password')).toBe(false);
  });

  it('a verify_email link still redeems while reset_password_allowed is off', async () => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      resetPasswordAllowed: false,
    });
    await seedAda(tenantId);
    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      const found = await userRepository(tx).byUsername('ada');
      if (found === null) throw new Error('ada not found');
      return found.subject.id;
    });
    const { token } = await withTenant(app.db, tenantId, (tx) =>
      actionTokenRepository(tx).issue({
        tenantId,
        subjectId,
        type: 'verify_email',
        email: 'ada@example.test',
        ttlSeconds: 3600,
      }),
    );

    const res = await httpApp.inject({
      method: 'GET',
      url: `/tenants/${tenantName}/login-actions/action-token?key=${token}`,
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a POST missing only the password as a distinct, non-misleading refusal', async () => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await seedAda(tenantId);

    await requestReset(tenantName, 'ada@example.test');
    const message = sender.sent[0];
    if (message === undefined) throw new Error('no mail sent');
    const link = extractLink(message);

    const missingPassword = await submitNewPassword(link, undefined);
    expect(missingPassword.statusCode).toBe(400);
    expect(missingPassword.body).not.toContain("can't be used");

    // The link itself is still perfectly good.
    const retried = await submitNewPassword(link, 'a brand new password');
    expect(retried.statusCode).toBe(200);
  });

  it('keeps a refused message, with its error, and answers the fixed 200 regardless', async () => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await seedAda(tenantId);

    const throwingSender: EmailSender = {
      send: () => Promise.reject(new Error('mail transport unavailable')),
    };

    const known = await httpApp.inject({
      method: 'POST',
      url: `/tenants/${tenantName}/login-actions/reset-password`,
      payload: new URLSearchParams({ email: 'ada@example.test' }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    await drainOutbox(throwingSender);

    // The property this exists for: an SMTP outage must not become a
    // 500-for-known, 200-for-unknown oracle — and it cannot be one now,
    // because the transport is spoken to long after the answer went out.
    // The token is stored and the message kept, with the reason readable.
    expect(known.statusCode).toBe(200);
    expect(await rawSelectAllActionTokens(tenantId)).toHaveLength(1);
    const queued = await outboxRows(tenantId);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.sentAt).toBeNull();
    expect(queued[0]?.lastError).toBe('mail transport unavailable');
  });

  it('refuses when no public base url is configured, identically for a known and an unknown address', async () => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await seedAda(tenantId);

    const instance = Fastify();
    await instance.register(formbody);
    registerResetPasswordRoute(instance, {
      ...accountTestDeps,
      findHeldSignIn: () => Promise.resolve(null),
      database: app,
      findTenant: (name) => tenantSettingsRepository(owner.db).byName(name),
      publicBaseUrl: undefined,
      now: () => mailNow ?? new Date(),
      findByEmail,
    });
    await instance.ready();

    async function submit(email: string) {
      const form = new URLSearchParams({ email });
      const res = await instance.inject({
        method: 'POST',
        url: `/tenants/${tenantName}/login-actions/reset-password`,
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
    const { tenantName } = await seedTenant(`tenant-${newId()}`, { resetPasswordAllowed: true });

    const res = await httpApp.inject({
      method: 'POST',
      url: `/tenants/${tenantName}/login-actions/reset-password`,
      payload: '',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('password reset, refused in place and with ways on', () => {
  const way = (tenantName: string): string =>
    `/tenants/${tenantName}/protocol/openid-connect/auth?response_type=code&client_id=portal&state=a%20b`;
  const escaped = (value: string): string => value.replaceAll('&', '&amp;');

  async function mailedLink(tenantName: string): Promise<string> {
    await requestReset(tenantName, 'ada@example.test');
    const message = sender.sent[0];
    if (message === undefined) throw new Error('no mail sent');
    return extractLink(message);
  }

  async function post(url: string, fields: Record<string, string>) {
    const res = await httpApp.inject({
      method: 'POST',
      url,
      payload: new URLSearchParams(fields).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    return { statusCode: res.statusCode, body: res.body };
  }

  it('carries the way back through the request form, a refusal and the sent page', async () => {
    const { tenantName } = await seedTenant(`tenant-${newId()}`, { resetPasswordAllowed: true });
    const path = way(tenantName);
    const url = `/tenants/${tenantName}/login-actions/reset-password`;

    const form = await httpApp.inject({ url: `${url}?return_to=${encodeURIComponent(path)}` });
    expect(form.body).toContain(`<a href="${escaped(path)}">Back to sign in</a>`);
    expect(form.body).toContain(`name="return_to" value="${escaped(path)}"`);
    const direct = await httpApp.inject({ url });
    expect(direct.body).not.toContain('Back to sign in');

    const empty = await post(url, { email: '', return_to: path });
    expect(empty.statusCode).toBe(400);
    expect(empty.body).toContain('<form method="post"');
    expect(empty.body).toContain('Email is required.');
    expect(empty.body).toContain('aria-invalid="true" aria-describedby="form-error-0" autofocus');
    expect(empty.body).toContain(`<a href="${escaped(path)}">Back to sign in</a>`);

    const sent = await post(url, { email: 'ada@example.test', return_to: path });
    expect(sent.statusCode).toBe(200);
    expect(sent.body).toContain(`<a href="${escaped(path)}">Back to sign in</a>`);
  });

  it('keeps the sent page identical for a known and an unknown address, link included', async () => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await seedAda(tenantId);
    const url = `/tenants/${tenantName}/login-actions/reset-password`;
    const known = await post(url, { email: 'ada@example.test', return_to: way(tenantName) });
    const unknown = await post(url, { email: 'nobody@example.test', return_to: way(tenantName) });
    expect(unknown.statusCode).toBe(known.statusCode);
    expect(unknown.body).toBe(known.body);
  });

  it('drops a way back that is not this tenant authorize path', async () => {
    const { tenantName } = await seedTenant(`tenant-${newId()}`, { resetPasswordAllowed: true });
    const url = `/tenants/${tenantName}/login-actions/reset-password`;
    for (const bad of [
      'https://evil.example/x',
      '//evil.example',
      '/tenants/other/protocol/openid-connect/auth?a=b',
    ]) {
      const res = await post(url, { email: 'ada@example.test', return_to: bad });
      expect(res.body, bad).not.toContain('Back to sign in');
      expect(res.body, bad).not.toContain('evil.example');
    }
  });

  it('puts the new-password form back in place with the key, the rules and no password', async () => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await seedAda(tenantId);
    const link = await mailedLink(tenantName);
    const key = keyFromLink(link);

    const weak = await submitNewPassword(link, 'zq9xv');
    expect(weak.statusCode).toBe(400);
    expect(weak.body).toContain('<form method="post"');
    expect(weak.body).toContain(`name="key" value="${key}"`);
    expect(weak.body).toContain('aria-invalid="true" aria-describedby="form-error-0');
    expect(weak.body).not.toContain('zq9xv');

    const missing = await submitNewPassword(link, undefined);
    expect(missing.statusCode).toBe(400);
    expect(missing.body).toContain('<form method="post"');
    expect(missing.body).toContain('A new password is required.');
  });

  it('offers a new link when a reset link is used or expired and resets are still allowed', async () => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      resetPasswordAllowed: true,
    });
    await seedAda(tenantId);
    const link = await mailedLink(tenantName);
    expect((await submitNewPassword(link, 'my first password')).statusCode).toBe(200);
    const request = `<a href="/tenants/${tenantName}/login-actions/reset-password">Request a new link</a>`;

    const again = await getResetForm(link);
    expect(again.statusCode).toBe(400);
    expect(again.body).toContain(request);
    const submitted = await submitNewPassword(link, 'my second password');
    expect(submitted.statusCode).toBe(400);
    expect(submitted.body).toContain(request);

    await owner.db
      .update(tenants)
      .set({ resetPasswordAllowed: false })
      .where(eq(tenants.id, tenantId));
    const closed = await getResetForm(link);
    expect(closed.body).not.toContain('Request a new link');
  });

  it('offers nothing for a key no row holds, and nothing across tenants', async () => {
    const a = await seedTenant(`tenant-${newId()}`, { resetPasswordAllowed: true });
    const b = await seedTenant(`tenant-${newId()}`, { resetPasswordAllowed: true });
    await seedAda(a.tenantId);
    const link = await mailedLink(a.tenantName);

    const junk = await httpApp.inject({
      url: `/tenants/${a.tenantName}/login-actions/action-token?key=${'x'.repeat(43)}`,
    });
    expect(junk.statusCode).toBe(400);
    expect(junk.body).not.toContain('Request a new link');

    const across = await httpApp.inject({
      url: `/tenants/${b.tenantName}/login-actions/action-token?key=${keyFromLink(link)}`,
    });
    expect(across.statusCode).toBe(400);
    expect(across.body).not.toContain('Request a new link');
  });
});
