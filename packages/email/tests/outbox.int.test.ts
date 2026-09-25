import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { expectCrossTenantMethodProbe, expectTenantIsolation } from '@odudu/db/testing';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { outboxRepository } from '#/repository/outbox';
import { emailOutbox } from '#/schema/outbox';
import { type EmailMessage, type EmailSender } from '#/service/sender';
import {
  OUTBOX_CLAIM_LEASE_SECONDS,
  sendPending,
  type SendPendingOptions,
} from '#/usecase/send-pending';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let appUrl: string;

const MINUTE = 60 * 1000;
// Every row below is queued at this instant and every pass is given it, so
// nothing here depends on the clock either this process or the container
// happens to be running.
const NOW = new Date('2026-06-01T12:00:00.000Z');

const OPTIONS: SendPendingOptions = {
  batchSize: 10,
  maxAttempts: 3,
  retryBackoffSeconds: 60,
};

const CLAIM = {
  limit: 10,
  now: NOW,
  maxAttempts: OPTIONS.maxAttempts,
  leaseSeconds: OUTBOX_CLAIM_LEASE_SECONDS,
};

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;

  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);

  appUrl = await createAppRole(container.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

function capturing(): EmailSender & { readonly sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    send: (message: EmailMessage) => {
      sent.push(message);
      return Promise.resolve();
    },
  };
}

function refusing(reason = 'mail transport unavailable'): EmailSender {
  return { send: () => Promise.reject(new Error(reason)) };
}

// Every test in this file but the multi-tenant-routing one below has no
// opinion on which tenant asks — the same sender answers regardless.
function resolveTo(sender: EmailSender): (tenantId: string) => Promise<EmailSender> {
  return () => Promise.resolve(sender);
}

let tenantId: string;

async function seedTenant(): Promise<string> {
  const id = newId();
  await owner.db.insert(tenants).values({ id, name: `outbox-${id}` });
  return id;
}

async function enqueue(
  into: string = tenantId,
  overrides: Partial<{ to: string; subject: string }> = {},
): Promise<string> {
  const { id } = await withTenant(app.db, into, (tx) =>
    outboxRepository(tx).enqueue(
      {
        tenantId: into,
        to: overrides.to ?? 'ada@example.test',
        subject: overrides.subject ?? 'Reset your password',
        text: 'Visit this link',
        html: '<p>Visit this link</p>',
      },
      NOW,
    ),
  );
  return id;
}

async function rowById(id: string, into: string = tenantId) {
  const rows = await withTenant(app.db, into, (tx) =>
    tx.select().from(emailOutbox).where(eq(emailOutbox.id, id)),
  );
  return rows[0];
}

beforeEach(async () => {
  tenantId = await seedTenant();
});

