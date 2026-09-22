import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
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

async function seedTenant(tx: TenantScopedDatabase, tenantId: string): Promise<void> {
  await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
}

async function seedSubject(tx: TenantScopedDatabase, tenantId: string): Promise<string> {
  await seedTenant(tx, tenantId);
  const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
  return subject.id;
}

describe('credentialRepository — widened credential types', () => {
  it('an existing password row survives with its PHC string exactly, and a login against it still works', async () => {
    const tenantId = newId();
    const plain = 'correct horse battery staple';
    const hash = await hashPassword(plain);

    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      const subject = await seedSubject(tx, tenantId);
      // The shape migration 0034 produces for a row that predates it:
      // {"hash": "<phc>"}, no "kind" field. Written directly, not through
      // insert(), to stand in for a row this migration converted rather
      // than one created after it.
      await tx.insert(userCredentials).values({
        id: newId(),
        tenantId,
        subjectId: subject,
        type: 'password',
        secretData: { hash },
      });
      return subject;
    });

    const stored = await withTenant(app.db, tenantId, (tx) =>
      credentialRepository(tx).passwordFor(subjectId),
    );

    expect(stored).toBe(hash);
    await expect(verifyPassword(stored ?? '', plain)).resolves.toBe(true);
  });

  it('inserts two passkeys for one subject', async () => {
    const tenantId = newId();
    const subjectId = await withTenant(app.db, tenantId, (tx) => seedSubject(tx, tenantId));

    await withTenant(app.db, tenantId, async (tx) => {
      await credentialRepository(tx).insert({
        tenantId,
        subjectId,
        type: 'webauthn',
        secret: { kind: 'webauthn', publicKey: 'pk-1', counter: 0, transports: ['internal'] },
        lookupKey: `cred-1-${tenantId}`,
      });
      await credentialRepository(tx).insert({
        tenantId,
        subjectId,
        type: 'webauthn',
        secret: { kind: 'webauthn', publicKey: 'pk-2', counter: 0, transports: ['usb'] },
        lookupKey: `cred-2-${tenantId}`,
      });
    });

    const passkeys = await withTenant(app.db, tenantId, (tx) =>
      credentialRepository(tx).listFor(subjectId, 'webauthn'),
    );
    expect(passkeys).toHaveLength(2);
  });

  it('refuses a second password credential for one subject', async () => {
    const tenantId = newId();
    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      const subject = await seedSubject(tx, tenantId);
      await credentialRepository(tx).insert({
        tenantId,
        subjectId: subject,
        type: 'password',
        secret: { kind: 'password', hash: await hashPassword('first') },
      });
      return subject;
    });

    await expect(
      withTenant(app.db, tenantId, async (tx) =>
        credentialRepository(tx).insert({
          tenantId,
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
    const tenantId = newId();
    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      const subject = await seedSubject(tx, tenantId);
      await credentialRepository(tx).insert({
        tenantId,
        subjectId: subject,
        type: 'totp',
        secret: { kind: 'totp', secret: 'JBSWY3DPEHPK3PXP', digits: 6, lastStep: 0 },
      });
      return subject;
    });

    await expect(
      withTenant(app.db, tenantId, async (tx) =>
        credentialRepository(tx).insert({
          tenantId,
          subjectId,
          type: 'totp',
          secret: { kind: 'totp', secret: 'ANOTHERSECRETKEY', digits: 6, lastStep: 0 },
        }),
      ),
    ).rejects.toMatchObject({
      cause: { code: '23505', constraint_name: 'user_credentials_one_totp' },
    });
  });

  it('refuses two passkeys with the same lookup_key in one tenant', async () => {
    const tenantId = newId();
    const lookupKey = `shared-cred-${newId()}`;

    await withTenant(app.db, tenantId, async (tx) => {
      const subject = await seedSubject(tx, tenantId);
      await credentialRepository(tx).insert({
        tenantId,
        subjectId: subject,
        type: 'webauthn',
        secret: { kind: 'webauthn', publicKey: 'pk-1', counter: 0, transports: ['internal'] },
        lookupKey,
      });
    });

    await expect(
      withTenant(app.db, tenantId, async (tx) => {
        const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
        await credentialRepository(tx).insert({
          tenantId,
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

  it('accepts the same lookup_key in two different tenants', async () => {
    const tenantA = newId();
    const tenantB = newId();
    const lookupKey = `cross-tenant-cred-${newId()}`;

    await withTenant(app.db, tenantA, async (tx) => {
      const subject = await seedSubject(tx, tenantA);
      await credentialRepository(tx).insert({
        tenantId: tenantA,
        subjectId: subject,
        type: 'webauthn',
        secret: { kind: 'webauthn', publicKey: 'pk-a', counter: 0, transports: ['internal'] },
        lookupKey,
      });
    });

    await expect(
      withTenant(app.db, tenantB, async (tx) => {
        const subject = await seedSubject(tx, tenantB);
        await credentialRepository(tx).insert({
          tenantId: tenantB,
          subjectId: subject,
          type: 'webauthn',
          secret: { kind: 'webauthn', publicKey: 'pk-b', counter: 0, transports: ['usb'] },
          lookupKey,
        });
      }),
    ).resolves.toBeUndefined();
  });

  it('finds no passkeys under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        const subject = await seedSubject(tx, tenantId);
        await credentialRepository(tx).insert({
          tenantId,
          subjectId: subject,
          type: 'webauthn',
          secret: { kind: 'webauthn', publicKey: 'pk', counter: 0, transports: ['internal'] },
          lookupKey: `probe-${tenantId}`,
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

  it('cannot resolve a lookup_key under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        const subject = await seedSubject(tx, tenantId);
        const lookupKey = `probe-lookup-${tenantId}`;
        await credentialRepository(tx).insert({
          tenantId,
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

  it('cannot mark a credential used under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        const subject = await seedSubject(tx, tenantId);
        const [row] = await tx
          .insert(userCredentials)
          .values({
            id: newId(),
            tenantId,
            subjectId: subject,
            type: 'webauthn',
            secretData: { publicKey: 'pk', counter: 0, transports: ['internal'] },
            lookupKey: `probe-mark-${tenantId}`,
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

  it('cannot delete a credential under a different tenant context', async () => {
    interface Seeded {
      id: string;
      lookupKey: string;
    }

    await expectCrossTenantMethodProbe<Seeded>(app.db, {
      seed: async (tx, tenantId) => {
        const subject = await seedSubject(tx, tenantId);
        const lookupKey = `probe-delete-${tenantId}`;
        const [row] = await tx
          .insert(userCredentials)
          .values({
            id: newId(),
            tenantId,
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
      verifyTenantAUnaffected: async (tx, seeded) => {
        const found = await credentialRepository(tx).byLookupKey(seeded.lookupKey);
        expect(found).not.toBeNull();
      },
    });
  });

  it('spends a time step on a totp credential without disturbing its secret', async () => {
    const tenantId = newId();
    const usedAt = new Date('2026-09-16T12:00:00.000Z');

    const { subjectId, credentialId } = await withTenant(app.db, tenantId, async (tx) => {
      const subject = await seedSubject(tx, tenantId);
      await credentialRepository(tx).insert({
        tenantId,
        subjectId: subject,
        type: 'totp',
        secret: { kind: 'totp', secret: 'JBSWY3DPEHPK3PXP', digits: 6, lastStep: 0 },
      });
      const [stored] = await credentialRepository(tx).listFor(subject, 'totp');
      if (stored === undefined) throw new Error('expected the seeded credential back');
      return { subjectId: subject, credentialId: stored.id };
    });

    const spent = await withTenant(app.db, tenantId, (tx) =>
      credentialRepository(tx).recordTotpUse(credentialId, 58_612_800, usedAt),
    );
    expect(spent).toBe(true);

    const [after] = await withTenant(app.db, tenantId, (tx) =>
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

  it('cannot spend a time step under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        const subject = await seedSubject(tx, tenantId);
        await credentialRepository(tx).insert({
          tenantId,
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
      verifyTenantAUnaffected: async (tx, seeded) => {
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
    const tenantId = newId();
    const { credentialId } = await withTenant(app.db, tenantId, async (tx) => {
      const subject = await seedSubject(tx, tenantId);
      await credentialRepository(tx).insert({
        tenantId,
        subjectId: subject,
        type: 'totp',
        secret: { kind: 'totp', secret: 'JBSWY3DPEHPK3PXP', digits: 6, lastStep: 0 },
      });
      const [stored] = await credentialRepository(tx).listFor(subject, 'totp');
      if (stored === undefined) throw new Error('expected the seeded credential back');
      return { credentialId: stored.id };
    });

    const spend = () =>
      withTenant(app.db, tenantId, (tx) =>
        credentialRepository(tx).recordTotpUse(credentialId, 58_612_801, new Date()),
      );
    const [first, second] = await Promise.all([spend(), spend()]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
  });

  it('refuses a step it has already spent', async () => {
    const tenantId = newId();
    const credentialId = await withTenant(app.db, tenantId, async (tx) => {
      const subject = await seedSubject(tx, tenantId);
      await credentialRepository(tx).insert({
        tenantId,
        subjectId: subject,
        type: 'totp',
        secret: { kind: 'totp', secret: 'JBSWY3DPEHPK3PXP', digits: 6, lastStep: 58_612_802 },
      });
      const [stored] = await credentialRepository(tx).listFor(subject, 'totp');
      if (stored === undefined) throw new Error('expected the seeded credential back');
      return stored.id;
    });

    const again = await withTenant(app.db, tenantId, (tx) =>
      credentialRepository(tx).recordTotpUse(credentialId, 58_612_802, new Date()),
    );

    expect(again).toBe(false);
  });

  async function seedPasskey(
    tx: TenantScopedDatabase,
    tenantId: string,
    counter: number,
  ): Promise<{ subjectId: string; id: string; lookupKey: string }> {
    const subject = await seedSubject(tx, tenantId);
    const lookupKey = `credential-${newId()}`;
    await credentialRepository(tx).insert({
      tenantId,
      subjectId: subject,
      type: 'webauthn',
      lookupKey,
      secret: { kind: 'webauthn', publicKey: 'cG9zc2libHk', counter, transports: ['internal'] },
    });
    const [stored] = await credentialRepository(tx).listFor(subject, 'webauthn');
    if (stored === undefined) throw new Error('expected the seeded credential back');
    return { subjectId: subject, id: stored.id, lookupKey };
  }

  function counterOf(tenantId: string, subjectId: string): Promise<number | undefined> {
    return withTenant(app.db, tenantId, async (tx) => {
      const [found] = await credentialRepository(tx).listFor(subjectId, 'webauthn');
      return found?.secret.kind === 'webauthn' ? found.secret.counter : undefined;
    });
  }

  it('advances a webauthn counter, leaving the public key alone', async () => {
    const tenantId = newId();
    const usedAt = new Date('2026-09-16T12:00:00.000Z');
    const seeded = await withTenant(app.db, tenantId, (tx) => seedPasskey(tx, tenantId, 3));

    const advanced = await withTenant(app.db, tenantId, (tx) =>
      credentialRepository(tx).advanceWebauthnCounter(seeded.id, 4, usedAt),
    );

    expect(advanced).toBe(true);
    const [after] = await withTenant(app.db, tenantId, (tx) =>
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
    const tenantId = newId();
    const seeded = await withTenant(app.db, tenantId, (tx) => seedPasskey(tx, tenantId, 5));

    const same = await withTenant(app.db, tenantId, (tx) =>
      credentialRepository(tx).advanceWebauthnCounter(seeded.id, 5, new Date()),
    );
    const backwards = await withTenant(app.db, tenantId, (tx) =>
      credentialRepository(tx).advanceWebauthnCounter(seeded.id, 4, new Date()),
    );

    expect([same, backwards]).toEqual([false, false]);
    expect(await counterOf(tenantId, seeded.subjectId)).toBe(5);
  });

  // The exception §6.1.1 allows: an authenticator that never counts reports
  // zero forever, and refusing it refuses a conformant device.
  it('accepts zero from a credential whose counter is already zero', async () => {
    const tenantId = newId();
    const seeded = await withTenant(app.db, tenantId, (tx) => seedPasskey(tx, tenantId, 0));

    const advanced = await withTenant(app.db, tenantId, (tx) =>
      credentialRepository(tx).advanceWebauthnCounter(seeded.id, 0, new Date()),
    );

    expect(advanced).toBe(true);
    expect(await counterOf(tenantId, seeded.subjectId)).toBe(0);
  });

  it('advances a webauthn counter exactly once when two assertions race for it', async () => {
    const tenantId = newId();
    const seeded = await withTenant(app.db, tenantId, (tx) => seedPasskey(tx, tenantId, 1));

    const advance = () =>
      withTenant(app.db, tenantId, (tx) =>
        credentialRepository(tx).advanceWebauthnCounter(seeded.id, 2, new Date()),
      );
    const [first, second] = await Promise.all([advance(), advance()]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
  });

  it('cannot advance a webauthn counter under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => seedPasskey(tx, tenantId, 2),
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
      verifyTenantAUnaffected: async (tx, seeded) => {
        const [found] = await credentialRepository(tx).listFor(seeded.subjectId, 'webauthn');
        expect(found?.secret).toMatchObject({ counter: 2 });
      },
    });
  });

  it('refuses to insert a credential whose declared tenant does not match the transaction tenant', async () => {
    const tenantA = newId();
    const tenantB = newId();

    const subjectId = await withTenant(app.db, tenantA, (tx) => seedSubject(tx, tenantA));

    await expect(
      withTenant(app.db, tenantB, async (tx) => {
        await seedTenant(tx, tenantB);
        await credentialRepository(tx).insert({
          tenantId: tenantA,
          subjectId,
          type: 'webauthn',
          secret: { kind: 'webauthn', publicKey: 'pk', counter: 0, transports: ['internal'] },
          lookupKey: `mismatched-tenant-${tenantA}`,
        });
      }),
    ).rejects.toThrow();
  });
});
