import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import { type EmailMessage, type EmailSender } from '@odudu/email';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq, sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { actionTokens } from '#/schema/action-tokens';
import { realmSettingsRepository } from '#/repository/realm-settings';
import { sendVerificationEmail, type SendVerificationEmailDeps } from '#/usecase/verify-email';
import { registerActionTokenRoute } from '#/view/routes/action-token';

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

// A stand-in for @odudu/domain-identity's users table: @odudu/account never
// imports that package, so completeEmailVerification's getCurrentEmail and
// markVerified are exercised here the way apps/server/src/app.ts wires them
// for real, against a fixture this file owns instead.
interface FakeUser {
  email: string;
  verified: boolean;
}

function fakeUserStore() {
  const users = new Map<string, FakeUser>();
  return {
    users,
    getCurrentEmail: (_tx: RealmScopedDatabase, subjectId: string) =>
      Promise.resolve(users.get(subjectId)?.email ?? null),
    markVerified: (_tx: RealmScopedDatabase, subjectId: string) => {
      const user = users.get(subjectId);
      if (user !== undefined) user.verified = true;
      return Promise.resolve();
    },
    // Unused by any test in this file — verify_email tokens never reach the
    // reset_password branch — but registerActionTokenRoute requires it.
    setPassword: () => Promise.resolve(),
    getUsername: () => Promise.resolve(''),
  };
}

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
// after "by visiting this link:\n\n"; extracting it here is what lets a test
// exercise the same URL a real inbox would show, path and query included.
function extractLink(message: EmailMessage): string {
  const match = /visiting this link:\n\n(\S+)/.exec(message.text);
  if (match?.[1] === undefined) {
    throw new Error(`no link found in ${message.text}`);
  }
  return match[1];
}

// @odudu/account never imports @odudu/domain-identity, so a subject fixture
// is inserted with raw SQL rather than through that package's repository —
// the same idiom packages/account/tests/action-tokens.int.test.ts uses.
async function seedRealm(name: string): Promise<{ realmId: string; realmName: string }> {
  const realmId = newId();
  await owner.db.insert(realms).values({ id: realmId, name });
  return { realmId, realmName: name };
}

async function insertSubject(realmId: string, subjectId: string): Promise<void> {
  await withRealm(app.db, realmId, (tx) =>
    tx.execute(
      sql`insert into subjects (id, realm_id, type) values (${subjectId}, ${realmId}, 'user')`,
    ),
  );
}

async function rawSelectAllActionTokens(realmId: string) {
  return withRealm(app.db, realmId, (tx) => tx.select().from(actionTokens));
}

let realmId: string;
let realmName: string;
let subject: string;
let sender: ReturnType<typeof fakeSender>;
let store: ReturnType<typeof fakeUserStore>;
let deps: SendVerificationEmailDeps;
let httpApp: FastifyInstance;

async function buildHttpApp(): Promise<FastifyInstance> {
  const instance = Fastify();
  registerActionTokenRoute(instance, {
    database: app,
    findRealm: (name) => realmSettingsRepository(owner.db).byName(name),
    getCurrentEmail: store.getCurrentEmail,
    markVerified: store.markVerified,
    setPassword: store.setPassword,
    getUsername: store.getUsername,
    // Unused by any test in this file, for the same reason setPassword is.
    evaluatePassword: () => [],
  });
  await instance.ready();
  return instance;
}

beforeEach(async () => {
  ({ realmId, realmName } = await seedRealm(`realm-${newId()}`));
  subject = newId();
  await insertSubject(realmId, subject);
  sender = fakeSender();
  store = fakeUserStore();
  store.users.set(subject, { email: 'ada@example.test', verified: false });
  deps = {
    database: app,
    sender,
    realmId,
    realmName,
    realmDisplayName: 'Ada Test Realm',
    issuerBase: 'https://idp.example.test',
  };
  httpApp = await buildHttpApp();
});