describe('the outbox repository', () => {
  it('hands a queued message out once, with its attempt already counted', async () => {
    const id = await enqueue();

    const claimed = await withTenant(app.db, tenantId, (tx) =>
      outboxRepository(tx).claimBatch(CLAIM),
    );

    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({
      id,
      to: 'ada@example.test',
      subject: 'Reset your password',
      text: 'Visit this link',
      html: '<p>Visit this link</p>',
      attempts: 1,
    });

    // The claim is a lease: the same message is not offered again until it
    // elapses, so a sender that dies mid-send costs that wait and no more.
    const again = await withTenant(app.db, tenantId, (tx) =>
      outboxRepository(tx).claimBatch(CLAIM),
    );
    expect(again).toHaveLength(0);
    const row = await rowById(id);
    expect(row?.nextAttemptAt).toEqual(new Date(NOW.getTime() + OUTBOX_CLAIM_LEASE_SECONDS * 1000));
  });

  // The row's own due time is the application's clock, not the database's,
  // so a pass given an instant from the same clock that queued the message
  // finds it due — whatever the container's clock says.
  it('queues a message due at the instant it was given', async () => {
    const id = await enqueue();

    const row = await rowById(id);
    expect(row?.nextAttemptAt).toEqual(NOW);
  });

  it('offers nothing that is sent, not yet due, or out of attempts', async () => {
    const sent = await enqueue();
    const later = await enqueue();
    const spent = await enqueue();
    await withTenant(app.db, tenantId, async (tx) => {
      await outboxRepository(tx).markSent(sent, NOW);
      await outboxRepository(tx).markFailed(later, 'not yet', new Date(NOW.getTime() + MINUTE));
      await tx
        .update(emailOutbox)
        .set({ attempts: OPTIONS.maxAttempts })
        .where(eq(emailOutbox.id, spent));
    });

    const claimed = await withTenant(app.db, tenantId, (tx) =>
      outboxRepository(tx).claimBatch(CLAIM),
    );

    expect(claimed).toEqual([]);
  });

  it('claims the oldest first, up to the limit', async () => {
    const first = await enqueue(tenantId, { subject: 'first' });
    await enqueue(tenantId, { subject: 'second' });
    await withTenant(app.db, tenantId, (tx) =>
      tx
        .update(emailOutbox)
        .set({ nextAttemptAt: new Date(NOW.getTime() - 120 * MINUTE) })
        .where(eq(emailOutbox.id, first)),
    );

    const claimed = await withTenant(app.db, tenantId, (tx) =>
      outboxRepository(tx).claimBatch({ ...CLAIM, limit: 1 }),
    );

    expect(claimed.map((message) => message.id)).toEqual([first]);
  });

  // What `FOR UPDATE SKIP LOCKED` buys over serialising senders behind one
  // lock: two of them meeting on the same queue take different messages and
  // both make progress, and neither sees the other's.
  it('never hands one message to two senders at once', async () => {
    const ids = [await enqueue(), await enqueue()];

    const claims = await withTenant(app.db, tenantId, async (mine) => {
      const first = await outboxRepository(mine).claimBatch({ ...CLAIM, limit: 1 });
      // A second connection, while the first transaction still holds its
      // row: this is the concurrent sender.
      const second = await withTenant(app.db, tenantId, (theirs) =>
        outboxRepository(theirs).claimBatch({ ...CLAIM, limit: 1 }),
      );
      return [first, second];
    });

    const claimed = claims.flat().map((message) => message.id);
    expect(claimed).toHaveLength(2);
    expect(new Set(claimed)).toEqual(new Set(ids));
  });

  it('records a delivery once, and says which call was the one that did', async () => {
    const id = await enqueue();

    const first = await withTenant(app.db, tenantId, (tx) =>
      outboxRepository(tx).markSent(id, NOW),
    );
    const second = await withTenant(app.db, tenantId, (tx) =>
      outboxRepository(tx).markSent(id, new Date(NOW.getTime() + MINUTE)),
    );

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect((await rowById(id))?.sentAt).toEqual(NOW);
  });

  it('keeps a refused message, with the reason and the next attempt', async () => {
    const id = await enqueue();
    const retryAt = new Date(NOW.getTime() + 5 * MINUTE);

    await withTenant(app.db, tenantId, (tx) =>
      outboxRepository(tx).markFailed(id, 'connection refused', retryAt),
    );

    const row = await rowById(id);
    expect(row?.sentAt).toBeNull();
    expect(row?.lastError).toBe('connection refused');
    expect(row?.nextAttemptAt).toEqual(retryAt);
  });

  it('scopes its rows to the tenant that queued them', async () => {
    await expectTenantIsolation(app.db, {
      table: 'email_outbox',
      seed: async (tx, seededTenant) => {
        await owner.db.insert(tenants).values({ id: seededTenant, name: `probe-${seededTenant}` });
        await outboxRepository(tx).enqueue({
          tenantId: seededTenant,
          to: 'ada@example.test',
          subject: 'Probe',
          text: 't',
          html: '<p>t</p>',
        });
      },
    });
  });
});

describe('a foreign tenant cannot reach a queued message', () => {
  it('refuses to queue a message for another tenant', async () => {
    const foreignTenant = await seedTenant();

    // The policy declares no WITH CHECK, so its USING expression is what
    // refuses the insert: the row is not merely invisible afterwards, it
    // was never written.
    await expect(
      withTenant(app.db, tenantId, (tx) =>
        outboxRepository(tx).enqueue({
          tenantId: foreignTenant,
          to: 'ada@example.test',
          subject: 'Not yours',
          text: 't',
          html: '<p>t</p>',
        }),
      ),
    ).rejects.toThrow();

    const rows = await owner.db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.tenantId, foreignTenant));
    expect(rows).toEqual([]);
  });

  it('claims nothing of another tenant, and leaves its attempt count alone', async () => {
    const foreignTenant = await seedTenant();
    const id = await enqueue(foreignTenant);

    const claimed = await withTenant(app.db, tenantId, (tx) =>
      outboxRepository(tx).claimBatch(CLAIM),
    );

    expect(claimed).toEqual([]);
    expect((await rowById(id, foreignTenant))?.attempts).toBe(0);
  });

  it('cannot mark another tenant’s message sent', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, seededTenant) => {
        await owner.db.insert(tenants).values({ id: seededTenant, name: `probe-${seededTenant}` });
        const { id } = await outboxRepository(tx).enqueue({
          tenantId: seededTenant,
          to: 'ada@example.test',
          subject: 'Probe',
          text: 't',
          html: '<p>t</p>',
        });
        return id;
      },
      verifySeeded: async (tx, id) => {
        const rows = await tx.select().from(emailOutbox).where(eq(emailOutbox.id, id));
        expect(rows[0]?.sentAt).toBeNull();
      },
      attempt: (tx, id) => outboxRepository(tx).markSent(id, NOW),
      // It defaults rather than raising, so the probe asserts the
      // non-default: the foreign call reports it changed nothing.
      expectBlocked: (result) => {
        expect(result).toBe(false);
      },
      verifyTenantAUnaffected: async (tx, id) => {
        const rows = await tx.select().from(emailOutbox).where(eq(emailOutbox.id, id));
        expect(rows[0]?.sentAt).toBeNull();
      },
    });
  });

  it('cannot record a failure against another tenant’s message', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, seededTenant) => {
        await owner.db.insert(tenants).values({ id: seededTenant, name: `probe-${seededTenant}` });
        const { id } = await outboxRepository(tx).enqueue({
          tenantId: seededTenant,
          to: 'ada@example.test',
          subject: 'Probe',
          text: 't',
          html: '<p>t</p>',
        });
        return id;
      },
      verifySeeded: async (tx, id) => {
        const rows = await tx.select().from(emailOutbox).where(eq(emailOutbox.id, id));
        expect(rows[0]?.lastError).toBeNull();
      },
      attempt: (tx, id) =>
        outboxRepository(tx).markFailed(id, 'written from the wrong tenant', NOW),
      expectBlocked: () => undefined,
      verifyTenantAUnaffected: async (tx, id) => {
        const rows = await tx.select().from(emailOutbox).where(eq(emailOutbox.id, id));
        expect(rows[0]?.lastError).toBeNull();
      },
    });
  });
});

