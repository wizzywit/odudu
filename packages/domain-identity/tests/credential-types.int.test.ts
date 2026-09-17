import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import { expectCrossRealmMethodProbe } from '@odudu/db/testing';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { credentialRepository } from '#/repository/credentials';
import { subjectRepository } from '#/repository/subjects';
import { userCredentials } from '#/schema/user-credentials';
import { hashPassword, verifyPassword } from '#/service/password';

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

async function seedRealm(tx: RealmScopedDatabase, realmId: string): Promise<void> {
  await tx.insert(realms).values({ id: realmId, name: `realm-${realmId}` });
}

async function seedSubject(tx: RealmScopedDatabase, realmId: string): Promise<string> {
  await seedRealm(tx, realmId);
  const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
  return subject.id;
}

describe('credentialRepository — widened credential types', () => {
  it('an existing password row survives with its PHC string exactly, and a login against it still works', async () => {
    const realmId = newId();
    const plain = 'correct horse battery staple';
    const hash = await hashPassword(plain);

    const subjectId = await withRealm(app.db, realmId, async (tx) => {
      const subject = await seedSubject(tx, realmId);
      // The shape migration 0034 produces for a row that predates it:
      // {"hash": "<phc>"}, no "kind" field. Written directly, not through
      // insert(), to stand in for a row this migration converted rather
      // than one created after it.
      await tx.insert(userCredentials).values({
        id: newId(),
        realmId,
        subjectId: subject,
        type: 'password',
        secretData: { hash },
      });
      return subject;
    });

    const stored = await withRealm(app.db, realmId, (tx) =>
      credentialRepository(tx).passwordFor(subjectId),
    );

    expect(stored).toBe(hash);
    await expect(verifyPassword(stored ?? '', plain)).resolves.toBe(true);
  });

  it('inserts two passkeys for one subject', async () => {
    const realmId = newId();
    const subjectId = await withRealm(app.db, realmId, (tx) => seedSubject(tx, realmId));

    await withRealm(app.db, realmId, async (tx) => {
      await credentialRepository(tx).insert({
        realmId,
        subjectId,
        type: 'webauthn',
        secret: { kind: 'webauthn', publicKey: 'pk-1', counter: 0, transports: ['internal'] },
        lookupKey: `cred-1-${realmId}`,
      });
      await credentialRepository(tx).insert({
        realmId,
        subjectId,
        type: 'webauthn',
        secret: { kind: 'webauthn', publicKey: 'pk-2', counter: 0, transports: ['usb'] },
        lookupKey: `cred-2-${realmId}`,
      });
    });

    const passkeys = await withRealm(app.db, realmId, (tx) =>
      credentialRepository(tx).listFor(subjectId, 'webauthn'),
    );
    expect(passkeys).toHaveLength(2);
  });

  it('refuses a second password credential for one subject', async () => {
    const realmId = newId();
    const subjectId = await withRealm(app.db, realmId, async (tx) => {
      const subject = await seedSubject(tx, realmId);
      await credentialRepository(tx).insert({
        realmId,
        subjectId: subject,
        type: 'password',
        secret: { kind: 'password', hash: await hashPassword('first') },
      });
      return subject;
    });

    await expect(
      withRealm(app.db, realmId, async (tx) =>
        credentialRepository(tx).insert({
          realmId,
          subjectId,
          type: 'password',
          secret: { kind: 'password', hash: await hashPassword('second') },
        }),
      ),
    ).rejects.toMatchObject({
      cause: { code: '23505', constraint_name: 'user_credentials_one_password' },
    });
  });

  it('refuses a second totp credential for one subject', async () => {
    const realmId = newId();
    const subjectId = await withRealm(app.db, realmId, async (tx) => {
      const subject = await seedSubject(tx, realmId);
      await credentialRepository(tx).insert({
        realmId,
        subjectId: subject,
        type: 'totp',
        secret: { kind: 'totp', secret: 'JBSWY3DPEHPK3PXP', digits: 6, lastStep: 0 },
      });
      return subject;
    });

    await expect(
      withRealm(app.db, realmId, async (tx) =>
        credentialRepository(tx).insert({
          realmId,
          subjectId,
          type: 'totp',
          secret: { kind: 'totp', secret: 'ANOTHERSECRETKEY', digits: 6, lastStep: 0 },
        }),
      ),
    ).rejects.toMatchObject({
      cause: { code: '23505', constraint_name: 'user_credentials_one_totp' },
    });
  });

  it('refuses two passkeys with the same lookup_key in one realm', async () => {
    const realmId = newId();
    const lookupKey = `shared-cred-${newId()}`;

    await withRealm(app.db, realmId, async (tx) => {
      const subject = await seedSubject(tx, realmId);
      await credentialRepository(tx).insert({
        realmId,
        subjectId: subject,
        type: 'webauthn',
        secret: { kind: 'webauthn', publicKey: 'pk-1', counter: 0, transports: ['internal'] },
        lookupKey,
      });
    });

    await expect(
      withRealm(app.db, realmId, async (tx) => {
        const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
        await credentialRepository(tx).insert({
          realmId,
          subjectId: subject.id,
          type: 'webauthn',
          secret: { kind: 'webauthn', publicKey: 'pk-2', counter: 0, transports: ['usb'] },
          lookupKey,
        });
      }),
    ).rejects.toMatchObject({
      cause: { code: '23505', constraint_name: 'user_credentials_lookup_key' },
    });
  });

  it('accepts the same lookup_key in two different realms', async () => {
    const realmA = newId();
    const realmB = newId();
    const lookupKey = `cross-realm-cred-${newId()}`;

    await withRealm(app.db, realmA, async (tx) => {
      const subject = await seedSubject(tx, realmA);
      await credentialRepository(tx).insert({
        realmId: realmA,
        subjectId: subject,
        type: 'webauthn',
        secret: { kind: 'webauthn', publicKey: 'pk-a', counter: 0, transports: ['internal'] },
        lookupKey,
      });
    });

    await expect(
      withRealm(app.db, realmB, async (tx) => {
        const subject = await seedSubject(tx, realmB);
        await credentialRepository(tx).insert({
          realmId: realmB,
          subjectId: subject,
          type: 'webauthn',
          secret: { kind: 'webauthn', publicKey: 'pk-b', counter: 0, transports: ['usb'] },
          lookupKey,
        });
      }),
    ).resolves.toBeUndefined();
  });

  it('finds no passkeys under a different realm context', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        const subject = await seedSubject(tx, realmId);
        await credentialRepository(tx).insert({
          realmId,
          subjectId: subject,
          type: 'webauthn',
          secret: { kind: 'webauthn', publicKey: 'pk', counter: 0, transports: ['internal'] },
          lookupKey: `probe-${realmId}`,
        });
        return subject;
      },
      verifySeeded: async (tx, subjectId) => {
        const found = await credentialRepository(tx).listFor(subjectId, 'webauthn');
        expect(found).toHaveLength(1);
      },
      attempt: async (tx, subjectId) => credentialRepository(tx).listFor(subjectId, 'webauthn'),
      expectBlocked: (result) => {
        expect(result).toEqual([]);
      },
    });
  });

  it('cannot resolve a lookup_key under a different realm context', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        const subject = await seedSubject(tx, realmId);
        const lookupKey = `probe-lookup-${realmId}`;
        await credentialRepository(tx).insert({
          realmId,
          subjectId: subject,
          type: 'webauthn',
          secret: { kind: 'webauthn', publicKey: 'pk', counter: 0, transports: ['internal'] },
          lookupKey,
        });
        return lookupKey;
      },
      verifySeeded: async (tx, lookupKey) => {
        const found = await credentialRepository(tx).byLookupKey(lookupKey);
        expect(found).not.toBeNull();
      },
      attempt: async (tx, lookupKey) => credentialRepository(tx).byLookupKey(lookupKey),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
  });

  it('cannot mark a credential used under a different realm context', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        const subject = await seedSubject(tx, realmId);
        const [row] = await tx
          .insert(userCredentials)
          .values({
            id: newId(),
            realmId,
            subjectId: subject,
            type: 'webauthn',
            secretData: { publicKey: 'pk', counter: 0, transports: ['internal'] },
            lookupKey: `probe-mark-${realmId}`,
          })
          .returning();
        if (row === undefined) throw new Error('expected the seeded row back');
        return row.id;
      },
      verifySeeded: async (tx, id) => {
        await credentialRepository(tx).markUsed(id, new Date());
      },
      attempt: async (tx, id) => {
        try {
          await credentialRepository(tx).markUsed(id, new Date());
          return 'succeeded';
        } catch {
          return 'blocked';
        }
      },
      expectBlocked: (result) => {
        expect(result).toBe('blocked');
      },
    });
  });

  it('cannot delete a credential under a different realm context', async () => {
    interface Seeded {
      id: string;
      lookupKey: string;
    }

    await expectCrossRealmMethodProbe<Seeded>(app.db, {
      seed: async (tx, realmId) => {
        const subject = await seedSubject(tx, realmId);
        const lookupKey = `probe-delete-${realmId}`;
        const [row] = await tx
          .insert(userCredentials)
          .values({
            id: newId(),
            realmId,
            subjectId: subject,
            type: 'webauthn',
            secretData: { publicKey: 'pk', counter: 0, transports: ['internal'] },
            lookupKey,
          })
          .returning();
        if (row === undefined) throw new Error('expected the seeded row back');
        return { id: row.id, lookupKey };
      },
      verifySeeded: async (tx, seeded) => {
        const found = await credentialRepository(tx).byLookupKey(seeded.lookupKey);
        expect(found).not.toBeNull();
      },
      attempt: async (tx, seeded) => {
        try {
          await credentialRepository(tx).deleteOne(seeded.id);
          return 'succeeded';
        } catch {
          return 'blocked';
        }
      },
      expectBlocked: (result) => {
        expect(result).toBe('blocked');
      },
      verifyRealmAUnaffected: async (tx, seeded) => {
        const found = await credentialRepository(tx).byLookupKey(seeded.lookupKey);
        expect(found).not.toBeNull();
      },
    });
  });

  it('spends a time step on a totp credential without disturbing its secret', async () => {
    const realmId = newId();
    const usedAt = new Date('2026-09-16T12:00:00.000Z');

    const { subjectId, credentialId } = await withRealm(app.db, realmId, async (tx) => {
      const subject = await seedSubject(tx, realmId);
      await credentialRepository(tx).insert({
        realmId,
        subjectId: subject,
        type: 'totp',
        secret: { kind: 'totp', secret: 'JBSWY3DPEHPK3PXP', digits: 6, lastStep: 0 },
      });
      const [stored] = await credentialRepository(tx).listFor(subject, 'totp');
      if (stored === undefined) throw new Error('expected the seeded credential back');
      return { subjectId: subject, credentialId: stored.id };
    });

    const spent = await withRealm(app.db, realmId, (tx) =>
      credentialRepository(tx).recordTotpUse(credentialId, 58_612_800, usedAt),
    );
    expect(spent).toBe(true);

    const [after] = await withRealm(app.db, realmId, (tx) =>
      credentialRepository(tx).listFor(subjectId, 'totp'),
    );
    expect(after?.secret).toEqual({
      kind: 'totp',
      secret: 'JBSWY3DPEHPK3PXP',
      digits: 6,
      lastStep: 58_612_800,
    });
    expect(after?.lastUsedAt).toEqual(usedAt);
  });

  it('cannot spend a time step under a different realm context', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        const subject = await seedSubject(tx, realmId);
        await credentialRepository(tx).insert({
          realmId,
          subjectId: subject,
          type: 'totp',
          secret: { kind: 'totp', secret: 'JBSWY3DPEHPK3PXP', digits: 6, lastStep: 7 },
        });
        const [stored] = await credentialRepository(tx).listFor(subject, 'totp');
        if (stored === undefined) throw new Error('expected the seeded credential back');
        return { subjectId: subject, id: stored.id };
      },
      verifySeeded: async (tx, seeded) => {
        const [found] = await credentialRepository(tx).listFor(seeded.subjectId, 'totp');
        expect(found?.secret).toMatchObject({ lastStep: 7 });
      },
      attempt: async (tx, seeded) =>
        credentialRepository(tx).recordTotpUse(seeded.id, 99, new Date()),
      expectBlocked: (result) => {
        // RLS filters the row out of the UPDATE's own WHERE, so nothing is
        // updated and the call reports the step as unspent.
        expect(result).toBe(false);
      },
      verifyRealmAUnaffected: async (tx, seeded) => {
        const [found] = await credentialRepository(tx).listFor(seeded.subjectId, 'totp');
        expect(found?.secret).toMatchObject({ lastStep: 7 });
      },
    });
  });

  // RFC 6238 §5.2: a code that already validated must not validate again.
  // The predicate on the stored step is what makes the write the decision
  // rather than a record of one — two transactions that both accepted the
  // same code serialize on the row, and only the first finds a lastStep
  // below the step it is spending.
  it('spends a time step exactly once when two transactions race for it', async () => {
    const realmId = newId();
    const { credentialId } = await withRealm(app.db, realmId, async (tx) => {
      const subject = await seedSubject(tx, realmId);
      await credentialRepository(tx).insert({
        realmId,
        subjectId: subject,
        type: 'totp',
        secret: { kind: 'totp', secret: 'JBSWY3DPEHPK3PXP', digits: 6, lastStep: 0 },
      });
      const [stored] = await credentialRepository(tx).listFor(subject, 'totp');
      if (stored === undefined) throw new Error('expected the seeded credential back');
      return { credentialId: stored.id };
    });

    const spend = () =>
      withRealm(app.db, realmId, (tx) =>
        credentialRepository(tx).recordTotpUse(credentialId, 58_612_801, new Date()),
      );
    const [first, second] = await Promise.all([spend(), spend()]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
  });

  it('refuses a step it has already spent', async () => {
    const realmId = newId();
    const credentialId = await withRealm(app.db, realmId, async (tx) => {
      const subject = await seedSubject(tx, realmId);
      await credentialRepository(tx).insert({
        realmId,
        subjectId: subject,
        type: 'totp',
        secret: { kind: 'totp', secret: 'JBSWY3DPEHPK3PXP', digits: 6, lastStep: 58_612_802 },
      });
      const [stored] = await credentialRepository(tx).listFor(subject, 'totp');
      if (stored === undefined) throw new Error('expected the seeded credential back');
      return stored.id;
    });

    const again = await withRealm(app.db, realmId, (tx) =>
      credentialRepository(tx).recordTotpUse(credentialId, 58_612_802, new Date()),
    );

    expect(again).toBe(false);
  });

  async function seedPasskey(
    tx: RealmScopedDatabase,
    realmId: string,
    counter: number,
  ): Promise<{ subjectId: string; id: string; lookupKey: string }> {
    const subject = await seedSubject(tx, realmId);
    const lookupKey = `credential-${newId()}`;
    await credentialRepository(tx).insert({
      realmId,
      subjectId: subject,
      type: 'webauthn',
      lookupKey,
      secret: { kind: 'webauthn', publicKey: 'cG9zc2libHk', counter, transports: ['internal'] },
    });
    const [stored] = await credentialRepository(tx).listFor(subject, 'webauthn');
    if (stored === undefined) throw new Error('expected the seeded credential back');
    return { subjectId: subject, id: stored.id, lookupKey };
  }

  function counterOf(realmId: string, subjectId: string): Promise<number | undefined> {
    return withRealm(app.db, realmId, async (tx) => {
      const [found] = await credentialRepository(tx).listFor(subjectId, 'webauthn');
      return found?.secret.kind === 'webauthn' ? found.secret.counter : undefined;
    });
  }

  it('advances a webauthn counter, leaving the public key alone', async () => {
    const realmId = newId();
    const usedAt = new Date('2026-09-16T12:00:00.000Z');
    const seeded = await withRealm(app.db, realmId, (tx) => seedPasskey(tx, realmId, 3));

    const advanced = await withRealm(app.db, realmId, (tx) =>
      credentialRepository(tx).advanceWebauthnCounter(seeded.id, 4, usedAt),
    );

    expect(advanced).toBe(true);
    const [after] = await withRealm(app.db, realmId, (tx) =>
      credentialRepository(tx).listFor(seeded.subjectId, 'webauthn'),
    );
    expect(after?.secret).toEqual({
      kind: 'webauthn',
      publicKey: 'cG9zc2libHk',
      counter: 4,
      transports: ['internal'],
    });
    expect(after?.lastUsedAt).toEqual(usedAt);
  });

  // WebAuthn §6.1.1: a counter that did not move means two authenticators
  // are answering for one credential.
  it('refuses a counter that did not increase', async () => {
    const realmId = newId();
    const seeded = await withRealm(app.db, realmId, (tx) => seedPasskey(tx, realmId, 5));

    const same = await withRealm(app.db, realmId, (tx) =>
      credentialRepository(tx).advanceWebauthnCounter(seeded.id, 5, new Date()),
    );
    const backwards = await withRealm(app.db, realmId, (tx) =>
      credentialRepository(tx).advanceWebauthnCounter(seeded.id, 4, new Date()),
    );

    expect([same, backwards]).toEqual([false, false]);
    expect(await counterOf(realmId, seeded.subjectId)).toBe(5);
  });

  // The exception §6.1.1 allows: an authenticator that never counts reports
  // zero forever, and refusing it refuses a conformant device.
  it('accepts zero from a credential whose counter is already zero', async () => {
    const realmId = newId();
    const seeded = await withRealm(app.db, realmId, (tx) => seedPasskey(tx, realmId, 0));

    const advanced = await withRealm(app.db, realmId, (tx) =>
      credentialRepository(tx).advanceWebauthnCounter(seeded.id, 0, new Date()),
    );

    expect(advanced).toBe(true);
    expect(await counterOf(realmId, seeded.subjectId)).toBe(0);
  });

  it('advances a webauthn counter exactly once when two assertions race for it', async () => {
    const realmId = newId();
    const seeded = await withRealm(app.db, realmId, (tx) => seedPasskey(tx, realmId, 1));

    const advance = () =>
      withRealm(app.db, realmId, (tx) =>
        credentialRepository(tx).advanceWebauthnCounter(seeded.id, 2, new Date()),
      );
    const [first, second] = await Promise.all([advance(), advance()]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
  });

  it('cannot advance a webauthn counter under a different realm context', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => seedPasskey(tx, realmId, 2),
      verifySeeded: async (tx, seeded) => {
        const [found] = await credentialRepository(tx).listFor(seeded.subjectId, 'webauthn');
        expect(found?.secret).toMatchObject({ counter: 2 });
      },
      attempt: async (tx, seeded) =>
        credentialRepository(tx).advanceWebauthnCounter(seeded.id, 99, new Date()),
      expectBlocked: (result) => {
        // RLS filters the row out of the UPDATE's own WHERE, so nothing is
        // updated and the call reports the counter as unadvanced.
        expect(result).toBe(false);
      },
      verifyRealmAUnaffected: async (tx, seeded) => {
        const [found] = await credentialRepository(tx).listFor(seeded.subjectId, 'webauthn');
        expect(found?.secret).toMatchObject({ counter: 2 });
      },
    });
  });

  it('refuses to insert a credential whose declared realm does not match the transaction realm', async () => {
    const realmA = newId();
    const realmB = newId();

    const subjectId = await withRealm(app.db, realmA, (tx) => seedSubject(tx, realmA));

    await expect(
      withRealm(app.db, realmB, async (tx) => {
        await seedRealm(tx, realmB);
        await credentialRepository(tx).insert({
          realmId: realmA,
          subjectId,
          type: 'webauthn',
          secret: { kind: 'webauthn', publicKey: 'pk', counter: 0, transports: ['internal'] },
          lookupKey: `mismatched-realm-${realmA}`,
        });
      }),
    ).rejects.toThrow();
  });
});