describe('address verification', () => {
  it('sends a link the user can follow, and flips email_verified when they do', async () => {
    await sendVerificationEmail(deps, { subjectId: subject, email: 'ada@example.test' });
    expect(sender.sent).toHaveLength(1);
    const message = sender.sent[0];
    if (message === undefined) throw new Error('no mail sent');
    const link = extractLink(message);

    const res = await httpApp.inject({ method: 'GET', url: link });

    expect(res.statusCode).toBe(200);
    expect(store.users.get(subject)?.verified).toBe(true);
  });

  it('sends the mail only after the transaction that issued the token commits', async () => {
    // A sender that throws still leaves the token stored: proof that the
    // insert already committed before send was even attempted, not proof
    // merely that both eventually happened.
    const throwingSender: EmailSender = {
      send: () => Promise.reject(new Error('mail transport unavailable')),
    };

    await expect(
      sendVerificationEmail(
        { ...deps, sender: throwingSender },
        { subjectId: subject, email: 'ada@example.test' },
      ),
    ).rejects.toThrow('mail transport unavailable');

    const stored = await rawSelectAllActionTokens(realmId);
    expect(stored).toHaveLength(1);
  });

  it('refuses a second use of the same link', async () => {
    await sendVerificationEmail(deps, { subjectId: subject, email: 'ada@example.test' });
    const message = sender.sent[0];
    if (message === undefined) throw new Error('no mail sent');
    const link = extractLink(message);

    const first = await httpApp.inject({ method: 'GET', url: link });
    expect(first.statusCode).toBe(200);

    const second = await httpApp.inject({ method: 'GET', url: link });
    expect(second.statusCode).toBe(400);
  });

  it('invalidates an outstanding token when the address changes', async () => {
    await sendVerificationEmail(deps, { subjectId: subject, email: 'ada@example.test' });
    const message = sender.sent[0];
    if (message === undefined) throw new Error('no mail sent');
    const link = extractLink(message);

    const user = store.users.get(subject);
    if (user === undefined) throw new Error('fixture missing');
    user.email = 'ada+new@example.test';

    const res = await httpApp.inject({ method: 'GET', url: link });
    expect(res.statusCode).toBe(400);
    expect(store.users.get(subject)?.verified).toBe(false);
  });

  it('refuses a token minted in another realm', async () => {
    const other = await seedRealm(`realm-${newId()}`);
    const otherSubject = newId();
    await insertSubject(other.realmId, otherSubject);
    const otherStore = fakeUserStore();
    otherStore.users.set(otherSubject, { email: 'grace@example.test', verified: false });
    const otherDeps: SendVerificationEmailDeps = {
      database: app,
      sender,
      realmId: other.realmId,
      realmName: other.realmName,
      realmDisplayName: 'Other Realm',
      issuerBase: 'https://idp.example.test',
    };

    await sendVerificationEmail(otherDeps, {
      subjectId: otherSubject,
      email: 'grace@example.test',
    });
    const message = sender.sent[0];
    if (message === undefined) throw new Error('no mail sent');
    const link = extractLink(message).replace(
      `/realms/${other.realmName}/`,
      `/realms/${realmName}/`,
    );

    const res = await httpApp.inject({ method: 'GET', url: link });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a request naming a realm that does not exist', async () => {
    await sendVerificationEmail(deps, { subjectId: subject, email: 'ada@example.test' });
    const message = sender.sent[0];
    if (message === undefined) throw new Error('no mail sent');
    const link = extractLink(message).replace(`/realms/${realmName}/`, '/realms/does-not-exist/');

    const res = await httpApp.inject({ method: 'GET', url: link });
    expect(res.statusCode).toBe(400);
  });

  it('refuses to redeem a link minted for a realm that has since been disabled', async () => {
    await sendVerificationEmail(deps, { subjectId: subject, email: 'ada@example.test' });
    const message = sender.sent[0];
    if (message === undefined) throw new Error('no mail sent');
    const link = extractLink(message);

    await owner.db.update(realms).set({ enabled: false }).where(eq(realms.id, realmId));

    const res = await httpApp.inject({ method: 'GET', url: link });
    expect(res.statusCode).toBe(400);
    expect(store.users.get(subject)?.verified).toBe(false);
  });

  it('rejects a request with no key', async () => {
    const res = await httpApp.inject({
      method: 'GET',
      url: `/realms/${realmName}/login-actions/action-token`,
    });
    expect(res.statusCode).toBe(400);
  });
});