describe('the sending pass', () => {
  // The pass visits every tenant in the database, and the tests above have
  // left tenants behind in this one: emptying the queue is what makes the
  // counts below exact rather than "at least".
  beforeEach(async () => {
    await owner.db.delete(emailOutbox);
  });

  it('sends what is queued and records the delivery', async () => {
    const id = await enqueue();
    const sender = capturing();

    const outcome = await sendPending(
      { database: app, ownerDatabase: owner, resolveSender: resolveTo(sender) },
      NOW,
      OPTIONS,
    );

    expect(outcome).toEqual({ ran: true, sent: 1, failed: 0 });
    expect(sender.sent).toEqual([
      {
        to: 'ada@example.test',
        subject: 'Reset your password',
        text: 'Visit this link',
        html: '<p>Visit this link</p>',
      },
    ]);
    expect((await rowById(id))?.sentAt).toEqual(NOW);
  });

  it('visits every tenant, not only the first', async () => {
    await enqueue();
    const second = await seedTenant();
    await enqueue(second);
    const sender = capturing();

    const outcome = await sendPending(
      { database: app, ownerDatabase: owner, resolveSender: resolveTo(sender) },
      NOW,
      OPTIONS,
    );

    expect(outcome).toEqual({ ran: true, sent: 2, failed: 0 });
  });

  // The one behaviour this whole file exists to prove: resolveSender is
  // asked per tenant, and a tenant's message reaches only the sender
  // resolved for its own tenant id — not a single process-wide sender
  // every tenant shares.
  it('resolves a distinct sender per tenant, and routes each message to its own', async () => {
    const first = tenantId;
    const second = await seedTenant();
    await enqueue(first, { to: 'first@example.test' });
    await enqueue(second, { to: 'second@example.test' });
    const sendersByTenant = new Map([
      [first, capturing()],
      [second, capturing()],
    ]);

    const outcome = await sendPending(
      {
        database: app,
        ownerDatabase: owner,
        resolveSender: (askedTenantId) => {
          const sender = sendersByTenant.get(askedTenantId);
          if (sender === undefined) throw new Error(`unexpected tenant ${askedTenantId}`);
          return Promise.resolve(sender);
        },
      },
      NOW,
      OPTIONS,
    );

    expect(outcome).toEqual({ ran: true, sent: 2, failed: 0 });
    expect(sendersByTenant.get(first)?.sent.map((m) => m.to)).toEqual(['first@example.test']);
    expect(sendersByTenant.get(second)?.sent.map((m) => m.to)).toEqual(['second@example.test']);
  });

  it('backs a refused message off and keeps the reason, without sending it again', async () => {
    const id = await enqueue();

    const first = await sendPending(
      { database: app, ownerDatabase: owner, resolveSender: resolveTo(refusing()) },
      NOW,
      OPTIONS,
    );

    expect(first).toEqual({ ran: true, sent: 0, failed: 1 });
    const row = await rowById(id);
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toBe('mail transport unavailable');
    expect(row?.nextAttemptAt).toEqual(
      new Date(NOW.getTime() + OPTIONS.retryBackoffSeconds * 1000),
    );

    // Immediately afterwards there is nothing due, so a pass that ran
    // again would be retrying inside the backoff it just set.
    const sender = capturing();
    const immediately = await sendPending(
      { database: app, ownerDatabase: owner, resolveSender: resolveTo(sender) },
      NOW,
      OPTIONS,
    );
    expect(immediately).toEqual({ ran: true, sent: 0, failed: 0 });
    expect(sender.sent).toEqual([]);
  });

  it('retries once the backoff has elapsed, and stops at the ceiling', async () => {
    const id = await enqueue();
    let at = NOW;

    for (let attempt = 1; attempt <= OPTIONS.maxAttempts; attempt += 1) {
      const outcome = await sendPending(
        { database: app, ownerDatabase: owner, resolveSender: resolveTo(refusing()) },
        at,
        OPTIONS,
      );
      expect(outcome).toEqual({ ran: true, sent: 0, failed: 1 });
      at = new Date(at.getTime() + 24 * 60 * MINUTE);
    }

    expect((await rowById(id))?.attempts).toBe(OPTIONS.maxAttempts);

    // Past the ceiling the message is not attempted again — and it is
    // still here, with its error, for an operator to read.
    const sender = capturing();
    const after = await sendPending(
      { database: app, ownerDatabase: owner, resolveSender: resolveTo(sender) },
      at,
      OPTIONS,
    );
    expect(after).toEqual({ ran: true, sent: 0, failed: 0 });
    expect(sender.sent).toEqual([]);
    const row = await rowById(id);
    expect(row?.sentAt).toBeNull();
    expect(row?.lastError).toBe('mail transport unavailable');
  });

  // The transport took it, but another sender had already recorded the
  // delivery: counting it here would inflate every report where two
  // senders overlap, which is what `markSent` reporting the winner is for.
  it('does not count a message another sender recorded first', async () => {
    const id = await enqueue();
    const racing: EmailSender = {
      send: async () => {
        await withTenant(app.db, tenantId, (tx) => outboxRepository(tx).markSent(id, NOW));
      },
    };

    const outcome = await sendPending(
      { database: app, ownerDatabase: owner, resolveSender: resolveTo(racing) },
      NOW,
      OPTIONS,
    );

    expect(outcome).toEqual({ ran: true, sent: 0, failed: 0 });
    expect((await rowById(id))?.sentAt).toEqual(NOW);
  });

  it('carries on to the next message after one is refused', async () => {
    const refused = await enqueue(tenantId, { to: 'nobody@example.test' });
    await enqueue(tenantId, { to: 'ada@example.test' });
    const sender: EmailSender = {
      send: (message) =>
        message.to === 'nobody@example.test'
          ? Promise.reject(new Error('no such mailbox'))
          : Promise.resolve(),
    };

    const outcome = await sendPending(
      { database: app, ownerDatabase: owner, resolveSender: resolveTo(sender) },
      NOW,
      OPTIONS,
    );

    expect(outcome).toEqual({ ran: true, sent: 1, failed: 1 });
    expect((await rowById(refused))?.lastError).toBe('no such mailbox');
  });

  // A pass that reports zeros for a database nobody has seeded reads as a
  // healthy pass. Run against a database of its own, because every other
  // test in this file has left a tenant behind in the shared one.
  it('says it enumerated nothing rather than reporting a clean pass', async () => {
    const name = `outbox_empty_${Date.now().toString(36)}`;
    await owner.sql.unsafe(`CREATE DATABASE ${name}`);

    const ownerUrl = new URL(container.adminUrl);
    ownerUrl.pathname = `/${name}`;
    const emptyOwner = createDatabase(ownerUrl.toString(), { max: 1 });
    const servingUrl = new URL(appUrl);
    servingUrl.pathname = `/${name}`;
    const emptyServing = createDatabase(servingUrl.toString(), { max: 1 });

    try {
      await runMigrations(emptyOwner.db, MIGRATIONS_DIR);
      const outcome = await sendPending(
        {
          database: emptyServing,
          ownerDatabase: emptyOwner,
          resolveSender: resolveTo(capturing()),
        },
        NOW,
        OPTIONS,
      );
      expect(outcome).toEqual({ ran: false, reason: 'no tenant was enumerated' });
    } finally {
      await emptyServing.close();
      await emptyOwner.close();
    }
  }, 120_000);

  it('refuses to run on a connection that cannot enumerate tenants', async () => {
    await expect(
      sendPending(
        { database: app, ownerDatabase: app, resolveSender: resolveTo(capturing()) },
        NOW,
        OPTIONS,
      ),
    ).rejects.toThrow(/bypasses row-level security/u);
  });

  it('refuses to claim on a connection that escapes the tenant policy', async () => {
    await expect(
      sendPending(
        { database: owner, ownerDatabase: owner, resolveSender: resolveTo(capturing()) },
        NOW,
        OPTIONS,
      ),
    ).rejects.toThrow(/must be subject to it/u);
  });
});
