import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { auditRepository } from '@odudu/domain-audit';
import { effectiveRoles, roleRepository } from '@odudu/domain-authz';
import {
  credentialRepository,
  evaluatePassword,
  hashUserPassword,
  subjectRepository,
  userRepository,
  verifyPassword,
  verifyUserPassword,
} from '@odudu/domain-identity';
import {
  emailOutbox,
  sendPending,
  type EmailMessage,
  type EmailSender,
  type SendPendingOptions,
} from '@odudu/email';
import { BidiControlError, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { eq, sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountTestDeps, linkRouteDeps, openAndPress } from '#/testing/support';
import { tenantSettingsRepository } from '#/repository/tenant-settings';
import { en } from '#/view/messages';
import { actionTokens } from '#/schema/action-tokens';
import { pendingRegistrations } from '#/schema/pending-registrations';
import { type CreateAccountResult, type NewAccountInput } from '#/usecase/register';
import { registerActionTokenRoute } from '#/view/routes/action-token';
import { registerRegistrationRoute } from '#/view/routes/registration';

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
    secret: { kind: 'password', hash: await hashUserPassword(input.password) },
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
  settings: {
    registrationAllowed: boolean;
    verifyEmail?: boolean;
    resetPasswordAllowed?: boolean;
    displayName?: string;
  },
): Promise<SeededTenant> {
  const tenantId = newId();
  await owner.db.insert(tenants).values({
    id: tenantId,
    name,
    registrationAllowed: settings.registrationAllowed,
    supportedLocales: ['en', 'fr'],
    verifyEmail: settings.verifyEmail ?? false,
    resetPasswordAllowed: settings.resetPasswordAllowed ?? false,
    displayName: settings.displayName ?? null,
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

async function rawSelectAllPending(tenantId: string) {
  return withTenant(app.db, tenantId, (tx) => tx.select().from(pendingRegistrations));
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
let mailAllowed = true;

function buildHttpApp(): FastifyInstance {
  const instance = Fastify();
  instance.register(formbody);
  registerRegistrationRoute(instance, {
    ...accountTestDeps,
    mailGate: () => mailAllowed,
    findHeldSignIn: () => Promise.resolve(null),
    database: app,
    findTenant: (name) => tenantSettingsRepository(owner.db).byName(name),
    publicBaseUrl,
    now: () => mailNow ?? new Date(),
    createAccount,
    evaluatePassword,
  });
  registerActionTokenRoute(instance, {
    ...accountTestDeps,
    ...linkRouteDeps(),
    database: app,
    findTenant: (name) => tenantSettingsRepository(owner.db).byName(name),
    findHeldSignIn: () => Promise.resolve(null),
  });
  return instance;
}

let httpApp: FastifyInstance;

beforeEach(async () => {
  sender = fakeSender();
  publicBaseUrl = 'https://idp.example.test';
  mailAllowed = true;
  httpApp = buildHttpApp();
  await httpApp.ready();
});

async function submitRegistration(
  tenantName: string,
  input: NewAccountInput,
  extra: Record<string, string> = {},
): Promise<{ statusCode: number; body: string }> {
  const form = new URLSearchParams({
    username: input.username,
    email: input.email,
    password: input.password,
    password_confirm: input.password,
    ...extra,
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

  it('shows the form in the browser language, in the markup and in Content-Language', async () => {
    const { tenantName } = await seedTenant(`tenant-${newId()}`, { registrationAllowed: true });
    const url = `/tenants/${tenantName}/login-actions/registration`;

    const french = await httpApp.inject({ url, headers: { 'accept-language': 'de, fr;q=0.8' } });
    expect(french.body).toContain('<html lang="fr" dir="ltr">');
    expect(french.headers['content-language']).toBe('fr');

    const none = await httpApp.inject({ url });
    expect(none.body).toContain('<html lang="en" dir="ltr">');
    expect(none.headers['content-language']).toBe('en');
  });

  it('follows the light or dark choice in the odudu-theme cookie, and only that', async () => {
    const { tenantName } = await seedTenant(`tenant-${newId()}`, { registrationAllowed: true });
    const url = `/tenants/${tenantName}/login-actions/registration`;

    const dark = await httpApp.inject({ url, headers: { cookie: 'odudu-theme=dark' } });
    expect(dark.body).toContain('<html lang="en" dir="ltr" data-theme="dark">');

    const none = await httpApp.inject({ url });
    expect(none.body).not.toContain('data-theme');

    for (const cookie of [
      'odudu-theme=LIGHT',
      'odudu-theme=x"><script>alert(1)</script>',
      'odudu-theme=light evil',
      `odudu-theme=${'x'.repeat(9000)}`,
    ]) {
      const hostile = await httpApp.inject({ url, headers: { cookie } });
      expect(hostile.statusCode).toBe(200);
      expect(hostile.body).not.toContain('data-theme');
      expect(hostile.body).not.toContain('alert(1)');
    }
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

  it('words each broken rule from the catalogue by its code, never the domain sentence', async () => {
    const { tenantName } = await seedTenant(`tenant-${newId()}`, { registrationAllowed: true });
    const instance = Fastify();
    instance.register(formbody);
    registerRegistrationRoute(instance, {
      ...accountTestDeps,
      findHeldSignIn: () => Promise.resolve(null),
      database: app,
      findTenant: (name) => tenantSettingsRepository(owner.db).byName(name),
      publicBaseUrl,
      now: () => mailNow ?? new Date(),
      createAccount,
      evaluatePassword: () => [
        { rule: 'min-length', message: 'DOMAIN-SENTENCE-ONE' },
        { rule: 'require-digit', message: 'DOMAIN-SENTENCE-TWO' },
      ],
    });
    const res = await instance.inject({
      method: 'POST',
      url: `/tenants/${tenantName}/login-actions/registration`,
      payload: new URLSearchParams({
        username: 'ada',
        email: 'ada@example.test',
        password: 'x',
        password_confirm: 'x',
      }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    await instance.close();

    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('>Password must be at least 15 characters long.</li>');
    expect(res.body).toContain('>Password must contain a digit.</li>');
    expect(res.body).not.toContain('DOMAIN-SENTENCE');
  });

  it('refuses a common password with its reason, and creates nothing', async () => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      registrationAllowed: true,
    });

    const res = await submitRegistration(tenantName, {
      username: 'ada',
      email: 'ada@example.test',
      password: '1QAZ2wsx3edc4rfv',
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('>That password is too easy to guess. Choose a different one.</li>');
    expect(
      await withTenant(app.db, tenantId, (tx) => userRepository(tx).byUsername('ada')),
    ).toBeNull();
  });

  it('refuses the tenant name, the username and the email name on their own', async () => {
    const tenantName = `tenant-${newId()}`;
    const { tenantId } = await seedTenant(tenantName, { registrationAllowed: true });
    await owner.db
      .update(tenants)
      .set({ passwordMinLength: 8, passwordNotUsername: false, passwordNotEmail: false })
      .where(eq(tenants.id, tenantId));

    for (const password of [tenantName, 'adalovelace', 'countess.lovelace']) {
      const res = await submitRegistration(tenantName, {
        username: 'adalovelace',
        email: 'countess.lovelace@example.test',
        password: password.toUpperCase(),
      });
      expect(res.statusCode, password).toBe(400);
      expect(res.body, password).toContain('That password is too easy to guess.');
    }
  });

  it('takes a tenant name from its own tenant only', async () => {
    const mine = await seedTenant(`tenant-${newId()}`, { registrationAllowed: true });
    const other = await seedTenant(`tenant-${newId()}`, { registrationAllowed: true });

    // The password is another tenant's name, which ends in hexadecimal digits:
    // a username made of letters outside a-f cannot occur inside it by chance.
    const res = await submitRegistration(mine.tenantName, {
      username: 'zed',
      email: 'zed@example.test',
      password: other.tenantName,
    });

    expect(res.statusCode).toBe(201);
  });

  it('stores a password typed decomposed so either form signs in', async () => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      registrationAllowed: true,
    });

    const res = await submitRegistration(tenantName, {
      username: 'ada',
      email: 'ada@example.test',
      password: 'cafe\u0301 au lait, deux sucres',
    });
    expect(res.statusCode).toBe(201);

    const subjectId = await subjectIdForUsername(tenantId, 'ada');
    const stored = await withTenant(app.db, tenantId, (tx) =>
      credentialRepository(tx).passwordFor(subjectId),
    );
    expect(stored).not.toBeNull();
    expect(await verifyUserPassword(stored ?? '', 'caf\u00e9 au lait, deux sucres')).toBe(true);
    expect(await verifyPassword(stored ?? '', 'caf\u00e9 au lait, deux sucres')).toBe(true);
  });

  it('words a too-long password from the catalogue, with the limit it was refused at', async () => {
    const { tenantName } = await seedTenant(`tenant-${newId()}`, { registrationAllowed: true });

    const res = await submitRegistration(tenantName, {
      username: 'ada',
      email: 'ada@example.test',
      password: 'x'.repeat(300),
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('>Password must be at most 256 characters long.</li>');
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

  it('refuses a bidirectional control in a username with its own sentence, and creates nothing', async () => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      registrationAllowed: true,
    });
    const usernames = [0x202e, 0x2066, 0x2069].map((cp) => `ada${String.fromCodePoint(cp)}`);
    for (const username of usernames) {
      const res = await submitRegistration(tenantName, {
        username,
        email: 'ada@example.test',
        password: 'correct horse battery',
      });
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain(en['registration.refusal.invalidUsername']);
      // The refused name is not put back in the field to reorder the text.
      expect(res.body).not.toMatch(/[\u202a-\u202e\u2066-\u2069]/u);
      expect(res.body).toContain('name="username" autocomplete="username" aria-invalid="true"');
    }
    for (const username of usernames) {
      const found = await withTenant(app.db, tenantId, (tx) =>
        userRepository(tx).byUsername(username),
      );
      expect(found).toBeNull();
    }
    expect(await outboxRows(tenantId)).toHaveLength(0);
  });

  it('refuses before the password is evaluated or an account is attempted', async () => {
    const { tenantName } = await seedTenant(`tenant-${newId()}`, { registrationAllowed: true });
    let evaluated = 0;
    let attempted = 0;
    const counting = Fastify();
    counting.register(formbody);
    registerRegistrationRoute(counting, {
      ...accountTestDeps,
      findHeldSignIn: () => Promise.resolve(null),
      database: app,
      findTenant: (name) => tenantSettingsRepository(owner.db).byName(name),
      publicBaseUrl,
      now: () => mailNow ?? new Date(),
      createAccount: (tx, tenantId, input) => {
        attempted += 1;
        return createAccount(tx, tenantId, input);
      },
      evaluatePassword: (...args) => {
        evaluated += 1;
        return evaluatePassword(...args);
      },
    });
    const res = await counting.inject({
      method: 'POST',
      url: `/tenants/${tenantName}/login-actions/registration`,
      payload: new URLSearchParams({
        username: `ada${String.fromCodePoint(0x202e)}`,
        email: 'ada@example.test',
        password: 'correct horse battery',
      }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.statusCode).toBe(400);
    expect({ evaluated, attempted }).toEqual({ evaluated: 0, attempted: 0 });
  });

  it('answers the same when the repository is what refuses the control', async () => {
    const { tenantName } = await seedTenant(`tenant-${newId()}`, { registrationAllowed: true });
    const refusing = Fastify();
    refusing.register(formbody);
    registerRegistrationRoute(refusing, {
      ...accountTestDeps,
      findHeldSignIn: () => Promise.resolve(null),
      database: app,
      findTenant: (name) => tenantSettingsRepository(owner.db).byName(name),
      publicBaseUrl,
      now: () => mailNow ?? new Date(),
      createAccount: () => Promise.reject(new BidiControlError('username')),
      evaluatePassword,
    });
    const res = await refusing.inject({
      method: 'POST',
      url: `/tenants/${tenantName}/login-actions/registration`,
      payload: new URLSearchParams({
        username: 'ada',
        email: 'ada@example.test',
        password: 'correct horse battery',
        password_confirm: 'correct horse battery',
      }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain(en['registration.refusal.invalidUsername']);
  });

  it('registers right-to-left usernames, which then sign in by lookup', async () => {
    const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
      registrationAllowed: true,
    });
    for (const [username, email] of [
      ['مستخدم', 'ar@example.test'],
      ['עברית', 'he@example.test'],
      [`فارسی${String.fromCodePoint(0x200f)}`, 'fa@example.test'],
    ] as const) {
      const res = await submitRegistration(tenantName, {
        username,
        email,
        password: 'correct horse battery',
      });
      expect(res.statusCode, username).toBe(201);
      expect(await subjectIdForUsername(tenantId, username)).toBeDefined();
    }
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

  it.each([
    ['2026-12-31T23:59:59Z', '2026'],
    ['2027-01-01T00:00:00Z', '2027'],
    ['2031-06-01T12:00:00Z', '2031'],
  ])(
    'stamps the verification mail with the year of the clock it was given: %s',
    async (instant, year) => {
      const { tenantId, tenantName } = await seedTenant(`tenant-${newId()}`, {
        registrationAllowed: true,
        verifyEmail: true,
      });
      mailNow = new Date(instant);
      try {
        const res = await submitRegistration(tenantName, {
          username: 'ada',
          email: 'ada@example.test',
          password: 'correct horse battery',
        });
        expect(res.statusCode).toBe(201);
      } finally {
        mailNow = null;
      }

      const [queued] = await outboxRows(tenantId);
      expect(queued?.bodyHtml).toContain(`\u00a9 ${year} Odudu`);
      expect(queued?.bodyText).toContain(`\u00a9 ${year} Odudu`);
    },
  );

  it('keeps the request whatever the transport later does with the mail', async () => {
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
    // reach the caller: the request is kept, and the message waits for a
    // pass that can retry it.
    expect(res.statusCode).toBe(201);
    expect(await rawSelectAllPending(tenantId)).toHaveLength(1);

    await drainOutbox(throwingSender);

    const queued = await outboxRows(tenantId);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.sentAt).toBeNull();
    expect(queued[0]?.lastError).toBe('mail transport unavailable');
    const created = await withTenant(app.db, tenantId, (tx) =>
      userRepository(tx).byUsername('ada'),
    );
    expect(created).toBeNull();
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

  describe('refused in place, with a way back to sign-in', () => {
    const SIGN_IN = (tenant: string): string =>
      `/tenants/${tenant}/protocol/openid-connect/auth?response_type=code&client_id=portal&state=a%20b`;
    const escaped = (value: string): string => value.replaceAll('&', '&amp;');

    async function open(): Promise<SeededTenant> {
      return seedTenant(`tenant-${newId()}`, { registrationAllowed: true });
    }

    it('shows the sign-in link on the form only when a valid way was carried', async () => {
      const { tenantName } = await open();
      const path = SIGN_IN(tenantName);

      const carried = await httpApp.inject({
        url: `/tenants/${tenantName}/login-actions/registration?return_to=${encodeURIComponent(path)}`,
      });
      expect(carried.statusCode).toBe(200);
      expect(carried.body).toContain(`<a href="${escaped(path)}">Back to sign in</a>`);
      expect(carried.body).toContain(`name="return_to" value="${escaped(path)}"`);

      const direct = await httpApp.inject({
        url: `/tenants/${tenantName}/login-actions/registration`,
      });
      expect(direct.body).not.toContain('Back to sign in');
      expect(direct.body).not.toContain('return_to');
    });

    it.each([
      [
        'another tenant',
        (tenant: string) => `/tenants/other-${tenant}/protocol/openid-connect/auth?a=b`,
      ],
      [
        'a foreign address',
        () => 'https://evil.example/tenants/x/protocol/openid-connect/auth?a=b',
      ],
      ['a scheme-relative address', () => '//evil.example/x'],
      ['a script', () => 'javascript:alert(1)'],
    ])('drops a return_to naming %s, from the form and from the refusal', async (_label, build) => {
      const { tenantName } = await open();
      const bad = build(tenantName);

      const form = await httpApp.inject({
        url: `/tenants/${tenantName}/login-actions/registration?return_to=${encodeURIComponent(bad)}`,
      });
      expect(form.body).not.toContain('Back to sign in');
      expect(form.body).not.toContain(escaped(bad));

      const refused = await submitRegistration(
        tenantName,
        { username: 'ada', email: 'ada@example.test', password: '' },
        { return_to: bad },
      );
      expect(refused.statusCode).toBe(400);
      expect(refused.body).not.toContain('Back to sign in');
      expect(refused.body).not.toContain('evil.example');
    });

    it('puts a short password back on the same form with its rules, the way back and the safe values', async () => {
      const { tenantName } = await open();
      const path = SIGN_IN(tenantName);

      const res = await submitRegistration(
        tenantName,
        { username: 'ada', email: 'ada@example.test', password: 'zq9xv' },
        { return_to: path },
      );

      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('<form method="post" action="/tenants/');
      expect(res.body).toContain('role="alert" id="form-error"');
      expect(res.body).toContain('aria-invalid="true" aria-describedby="form-error-0');
      expect(res.body).toContain('value="ada"');
      expect(res.body).toContain('value="ada@example.test"');
      expect(res.body).not.toContain('zq9xv');
      expect(res.body).toContain(`name="return_to" value="${escaped(path)}"`);
      expect(res.body).toContain(`<a href="${escaped(path)}">Back to sign in</a>`);
    });

    it('names each field left empty and keeps the others', async () => {
      const { tenantName } = await open();

      const res = await submitRegistration(tenantName, {
        username: 'ada',
        email: '',
        password: '',
      });

      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('Enter an email address.');
      expect(res.body).toContain('Enter a password.');
      expect(res.body).not.toContain('Enter a username.');
      expect(res.body).toContain('value="ada"');
    });

    it('answers a taken username and a taken address on their own fields, as a 400', async () => {
      const { tenantName } = await open();
      const first = await submitRegistration(tenantName, {
        username: 'ada',
        email: 'ada@example.test',
        password: 'correct horse battery',
      });
      expect(first.statusCode).toBe(201);

      const sameName = await submitRegistration(tenantName, {
        username: 'ada',
        email: 'other@example.test',
        password: 'correct horse battery',
      });
      expect(sameName.statusCode).toBe(400);
      expect(sameName.body).toContain('That username is already taken.');
      expect(sameName.body).toMatch(/name="username"[^>]*aria-invalid="true"/u);

      const sameMail = await submitRegistration(tenantName, {
        username: 'grace',
        email: 'ada@example.test',
        password: 'correct horse battery',
      });
      expect(sameMail.statusCode).toBe(400);
      expect(sameMail.body).toContain('That email address is already registered.');
      expect(sameMail.body).toMatch(/name="email"[^>]*aria-invalid="true"/u);
      expect(sameMail.body).toContain('value="grace"');
    });

    it('does not read another tenant: a taken name in one is free in the other', async () => {
      const a = await open();
      const b = await open();
      await submitRegistration(a.tenantName, {
        username: 'ada',
        email: 'ada@example.test',
        password: 'correct horse battery',
      });

      const inB = await submitRegistration(b.tenantName, {
        username: 'ada',
        email: 'ada@example.test',
        password: 'correct horse battery',
      });

      expect(inB.statusCode).toBe(201);
      expect(inB.body).not.toContain('already');
    });

    it('links the success page onward, and the unavailable page back and to a retry', async () => {
      const { tenantName } = await open();
      const path = SIGN_IN(tenantName);
      const done = await submitRegistration(
        tenantName,
        { username: 'ada', email: 'ada@example.test', password: 'correct horse battery' },
        { return_to: path },
      );
      expect(done.statusCode).toBe(201);
      expect(done.body).toContain(`<a href="${escaped(path)}">Back to sign in</a>`);

      const verifying = await seedTenant(`tenant-${newId()}`, {
        registrationAllowed: true,
        verifyEmail: true,
      });
      publicBaseUrl = undefined;
      httpApp = buildHttpApp();
      await httpApp.ready();
      const unavailable = await submitRegistration(
        verifying.tenantName,
        { username: 'ada', email: 'ada@example.test', password: 'correct horse battery' },
        { return_to: SIGN_IN(verifying.tenantName) },
      );
      expect(unavailable.statusCode).toBe(500);
      expect(unavailable.body).toContain('>Try again</a>');
      expect(unavailable.body).toContain('>Back to sign in</a>');
      expect(unavailable.body).not.toContain('<form');
    });
  });
});

describe('a registration that waits for its mailed link', () => {
  const PASSWORD = 'correct horse battery';

  async function open(settings: { resetPasswordAllowed?: boolean } = {}): Promise<SeededTenant> {
    return seedTenant(`tenant-${newId()}`, {
      registrationAllowed: true,
      verifyEmail: true,
      resetPasswordAllowed: settings.resetPasswordAllowed ?? true,
      displayName: 'Acme Portal',
    });
  }

  function post(
    tenantName: string,
    username: string,
    email: string,
    password = PASSWORD,
    confirmation = password,
  ) {
    return httpApp.inject({
      method: 'POST',
      url: `/tenants/${tenantName}/login-actions/registration`,
      payload: new URLSearchParams({
        username,
        email,
        password,
        password_confirm: confirmation,
      }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
  }

  // The key in the newest verification mail queued for an address.
  async function keyFor(tenantId: string, email: string): Promise<string> {
    const rows = (await outboxRows(tenantId)).filter(
      (row) => row.toAddress === email && row.subject.startsWith('Finish'),
    );
    const link = /finish:\n\n(\S+)/u.exec(rows.at(-1)?.bodyText ?? '')?.[1];
    const key = link === undefined ? null : new URL(link).searchParams.get('key');
    if (key === null) throw new Error('no verification link was queued');
    return key;
  }

  function follow(tenantName: string, key: string) {
    return openAndPress(httpApp, tenantName, key);
  }

  function visit(tenantName: string, key: string) {
    return httpApp.inject({
      url: `/tenants/${tenantName}/login-actions/action-token?key=${encodeURIComponent(key)}`,
    });
  }

  function press(tenantName: string, key: string) {
    return httpApp.inject({
      method: 'POST',
      url: `/tenants/${tenantName}/login-actions/action-token`,
      payload: new URLSearchParams({ key }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
  }

  async function register(tenant: SeededTenant, username: string, email: string) {
    expect((await post(tenant.tenantName, username, email)).statusCode).toBe(201);
    return follow(tenant.tenantName, await keyFor(tenant.tenantId, email));
  }

  async function pendingCount(tenantId: string): Promise<number> {
    const rows = await withTenant(app.db, tenantId, (tx) => tx.select().from(pendingRegistrations));
    return rows.length;
  }

  async function auditActions(tenantId: string): Promise<string[]> {
    const rows = await withTenant(app.db, tenantId, (tx) =>
      auditRepository(tx).list({ eventType: 'credential', limit: 50 }),
    );
    return rows.map((row) => row.action);
  }

  async function holder(tenantId: string, username: string) {
    return withTenant(app.db, tenantId, (tx) => userRepository(tx).byUsername(username));
  }

  it('creates nothing for a free address, keeps the request and mails a link', async () => {
    const { tenantId, tenantName } = await open();

    const res = await post(tenantName, 'ada', 'ada@example.test');

    expect(res.statusCode).toBe(201);
    expect(await holder(tenantId, 'ada')).toBeNull();
    expect(await pendingCount(tenantId)).toBe(1);
    expect(await tokenCountOf(tenantId)).toBe(0);
    const [mail] = await outboxRows(tenantId);
    expect(mail?.toAddress).toBe('ada@example.test');
    expect(mail?.bodyText).toContain(
      `https://idp.example.test/tenants/${tenantName}/login-actions/action-token?key=reg_`,
    );
    expect(await auditActions(tenantId)).toEqual([]);
  });

  async function tokenCountOf(tenantId: string): Promise<number> {
    return (await rawSelectAllActionTokens(tenantId)).length;
  }

  it('creates nothing when the link is only opened, and exactly one account when its button is pressed', async () => {
    const { tenantId, tenantName } = await open();
    await post(tenantName, 'ada', 'ada@example.test');
    const key = await keyFor(tenantId, 'ada@example.test');

    // What a mail scanner does, twice.
    const first = await visit(tenantName, key);
    const second = await visit(tenantName, key);

    for (const res of [first, second]) {
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('Confirm my email');
      expect(res.body).toContain('Account name: <bdi>ada</bdi>');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.body).not.toMatch(/(src|href)="https?:/u);
    }
    expect(first.body).toBe(second.body);
    expect(await holder(tenantId, 'ada')).toBeNull();
    expect(await pendingCount(tenantId)).toBe(1);
    expect(await auditActions(tenantId)).toEqual([]);

    const created = await press(tenantName, key);
    const again = await press(tenantName, key);

    expect(created.statusCode).toBe(200);
    expect(await holder(tenantId, 'ada')).not.toBeNull();
    expect(await auditActions(tenantId)).toEqual(['account.registered']);
    expect(again.statusCode).toBe(400);
    expect(again.body).toBe((await visit(tenantName, 'reg_never-issued')).body);
    expect((await visit(tenantName, key)).statusCode).toBe(400);
  });

  it('creates the account, verified, with the password hash made at registration, when its button is pressed', async () => {
    const { tenantId, tenantName } = await open();
    await createDefaultRole(tenantId, 'offline_access');

    const res = await register({ tenantId, tenantName }, 'ada', 'ada@example.test');

    expect(res.statusCode).toBe(200);
    const found = await holder(tenantId, 'ada');
    expect(found?.user.email).toBe('ada@example.test');
    expect(found?.user.emailVerified).toBe(true);
    const stored = await withTenant(app.db, tenantId, (tx) =>
      credentialRepository(tx).passwordFor(found?.subject.id ?? ''),
    );
    expect(await verifyUserPassword(stored ?? '', PASSWORD)).toBe(true);
    expect(await roleNamesFor(tenantId, found?.subject.id ?? '')).toEqual(['offline_access']);
    expect(await pendingCount(tenantId)).toBe(0);
    expect(await auditActions(tenantId)).toEqual(['account.registered']);
  });

  it('answers a held address exactly as a free one, and queues the holder a different mail', async () => {
    const tenant = await open();
    await register(tenant, 'ada', 'ada@example.test');
    await owner.db.delete(emailOutbox);

    const free = await post(tenant.tenantName, 'grace', 'grace@example.test');
    const held = await post(tenant.tenantName, 'hedy', 'ada@example.test');

    expect(held.statusCode).toBe(free.statusCode);
    expect(held.body).toBe(free.body);
    expect({ ...held.headers, date: '' }).toEqual({ ...free.headers, date: '' });
    const mails = await outboxRows(tenant.tenantId);
    expect(mails.map((m) => [m.toAddress, m.subject.startsWith('Finish')])).toEqual([
      ['grace@example.test', true],
      ['ada@example.test', false],
    ]);
    expect(mails[1]?.bodyText).toContain(`${tenant.tenantName}/login-actions/reset-password`);
    expect(mails[1]?.bodyText).not.toContain('key=');
    expect(mails[1]?.bodyText).not.toContain('hedy');
    expect(await holder(tenant.tenantId, 'hedy')).toBeNull();
    expect(await pendingCount(tenant.tenantId)).toBe(1);
  });

  it('cannot be told apart by asking for the same username twice', async () => {
    const tenant = await open();
    await register(tenant, 'ada', 'ada@example.test');

    // The address held, then a free one, for a username nobody has.
    await post(tenant.tenantName, 'probe1', 'ada@example.test');
    const afterHeld = await post(tenant.tenantName, 'probe1', 'other1@example.test');
    // The address free, then another free one.
    await post(tenant.tenantName, 'probe2', 'free2@example.test');
    const afterFree = await post(tenant.tenantName, 'probe2', 'other2@example.test');

    expect(afterHeld.statusCode).toBe(201);
    expect(afterFree.statusCode).toBe(201);
    expect(afterHeld.body).toBe(afterFree.body);
  });

  it('treats an address as held whatever its case', async () => {
    const tenant = await open();
    await register(tenant, 'ada', 'ada@example.test');
    await owner.db.delete(emailOutbox);

    const res = await post(tenant.tenantName, 'hedy', 'ADA@Example.test');

    expect(res.statusCode).toBe(201);
    expect(await pendingCount(tenant.tenantId)).toBe(0);
    const [mail] = await outboxRows(tenant.tenantId);
    expect(mail?.subject).toBe('You already have a Acme Portal account');
  });

  it('keeps one pending request per address, case aside, and only the latest link works', async () => {
    const tenant = await open();

    await post(tenant.tenantName, 'ada', 'ada@example.test');
    const first = await keyFor(tenant.tenantId, 'ada@example.test');
    await post(tenant.tenantName, 'ada2', 'ADA@example.test');
    const second = await keyFor(tenant.tenantId, 'ADA@example.test');

    expect(await pendingCount(tenant.tenantId)).toBe(1);
    expect((await follow(tenant.tenantName, first)).statusCode).toBe(400);
    expect((await follow(tenant.tenantName, second)).statusCode).toBe(200);
    expect(await holder(tenant.tenantId, 'ada2')).not.toBeNull();
    expect(await holder(tenant.tenantId, 'ada')).toBeNull();
  });

  it('refuses a spent, expired, unknown or foreign link with one page', async () => {
    const tenant = await open();
    const other = await open();
    await post(tenant.tenantName, 'ada', 'ada@example.test');
    const key = await keyFor(tenant.tenantId, 'ada@example.test');
    await post(tenant.tenantName, 'bea', 'bea@example.test');
    const stale = await keyFor(tenant.tenantId, 'bea@example.test');
    await owner.db.execute(
      sql`update pending_registrations set expires_at = now() - interval '1 second' where tenant_id = ${tenant.tenantId} and email = 'bea@example.test'`,
    );

    const foreign = await follow(other.tenantName, key);
    expect((await follow(tenant.tenantName, key)).statusCode).toBe(200);
    const spent = await follow(tenant.tenantName, key);
    const expired = await follow(tenant.tenantName, stale);
    const unknown = await follow(tenant.tenantName, 'reg_nothing-holds-this');
    const plain = await follow(tenant.tenantName, 'not-a-registration-key');

    for (const res of [foreign, spent, expired, unknown, plain]) {
      expect(res.statusCode).toBe(400);
      expect(res.body).toBe(plain.body);
    }
    expect(await holder(other.tenantId, 'ada')).toBeNull();
  });

  it('says the username is gone, and creates nothing, when somebody took it meanwhile', async () => {
    const tenant = await open();
    await post(tenant.tenantName, 'ada', 'ada@example.test');
    const key = await keyFor(tenant.tenantId, 'ada@example.test');
    await register(tenant, 'grace', 'grace@example.test');
    await owner.db.execute(
      sql`update pending_registrations set username = 'grace' where tenant_id = ${tenant.tenantId}`,
    );

    const res = await follow(tenant.tenantName, key);

    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('That username is no longer available.');
    expect(res.body).toContain(`/tenants/${tenant.tenantName}/login-actions/registration`);
    expect(await holder(tenant.tenantId, 'ada')).toBeNull();
    expect(await pendingCount(tenant.tenantId)).toBe(0);
  });

  it('refuses the link, as any bad one, when the address got an account meanwhile', async () => {
    const tenant = await open();
    await post(tenant.tenantName, 'ada', 'ada@example.test');
    const key = await keyFor(tenant.tenantId, 'ada@example.test');
    await withTenant(app.db, tenant.tenantId, (tx) =>
      createAccount(tx, tenant.tenantId, {
        username: 'someone',
        email: 'ADA@example.test',
        password: PASSWORD,
      }),
    );

    const res = await follow(tenant.tenantName, key);

    expect(res.statusCode).toBe(400);
    expect(res.body).toBe((await follow(tenant.tenantName, 'not-a-registration-key')).body);
    expect(await holder(tenant.tenantId, 'ada')).toBeNull();
  });

  it('refuses a link once the tenant no longer takes registrations', async () => {
    const tenant = await open();
    await post(tenant.tenantName, 'ada', 'ada@example.test');
    const key = await keyFor(tenant.tenantId, 'ada@example.test');
    await owner.db
      .update(tenants)
      .set({ registrationAllowed: false })
      .where(eq(tenants.id, tenant.tenantId));

    expect((await follow(tenant.tenantName, key)).statusCode).toBe(400);
    expect(await holder(tenant.tenantId, 'ada')).toBeNull();
  });

  it('keeps naming a taken username, and a weak password reads the same for either address', async () => {
    const tenant = await open();
    await register(tenant, 'ada', 'ada@example.test');

    for (const email of ['new@example.test', 'ada@example.test']) {
      const res = await post(tenant.tenantName, 'ada', email);
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain(en['registration.refusal.usernameTaken']);
    }
    const weakHeld = await post(tenant.tenantName, 'x1', 'ada@example.test', 'short');
    const weakFree = await post(tenant.tenantName, 'x1', 'free@example.test', 'short');
    expect(weakHeld.statusCode).toBe(400);
    const withoutNonce = (html: string): string =>
      html
        .replace(/nonce="[^"]*"/gu, 'nonce=""')
        .replaceAll('ada@example.test', 'free@example.test');
    expect(withoutNonce(weakHeld.body)).toBe(withoutNonce(weakFree.body));
  });

  it('hashes the password once per request on both paths, and not before the policy refuses', async () => {
    const tenant = await open();
    await register(tenant, 'ada', 'ada@example.test');
    let hashed = 0;
    const counting = Fastify();
    counting.register(formbody);
    registerRegistrationRoute(counting, {
      ...accountTestDeps,
      hashPassword: (password) => {
        hashed += 1;
        return hashUserPassword(password);
      },
      findHeldSignIn: () => Promise.resolve(null),
      database: app,
      findTenant: (name) => tenantSettingsRepository(owner.db).byName(name),
      publicBaseUrl,
      now: () => new Date(),
      createAccount,
      evaluatePassword,
    });
    const send = (username: string, email: string, password: string) =>
      counting.inject({
        method: 'POST',
        url: `/tenants/${tenant.tenantName}/login-actions/registration`,
        payload: new URLSearchParams({
          username,
          email,
          password,
          password_confirm: password,
        }).toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

    await send('hedy', 'ada@example.test', PASSWORD);
    await send('grace', 'grace@example.test', PASSWORD);
    await send('weak', 'weak@example.test', 'short');

    expect(hashed).toBe(2);
  });

  it('queues no mail past the address budget, answers the same, and leaves an earlier request alone', async () => {
    const tenant = await open();
    await post(tenant.tenantName, 'ada', 'ada@example.test');
    const earlier = await keyFor(tenant.tenantId, 'ada@example.test');
    await register(tenant, 'bea', 'bea@example.test');
    await owner.db.delete(emailOutbox);
    mailAllowed = false;
    httpApp = buildHttpApp();
    await httpApp.ready();

    const again = await post(tenant.tenantName, 'ada3', 'ada@example.test');
    const free = await post(tenant.tenantName, 'grace', 'grace@example.test');
    const held = await post(tenant.tenantName, 'hedy', 'bea@example.test');

    expect(again.body).toBe(free.body);
    expect(held.body).toBe(free.body);
    expect(await outboxRows(tenant.tenantId)).toEqual([]);
    // Nothing was kept for the refused ones, and the earlier link still works.
    expect(await pendingCount(tenant.tenantId)).toBe(1);
    expect((await follow(tenant.tenantName, earlier)).statusCode).toBe(200);
    expect(await holder(tenant.tenantId, 'ada')).not.toBeNull();
    expect(await auditActions(tenant.tenantId)).toContain('account.registration_duplicate');
  });

  it('draws each kind of mail on a budget of its own', async () => {
    const tenant = await open();
    await register(tenant, 'ada', 'ada@example.test');
    const kinds: string[] = [];
    const recording = Fastify();
    recording.register(formbody);
    registerRegistrationRoute(recording, {
      ...accountTestDeps,
      mailGate: (kind) => {
        kinds.push(kind);
        return true;
      },
      findHeldSignIn: () => Promise.resolve(null),
      database: app,
      findTenant: (name) => tenantSettingsRepository(owner.db).byName(name),
      publicBaseUrl,
      now: () => new Date(),
      createAccount,
      evaluatePassword,
    });
    const send = (username: string, email: string) =>
      recording.inject({
        method: 'POST',
        url: `/tenants/${tenant.tenantName}/login-actions/registration`,
        payload: new URLSearchParams({
          username,
          email,
          password: PASSWORD,
          password_confirm: PASSWORD,
        }).toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

    await send('hedy', 'ada@example.test');
    await send('grace', 'grace@example.test');

    expect(kinds).toEqual(['held', 'registration']);
  });

  it('refuses a confirmation that differs, naming the field and giving neither value back', async () => {
    const tenant = await open();

    const res = await post(
      tenant.tenantName,
      'ada',
      'ada@example.test',
      PASSWORD,
      'another-one-here',
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('The passwords don&#39;t match.');
    expect(res.body).toMatch(/name="password_confirm"[^>]*aria-invalid="true"/u);
    expect(res.body).not.toContain(PASSWORD);
    expect(res.body).not.toContain('another-one-here');
    expect(await pendingCount(tenant.tenantId)).toBe(0);
    expect(await outboxRows(tenant.tenantId)).toEqual([]);
  });

  it('asks for the confirmation, with the toggle covering both fields', async () => {
    const tenant = await open();

    const form = await httpApp.inject({
      url: `/tenants/${tenant.tenantName}/login-actions/registration`,
    });
    const missing = await httpApp.inject({
      method: 'POST',
      url: `/tenants/${tenant.tenantName}/login-actions/registration`,
      payload: new URLSearchParams({
        username: 'ada',
        email: 'ada@example.test',
        password: PASSWORD,
      }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(form.body).toMatch(/name="password_confirm"[^>]*autocomplete="new-password"/u);
    expect(form.body).toContain('again.type = first.type');
    expect(missing.statusCode).toBe(400);
    expect(missing.body).toContain('Enter the password again.');
  });

  it('records a held address as one refused row naming the account, and nothing else', async () => {
    const tenant = await open();
    await register(tenant, 'ada', 'ada@example.test');
    const owned = await subjectIdForUsername(tenant.tenantId, 'ada');

    await post(tenant.tenantName, 'hedy', 'ada@example.test');

    const rows = await withTenant(app.db, tenant.tenantId, (tx) =>
      auditRepository(tx).list({ eventType: 'credential', limit: 50 }),
    );
    const duplicate = rows.filter((r) => r.action === 'account.registration_duplicate');
    expect(duplicate).toHaveLength(1);
    expect(duplicate[0]).toMatchObject({
      outcome: 'refused',
      actorSubjectId: null,
      resourceId: owned,
      detail: { reason: 'already_registered' },
    });
    expect(JSON.stringify(duplicate)).not.toContain('hedy');
  });

  it('does not see an address held in another tenant', async () => {
    const mine = await open();
    const other = await open();
    await register(mine, 'ada', 'ada@example.test');

    const res = await post(other.tenantName, 'ada2', 'ada@example.test');

    expect(res.statusCode).toBe(201);
    expect(await pendingCount(other.tenantId)).toBe(1);
    const [mail] = await outboxRows(other.tenantId);
    expect(mail?.subject.startsWith('Finish')).toBe(true);
    expect(
      (await auditActions(other.tenantId)).filter((a) => a === 'account.registration_duplicate'),
    ).toEqual([]);
  });

  it('refuses a malformed address before keeping anything', async () => {
    const tenant = await open();

    const res = await post(tenant.tenantName, 'ada', 'not-an-address');

    expect(res.statusCode).toBe(400);
    expect(await pendingCount(tenant.tenantId)).toBe(0);
    expect(await outboxRows(tenant.tenantId)).toEqual([]);
  });

  it('says the address is registered where verification is off, whatever its case', async () => {
    const tenant = await seedTenant(`tenant-${newId()}`, { registrationAllowed: true });
    expect((await post(tenant.tenantName, 'ada', 'ada@example.test')).statusCode).toBe(201);

    const res = await post(tenant.tenantName, 'hedy', 'ADA@example.test');

    expect(res.statusCode).toBe(400);
    expect(res.body).toContain(en['registration.refusal.emailTaken']);
    expect(await pendingCount(tenant.tenantId)).toBe(0);
  });
});
