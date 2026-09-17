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
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { realmSettingsRepository } from '#/repository/realm-settings';
import { registerResetPasswordRoute } from '#/view/routes/reset-password';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

// Long enough that a send inside the request shows up as a difference no
// scheduling noise can explain, and that the assertions below can carry
// wide margins instead of the few milliseconds a real SMTP round trip
// costs — a timing test with a tight margin is a flaky test.
const SEND_DELAY_MS = 2000;

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

function slowSender(delayMs: number): EmailSender & { readonly sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    send: async (message: EmailMessage) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      sent.push(message);
    },
  };
}

async function createAccount(
  tx: RealmScopedDatabase,
  realmId: string,
  input: { username: string; email: string; password: string },
): Promise<void> {
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
}

let sender: ReturnType<typeof slowSender>;
let httpApp: FastifyInstance;
let realmId: string;
let realmName: string;

beforeEach(async () => {
  realmId = newId();
  realmName = `timing-${newId()}`;
  await owner.db
    .insert(realms)
    .values({ id: realmId, name: realmName, resetPasswordAllowed: true });
  await withRealm(app.db, realmId, (tx) =>
    createAccount(tx, realmId, {
      username: 'ada',
      email: 'ada@example.test',
      password: 'correct horse battery',
    }),
  );

  sender = slowSender(SEND_DELAY_MS);
  httpApp = Fastify();
  await httpApp.register(formbody);
  registerResetPasswordRoute(httpApp, {
    database: app,
    findRealm: (name) => realmSettingsRepository(owner.db).byName(name),
    publicBaseUrl: 'https://idp.example.test',
    findByEmail: async (tx, email) => {
      const user = await userRepository(tx).byEmail(email);
      return user?.email == null ? null : { subjectId: user.subjectId, email: user.email };
    },
  });
  await httpApp.ready();
});

// Every test below reads either what the queue holds or what a drain
// delivered, so each starts with the queue empty rather than with whatever
// an earlier test left in it.
beforeEach(async () => {
  await owner.db.delete(emailOutbox);
});

const OUTBOX_OPTIONS: SendPendingOptions = {
  batchSize: 10,
  maxAttempts: 3,
  retryBackoffSeconds: 60,
};

async function drainOutbox(): Promise<void> {
  await sendPending({ database: app, ownerDatabase: owner, sender }, new Date(), OUTBOX_OPTIONS);
}

async function outboxRows() {
  return withRealm(app.db, realmId, (tx) => tx.select().from(emailOutbox));
}

async function elapsed(fn: () => Promise<unknown>): Promise<number> {
  const started = performance.now();
  await fn();
  return performance.now() - started;
}

async function timeRequest(email: string): Promise<number> {
  const started = performance.now();
  const res = await httpApp.inject({
    method: 'POST',
    url: `/realms/${realmName}/login-actions/reset-password`,
    payload: new URLSearchParams({ email }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  const elapsed = performance.now() - started;
  expect(res.statusCode).toBe(200);
  return elapsed;
}

// The visible channel was closed when this flow was written: the body and
// status are identical for a known and an unknown address. This is the
// invisible one — an address that existed answered measurably slower,
// because the SMTP round trip happened inside the response. What keeps it
// closed is structural rather than this measurement, which injects the
// transport it times: no type reachable from a request carries an
// EmailSender, so a send on a request path does not compile. Keep both.

describe('the reset request is not a timing oracle', () => {
  it('answers a known and an unknown address in the same time', async () => {
    const known = await timeRequest('ada@example.test');
    const unknown = await timeRequest('nobody@example.test');

    expect(Math.abs(known - unknown)).toBeLessThan(500);
    expect(known).toBeLessThan(1000);

    // Not just that nothing was sent — a flow that mails nobody anything
    // would satisfy that too. Exactly one message is queued, for the
    // address that has an account.
    expect(sender.sent).toHaveLength(0);
    const queued = await outboxRows();
    expect(queued).toHaveLength(1);
    expect(queued[0]?.toAddress).toBe('ada@example.test');

    // And this is where the transport's two seconds went: paid by the
    // pass, long after both answers were composed.
    const drain = await elapsed(drainOutbox);
    expect(sender.sent).toHaveLength(1);
    expect(drain).toBeGreaterThan(SEND_DELAY_MS * 0.9);
  });
});
