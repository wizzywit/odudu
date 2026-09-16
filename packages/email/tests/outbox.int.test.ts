import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
} from '@odudu/db';
import { expectCrossRealmMethodProbe, expectRealmIsolation } from '@odudu/db/testing';
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

let realmId: string;

async function seedRealm(): Promise<string> {
  const id = newId();
  await owner.db.insert(realms).values({ id, name: `outbox-${id}` });
  return id;
}

async function enqueue(
  into: string = realmId,
  overrides: Partial<{ to: string; subject: string }> = {},
): Promise<string> {
  const { id } = await withRealm(app.db, into, (tx) =>
    outboxRepository(tx).enqueue(
      {
        realmId: into,
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

async function rowById(id: string, into: string = realmId) {
  const rows = await withRealm(app.db, into, (tx) =>
    tx.select().from(emailOutbox).where(eq(emailOutbox.id, id)),
  );
  return rows[0];
}

beforeEach(async () => {
  realmId = await seedRealm();
});

describe('the outbox repository', () => {
  it('hands a queued message out once, with its attempt already counted', async () => {
    const id = await enqueue();

    const claimed = await withRealm(app.db, realmId, (tx) =>
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
    const again = await withRealm(app.db, realmId, (tx) => outboxRepository(tx).claimBatch(CLAIM));
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
    await withRealm(app.db, realmId, async (tx) => {
      await outboxRepository(tx).markSent(sent, NOW);
      await outboxRepository(tx).markFailed(later, 'not yet', new Date(NOW.getTime() + MINUTE));
      await tx
        .update(emailOutbox)
        .set({ attempts: OPTIONS.maxAttempts })
        .where(eq(emailOutbox.id, spent));
    });

    const claimed = await withRealm(app.db, realmId, (tx) =>
      outboxRepository(tx).claimBatch(CLAIM),
    );

    expect(claimed).toEqual([]);
  });

  it('claims the oldest first, up to the limit', async () => {
    const first = await enqueue(realmId, { subject: 'first' });
    await enqueue(realmId, { subject: 'second' });
    await withRealm(app.db, realmId, (tx) =>
      tx
        .update(emailOutbox)
        .set({ nextAttemptAt: new Date(NOW.getTime() - 120 * MINUTE) })
        .where(eq(emailOutbox.id, first)),
    );

    const claimed = await withRealm(app.db, realmId, (tx) =>
      outboxRepository(tx).claimBatch({ ...CLAIM, limit: 1 }),
    );

    expect(claimed.map((message) => message.id)).toEqual([first]);
  });

  // What `FOR UPDATE SKIP LOCKED` buys over serialising senders behind one
  // lock: two of them meeting on the same queue take different messages and
  // both make progress, and neither sees the other's.
  it('never hands one message to two senders at once', async () => {
    const ids = [await enqueue(), await enqueue()];

    const claims = await withRealm(app.db, realmId, async (mine) => {
      const first = await outboxRepository(mine).claimBatch({ ...CLAIM, limit: 1 });
      // A second connection, while the first transaction still holds its
      // row: this is the concurrent sender.
      const second = await withRealm(app.db, realmId, (theirs) =>
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

    const first = await withRealm(app.db, realmId, (tx) => outboxRepository(tx).markSent(id, NOW));
    const second = await withRealm(app.db, realmId, (tx) =>
      outboxRepository(tx).markSent(id, new Date(NOW.getTime() + MINUTE)),
    );

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect((await rowById(id))?.sentAt).toEqual(NOW);
  });

  it('keeps a refused message, with the reason and the next attempt', async () => {
    const id = await enqueue();
    const retryAt = new Date(NOW.getTime() + 5 * MINUTE);

    await withRealm(app.db, realmId, (tx) =>
      outboxRepository(tx).markFailed(id, 'connection refused', retryAt),
    );

    const row = await rowById(id);
    expect(row?.sentAt).toBeNull();
    expect(row?.lastError).toBe('connection refused');
    expect(row?.nextAttemptAt).toEqual(retryAt);
  });

  it('scopes its rows to the realm that queued them', async () => {
    await expectRealmIsolation(app.db, {
      table: 'email_outbox',
      seed: async (tx, seededRealm) => {
        await owner.db.insert(realms).values({ id: seededRealm, name: `probe-${seededRealm}` });
        await outboxRepository(tx).enqueue({
          realmId: seededRealm,
          to: 'ada@example.test',
          subject: 'Probe',
          text: 't',
          html: '<p>t</p>',
        });
      },
    });
  });
});

describe('a foreign realm cannot reach a queued message', () => {
  it('refuses to queue a message for another realm', async () => {
    const foreignRealm = await seedRealm();

    // The policy declares no WITH CHECK, so its USING expression is what
    // refuses the insert: the row is not merely invisible afterwards, it
    // was never written.
    await expect(
      withRealm(app.db, realmId, (tx) =>
        outboxRepository(tx).enqueue({
          realmId: foreignRealm,
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
      .where(eq(emailOutbox.realmId, foreignRealm));
    expect(rows).toEqual([]);
  });

  it('claims nothing of another realm, and leaves its attempt count alone', async () => {
    const foreignRealm = await seedRealm();
    const id = await enqueue(foreignRealm);

    const claimed = await withRealm(app.db, realmId, (tx) =>
      outboxRepository(tx).claimBatch(CLAIM),
    );

    expect(claimed).toEqual([]);
    expect((await rowById(id, foreignRealm))?.attempts).toBe(0);
  });

  it('cannot mark another realm’s message sent', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, seededRealm) => {
        await owner.db.insert(realms).values({ id: seededRealm, name: `probe-${seededRealm}` });
        const { id } = await outboxRepository(tx).enqueue({
          realmId: seededRealm,
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
      verifyRealmAUnaffected: async (tx, id) => {
        const rows = await tx.select().from(emailOutbox).where(eq(emailOutbox.id, id));
        expect(rows[0]?.sentAt).toBeNull();
      },
    });
  });

  it('cannot record a failure against another realm’s message', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, seededRealm) => {
        await owner.db.insert(realms).values({ id: seededRealm, name: `probe-${seededRealm}` });
        const { id } = await outboxRepository(tx).enqueue({
          realmId: seededRealm,
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
      attempt: (tx, id) => outboxRepository(tx).markFailed(id, 'written from the wrong realm', NOW),
      expectBlocked: () => undefined,
      verifyRealmAUnaffected: async (tx, id) => {
        const rows = await tx.select().from(emailOutbox).where(eq(emailOutbox.id, id));
        expect(rows[0]?.lastError).toBeNull();
      },
    });
  });
});

describe('the sending pass', () => {
  // The pass visits every realm in the database, and the tests above have
  // left realms behind in this one: emptying the queue is what makes the
  // counts below exact rather than "at least".
  beforeEach(async () => {
    await owner.db.delete(emailOutbox);
  });

  it('sends what is queued and records the delivery', async () => {
    const id = await enqueue();
    const sender = capturing();

    const outcome = await sendPending(
      { database: app, ownerDatabase: owner, sender },
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

  it('visits every realm, not only the first', async () => {
    await enqueue();
    const second = await seedRealm();
    await enqueue(second);
    const sender = capturing();

    const outcome = await sendPending(
      { database: app, ownerDatabase: owner, sender },
      NOW,
      OPTIONS,
    );

    expect(outcome).toEqual({ ran: true, sent: 2, failed: 0 });
  });

  it('backs a refused message off and keeps the reason, without sending it again', async () => {
    const id = await enqueue();

    const first = await sendPending(
      { database: app, ownerDatabase: owner, sender: refusing() },
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
      { database: app, ownerDatabase: owner, sender },
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
        { database: app, ownerDatabase: owner, sender: refusing() },
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
    const after = await sendPending({ database: app, ownerDatabase: owner, sender }, at, OPTIONS);
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
        await withRealm(app.db, realmId, (tx) => outboxRepository(tx).markSent(id, NOW));
      },
    };

    const outcome = await sendPending(
      { database: app, ownerDatabase: owner, sender: racing },
      NOW,
      OPTIONS,
    );

    expect(outcome).toEqual({ ran: true, sent: 0, failed: 0 });
    expect((await rowById(id))?.sentAt).toEqual(NOW);
  });

  it('carries on to the next message after one is refused', async () => {
    const refused = await enqueue(realmId, { to: 'nobody@example.test' });
    await enqueue(realmId, { to: 'ada@example.test' });
    const sender: EmailSender = {
      send: (message) =>
        message.to === 'nobody@example.test'
          ? Promise.reject(new Error('no such mailbox'))
          : Promise.resolve(),
    };

    const outcome = await sendPending(
      { database: app, ownerDatabase: owner, sender },
      NOW,
      OPTIONS,
    );

    expect(outcome).toEqual({ ran: true, sent: 1, failed: 1 });
    expect((await rowById(refused))?.lastError).toBe('no such mailbox');
  });

  // A pass that reports zeros for a database nobody has seeded reads as a
  // healthy pass. Run against a database of its own, because every other
  // test in this file has left a realm behind in the shared one.
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
        { database: emptyServing, ownerDatabase: emptyOwner, sender: capturing() },
        NOW,
        OPTIONS,
      );
      expect(outcome).toEqual({ ran: false, reason: 'no realm was enumerated' });
    } finally {
      await emptyServing.close();
      await emptyOwner.close();
    }
  }, 120_000);

  it('refuses to run on a connection that cannot enumerate realms', async () => {
    await expect(
      sendPending({ database: app, ownerDatabase: app, sender: capturing() }, NOW, OPTIONS),
    ).rejects.toThrow(/bypasses row-level security/u);
  });

  it('refuses to claim on a connection that escapes the realm policy', async () => {
    await expect(
      sendPending({ database: owner, ownerDatabase: owner, sender: capturing() }, NOW, OPTIONS),
    ).rejects.toThrow(/must be subject to it/u);
  });
});
