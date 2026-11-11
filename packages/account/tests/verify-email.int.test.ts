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
  emailOutbox,
  sendPending,
  type EmailMessage,
  type EmailSender,
  type SendPendingOptions,
} from '@odudu/email';
import { newId, type TenantAddress } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { auditRepository } from '@odudu/domain-audit';
import { tenantDomainRepository } from '@odudu/domain-tenant';
import { eq, sql } from 'drizzle-orm';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountTestDeps } from '#/testing/support';
import { openAndPress } from '#/testing/support';
import { actionTokens } from '#/schema/action-tokens';
import { tenantSettingsRepository } from '#/repository/tenant-settings';
import {
  sendVerificationEmail,
  type ChangeAddressDeps,
  type SendVerificationEmailDeps,
} from '#/usecase/verify-email';
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
  // The one pending address each subject may have, as the table keeps it.
  const pending = new Map<string, string>();
  const changeAddress: ChangeAddressDeps = {
    lockAddress: () => Promise.resolve(),
    takePending: (_tx, subjectId, email) => {
      const taken = pending.get(subjectId) === email;
      if (taken) pending.delete(subjectId);
      return Promise.resolve(taken);
    },
    holderOf: (_tx, email) => {
      const held = [...users].find(([, user]) => user.email === email);
      return Promise.resolve(held?.[0] ?? null);
    },
    replaceVerified: (_tx, subjectId, email) => {
      users.set(subjectId, { email, verified: true });
      return Promise.resolve();
    },
  };
  return {
    users,
    pending,
    changeAddress,
    getCurrentEmail: (_tx: TenantScopedDatabase, subjectId: string) =>
      Promise.resolve(users.get(subjectId)?.email ?? null),
    markVerified: (_tx: TenantScopedDatabase, subjectId: string) => {
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
async function seedTenant(name: string): Promise<{ tenantId: string; tenantName: string }> {
  const tenantId = newId();
  await owner.db.insert(tenants).values({ id: tenantId, name });
  return { tenantId, tenantName: name };
}

async function insertSubject(tenantId: string, subjectId: string): Promise<void> {
  await withTenant(app.db, tenantId, (tx) =>
    tx.execute(
      sql`insert into subjects (id, tenant_id, type) values (${subjectId}, ${tenantId}, 'user')`,
    ),
  );
}

async function rawSelectAllActionTokens(tenantId: string) {
  return withTenant(app.db, tenantId, (tx) => tx.select().from(actionTokens));
}

let tenantId: string;
let tenantName: string;
let subject: string;
let sender: ReturnType<typeof fakeSender>;

const OUTBOX_OPTIONS: SendPendingOptions = {
  batchSize: 10,
  maxAttempts: 3,
  retryBackoffSeconds: 60,
};

// The flow only queues the mail; the pass that hands it to a transport is
// packages/email/src/usecase/send-pending.ts, and a test that wants the
// mailed link runs it here the way the server's schedule runs it there.

async function drainOutbox(into: EmailSender = sender): Promise<void> {
  await sendPending(
    { database: app, ownerDatabase: owner, resolveSender: () => Promise.resolve(into) },
    new Date(),
    OUTBOX_OPTIONS,
  );
}

async function outboxRows() {
  return withTenant(app.db, tenantId, (tx) => tx.select().from(emailOutbox));
}
let store: ReturnType<typeof fakeUserStore>;
let deps: SendVerificationEmailDeps;
let httpApp: FastifyInstance;

async function buildHttpApp(): Promise<FastifyInstance> {
  const instance = Fastify();
  instance.register(formbody);
  registerActionTokenRoute(instance, {
    ...accountTestDeps,
    findHeldSignIn: () => Promise.resolve(null),
    database: app,
    findTenant: (name) => tenantSettingsRepository(owner.db).byName(name),
    getCurrentEmail: store.getCurrentEmail,
    markVerified: store.markVerified,
    changeAddress: store.changeAddress,
    setPassword: store.setPassword,
    getUsername: store.getUsername,
    // Unused by any test in this file, for the same reason setPassword is.
    evaluatePassword: () => [],
    unchangedPasswordViolations: () => Promise.resolve([]),
    clearPasswordUpdateAction: () => Promise.resolve(),
    addRequiredActions: () => Promise.resolve(),
  });
  await instance.ready();
  return instance;
}

beforeEach(async () => {
  ({ tenantId, tenantName } = await seedTenant(`tenant-${newId()}`));
  subject = newId();
  await insertSubject(tenantId, subject);
  sender = fakeSender();
  store = fakeUserStore();
  store.users.set(subject, { email: 'ada@example.test', verified: false });
  deps = {
    database: app,
    tenantId,
    tenantName,
    tenantDisplayName: 'Ada Test Tenant',
    issuerBase: 'https://idp.example.test',
    now: () => new Date(),
  };
  httpApp = await buildHttpApp();
});

// Every test below reads either what the queue holds or what a drain
// delivered, so each starts with the queue empty rather than with whatever
// an earlier test left in it.
beforeEach(async () => {
  await owner.db.delete(emailOutbox);
});

function pressLink(link: string) {
  const url = new URL(link, 'http://localhost');
  const tenant = /\/tenants\/([^/]+)\//u.exec(url.pathname)?.[1] ?? '';
  return openAndPress(httpApp, tenant, url.searchParams.get('key') ?? '');
}

describe('address verification', () => {
  it('changes nothing when the link is only opened, however often a mail scanner does', async () => {
    await sendVerificationEmail(deps, { subjectId: subject, email: 'ada@example.test' });
    await drainOutbox();
    const message = sender.sent[0];
    if (message === undefined) throw new Error('no mail sent');
    const link = extractLink(message);

    const first = await httpApp.inject({ method: 'GET', url: link });
    const second = await httpApp.inject({ method: 'GET', url: link });

    for (const res of [first, second]) {
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('Confirm your email address');
      expect(res.body).toContain('<form method="post"');
    }
    expect(first.body).toBe(second.body);
    expect(store.users.get(subject)?.verified).toBe(false);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.headers['referrer-policy']).toBe('no-referrer');
    expect(first.body).not.toMatch(/(src|href)="https?:/u);

    expect((await pressLink(link)).statusCode).toBe(200);
    expect(store.users.get(subject)?.verified).toBe(true);
    expect((await pressLink(link)).statusCode).toBe(400);
  });

  it('sends a link the user can follow, and flips email_verified when they do', async () => {
    await sendVerificationEmail(deps, { subjectId: subject, email: 'ada@example.test' });
    await drainOutbox();
    expect(sender.sent).toHaveLength(1);
    const message = sender.sent[0];
    if (message === undefined) throw new Error('no mail sent');
    const link = extractLink(message);

    const res = await pressLink(link);

    expect(res.statusCode).toBe(200);
    expect(store.users.get(subject)?.verified).toBe(true);
  });

  it('mails a link on the canonical domain, and tells the theme which address that is', async () => {
    const scopes: (TenantAddress | undefined)[] = [];
    await sendVerificationEmail(
      {
        ...deps,
        lookupDomain: () => Promise.resolve('login.acme.com'),
        resolveMailLook: (_tx, scope) => {
          scopes.push(scope.address);
          return Promise.resolve({ branding: null, overrides: {} });
        },
      },
      { subjectId: subject, email: 'ada@example.test' },
    );
    await drainOutbox();
    const message = sender.sent[0];
    if (message === undefined) throw new Error('no mail sent');
    expect(extractLink(message)).toMatch(
      /^https:\/\/login\.acme\.com\/login-actions\/action-token\?key=/u,
    );
    expect(scopes.map((a) => a?.origin)).toEqual(['https://login.acme.com']);
  });

  it('mails a link on the canonical domain the tenant has in the table, with nothing injected', async () => {
    await withTenant(app.db, tenantId, async (tx) => {
      const domains = tenantDomainRepository(tx);
      const row = await domains.insert({ tenantId, host: 'login.acme.com', challenge: 'c' });
      await domains.markVerified(tenantId, row.id, new Date());
      await domains.setCanonical(tenantId, row.id);
    });
    try {
      await sendVerificationEmail(deps, { subjectId: subject, email: 'ada@example.test' });
      await drainOutbox();
      const message = sender.sent[0];
      if (message === undefined) throw new Error('no mail sent');
      expect(extractLink(message)).toMatch(
        /^https:\/\/login\.acme\.com\/login-actions\/action-token\?key=/u,
      );
    } finally {
      await owner.sql`delete from tenant_domains where tenant_id = ${tenantId}`;
    }
  });

  it('queues the mail in the transaction that issues the token, and sends nothing itself', async () => {
    await sendVerificationEmail(deps, { subjectId: subject, email: 'ada@example.test' });

    // The token is durably stored and the mail that carries it is queued
    // beside it, and no transport has been spoken to: the send happens on
    // the outbox pass, where a failure cannot reach a caller.
    expect(await rawSelectAllActionTokens(tenantId)).toHaveLength(1);
    expect(await outboxRows()).toHaveLength(1);
    expect(sender.sent).toHaveLength(0);
  });

  it('stamps the queued mail with the year of the clock it was given, not of the machine', async () => {
    await sendVerificationEmail(
      { ...deps, now: () => new Date('2031-01-01T00:00:00Z') },
      { subjectId: subject, email: 'ada@example.test' },
    );

    const [queued] = await outboxRows();
    expect(queued?.bodyHtml).toContain('\u00a9 2031 Odudu');
    expect(queued?.bodyText).toContain('\u00a9 2031 Odudu');
  });

  it('keeps the queued message, with its error, when the transport refuses it', async () => {
    const throwingSender: EmailSender = {
      send: () => Promise.reject(new Error('mail transport unavailable')),
    };
    await sendVerificationEmail(deps, { subjectId: subject, email: 'ada@example.test' });

    await drainOutbox(throwingSender);

    const queued = await outboxRows();
    expect(queued).toHaveLength(1);
    expect(queued[0]?.attempts).toBe(1);
    expect(queued[0]?.lastError).toBe('mail transport unavailable');
    expect(await rawSelectAllActionTokens(tenantId)).toHaveLength(1);
  });

  it('refuses a second use of the same link', async () => {
    await sendVerificationEmail(deps, { subjectId: subject, email: 'ada@example.test' });
    await drainOutbox();
    const message = sender.sent[0];
    if (message === undefined) throw new Error('no mail sent');
    const link = extractLink(message);

    const first = await pressLink(link);
    expect(first.statusCode).toBe(200);

    const second = await pressLink(link);
    expect(second.statusCode).toBe(400);
  });

  it('answers a refused submission with the page the opened link shows', async () => {
    await sendVerificationEmail(deps, { subjectId: subject, email: 'ada@example.test' });
    await drainOutbox();
    const message = sender.sent[0];
    if (message === undefined) throw new Error('no mail sent');
    const link = extractLink(message);
    const url = new URL(link, 'http://localhost');
    const key = url.searchParams.get('key') ?? '';
    expect((await pressLink(link)).statusCode).toBe(200);

    const opened = await httpApp.inject({ url: `${url.pathname}${url.search}` });
    const posted = await httpApp.inject({
      method: 'POST',
      url: `/tenants/${tenantName}/login-actions/action-token`,
      payload: new URLSearchParams({ key }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(posted.statusCode).toBe(400);
    expect(posted.body).toBe(opened.body);
    expect(posted.body).toContain('<title>Can&#39;t verify this link</title>');
  });

  it('invalidates an outstanding token when the address changes', async () => {
    await sendVerificationEmail(deps, { subjectId: subject, email: 'ada@example.test' });
    await drainOutbox();
    const message = sender.sent[0];
    if (message === undefined) throw new Error('no mail sent');
    const link = extractLink(message);

    const user = store.users.get(subject);
    if (user === undefined) throw new Error('fixture missing');
    user.email = 'ada+new@example.test';

    const res = await pressLink(link);
    expect(res.statusCode).toBe(400);
    expect(store.users.get(subject)?.verified).toBe(false);
  });

  it('refuses a token minted in another tenant', async () => {
    const other = await seedTenant(`tenant-${newId()}`);
    const otherSubject = newId();
    await insertSubject(other.tenantId, otherSubject);
    const otherStore = fakeUserStore();
    otherStore.users.set(otherSubject, { email: 'grace@example.test', verified: false });
    const otherDeps: SendVerificationEmailDeps = {
      database: app,
      tenantId: other.tenantId,
      tenantName: other.tenantName,
      tenantDisplayName: 'Other Tenant',
      issuerBase: 'https://idp.example.test',
      now: () => new Date(),
    };

    await sendVerificationEmail(otherDeps, {
      subjectId: otherSubject,
      email: 'grace@example.test',
    });
    await drainOutbox();
    const message = sender.sent[0];
    if (message === undefined) throw new Error('no mail sent');
    const link = extractLink(message).replace(
      `/tenants/${other.tenantName}/`,
      `/tenants/${tenantName}/`,
    );

    const res = await pressLink(link);
    expect(res.statusCode).toBe(400);
  });

  it('rejects a request naming a tenant that does not exist', async () => {
    await sendVerificationEmail(deps, { subjectId: subject, email: 'ada@example.test' });
    await drainOutbox();
    const message = sender.sent[0];
    if (message === undefined) throw new Error('no mail sent');
    const link = extractLink(message).replace(
      `/tenants/${tenantName}/`,
      '/tenants/does-not-exist/',
    );

    const res = await pressLink(link);
    expect(res.statusCode).toBe(400);
  });

  it('refuses to redeem a link minted for a tenant that has since been disabled', async () => {
    await sendVerificationEmail(deps, { subjectId: subject, email: 'ada@example.test' });
    await drainOutbox();
    const message = sender.sent[0];
    if (message === undefined) throw new Error('no mail sent');
    const link = extractLink(message);

    await owner.db.update(tenants).set({ enabled: false }).where(eq(tenants.id, tenantId));

    const res = await pressLink(link);
    expect(res.statusCode).toBe(400);
    expect(store.users.get(subject)?.verified).toBe(false);
  });

  it('rejects a request with no key', async () => {
    const res = await httpApp.inject({
      method: 'GET',
      url: `/tenants/${tenantName}/login-actions/action-token`,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('an address change', () => {
  const NEW = 'ada.new@example.test';

  async function mailedLink(email: string): Promise<string> {
    await sendVerificationEmail(deps, { subjectId: subject, email });
    await drainOutbox();
    const message = sender.sent.at(-1);
    if (message === undefined) throw new Error('no mail sent');
    return extractLink(message);
  }

  const auditActions = () =>
    withTenant(app.db, tenantId, async (tx) =>
      (await auditRepository(tx).list({ limit: 50 })).map((row) => row.action),
    );

  it('swaps the address in, verified, when the link for the pending address is used', async () => {
    store.pending.set(subject, NEW);
    const link = await mailedLink(NEW);

    expect(store.users.get(subject)).toEqual({ email: 'ada@example.test', verified: false });
    expect((await pressLink(link)).statusCode).toBe(200);

    expect(store.users.get(subject)).toEqual({ email: NEW, verified: true });
    expect(store.pending.has(subject)).toBe(false);
    expect(await auditActions()).toContain('email.changed');
    expect((await pressLink(link)).statusCode).toBe(400);
  });

  it('refuses a link whose pending address was replaced since it was mailed', async () => {
    store.pending.set(subject, NEW);
    const old = await mailedLink(NEW);
    store.pending.set(subject, 'ada.other@example.test');

    expect((await pressLink(old)).statusCode).toBe(400);
    expect(store.users.get(subject)?.email).toBe('ada@example.test');
    expect(store.pending.get(subject)).toBe('ada.other@example.test');
  });

  it('refuses a link whose pending address was cleared', async () => {
    store.pending.set(subject, NEW);
    const link = await mailedLink(NEW);
    store.pending.delete(subject);

    expect((await pressLink(link)).statusCode).toBe(400);
    expect(store.users.get(subject)?.email).toBe('ada@example.test');
  });

  it('refuses the swap when another account has taken the address since', async () => {
    store.pending.set(subject, NEW);
    const link = await mailedLink(NEW);
    store.users.set(newId(), { email: NEW, verified: true });

    expect((await pressLink(link)).statusCode).toBe(400);
    expect(store.users.get(subject)?.email).toBe('ada@example.test');
    expect(await auditActions()).not.toContain('email.changed');
  });

  it('refuses a link for an address nothing is pending for', async () => {
    const link = await mailedLink(NEW);

    expect((await pressLink(link)).statusCode).toBe(400);
    expect(store.users.get(subject)?.email).toBe('ada@example.test');
  });
});
