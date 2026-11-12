import { randomUUID } from 'node:crypto';
import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountReconcileRepository } from '#/repository/account-reconcile';
import { reconcileDuplicateAccounts } from '#/usecase/reconcile-accounts';

// The statement the later release's migration carries, built here against
// the real schema so that what the operating notes say is what runs.
const UNIQUE_INDEX =
  'CREATE UNIQUE INDEX users_email_search_unique ON users (tenant_id, email_search) WHERE email_search IS NOT NULL';

let container: TestDatabase | undefined;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl, { max: 4 });
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), { max: 4 });
}, 180_000);

afterAll(async () => {
  await app.close();
  await owner.close();
  await container?.stop();
});

const NOW = new Date('2026-11-12T10:00:00Z');

async function tenant(): Promise<string> {
  const id = randomUUID();
  await owner.sql`insert into tenants (id, name) values (${id}, ${'rec-' + id.slice(0, 8)})`;
  return id;
}

interface UserSeed {
  readonly email: string | null;
  readonly verified?: boolean;
  readonly createdAt?: string;
}

async function user(tenantId: string, seed: UserSeed): Promise<string> {
  const id = randomUUID();
  await owner.sql`
    insert into subjects (id, tenant_id, type, created_at)
    values (${id}, ${tenantId}, 'user', ${seed.createdAt ?? '2026-01-01T00:00:00Z'})`;
  await owner.sql`
    insert into users (subject_id, tenant_id, username, email, email_verified)
    values (${id}, ${tenantId}, ${'u-' + id}, ${seed.email}, ${seed.verified ?? false})`;
  return id;
}

async function credential(
  tenantId: string,
  subjectId: string,
  type: string,
  used = false,
): Promise<string> {
  const id = randomUUID();
  const secret =
    type === 'password'
      ? { hash: 'h' }
      : type === 'webauthn'
        ? { publicKey: 'k', counter: 0, transports: [] }
        : { secret: 's', digits: 6, lastStep: 0 };
  await owner.sql`
    insert into user_credentials (id, tenant_id, subject_id, type, secret_data, last_used_at, lookup_key)
    values (${id}, ${tenantId}, ${subjectId}, ${type}, ${JSON.stringify(secret)}::jsonb,
            ${used ? NOW.toISOString() : null}, ${type === 'webauthn' ? id : null})`;
  return id;
}

async function session(tenantId: string, subjectId: string): Promise<string> {
  const id = randomUUID();
  await owner.sql`
    insert into sessions (id, tenant_id, subject_id, expires_at)
    values (${id}, ${tenantId}, ${subjectId}, '2027-01-01T00:00:00Z')`;
  return id;
}

async function client(tenantId: string): Promise<string> {
  const id = randomUUID();
  await owner.sql`
    insert into clients (id, tenant_id, client_id, name, type)
    values (${id}, ${tenantId}, ${'c-' + id}, 'app', 'public')`;
  return id;
}

async function grant(tenantId: string, subjectId: string, clientId: string): Promise<string> {
  const id = randomUUID();
  await owner.sql`
    insert into token_grants (id, tenant_id, client_id, subject_id, scope)
    values (${id}, ${tenantId}, ${clientId}, ${subjectId}, 'openid')`;
  return id;
}

async function consent(tenantId: string, subjectId: string, clientId: string): Promise<void> {
  await owner.sql`
    insert into consents (id, tenant_id, subject_id, client_id)
    values (${randomUUID()}, ${tenantId}, ${subjectId}, ${clientId})`;
}

async function audit(tenantId: string, subjectId: string): Promise<void> {
  await owner.sql`
    insert into audit_events (id, tenant_id, event_type, action, outcome, resource_type, resource_id)
    values (${randomUUID()}, ${tenantId}, 'admin_mutation', 'subject.create', 'allowed',
            'subject', ${subjectId})`;
}

async function owned(table: string, subjectId: string): Promise<string[]> {
  const rows = await owner.sql<{ id: string }[]>`
    select id::text from ${owner.sql(table)} where subject_id = ${subjectId} order by id`;
  return rows.map((row) => row.id);
}

async function state(subjectId: string) {
  const [row] = await owner.sql<
    { email: string | null; verified: boolean; disabled: boolean }[]
  >`select u.email, u.email_verified as verified, s.disabled_at is not null as disabled
      from users u join subjects s on s.id = u.subject_id where u.subject_id = ${subjectId}`;
  if (row === undefined) throw new Error('no such subject');
  return row;
}

async function auditRows(tenantId: string): Promise<string> {
  const rows = await owner.sql`
    select * from audit_events where tenant_id = ${tenantId} and action <> 'subject.reconcile'
     order by id`;
  return JSON.stringify(rows);
}

function run(tenantIds: readonly string[], options: { dryRun?: boolean; chunk?: number } = {}) {
  return reconcileDuplicateAccounts(app.db, tenantIds, NOW, {
    dryRun: options.dryRun ?? false,
    ...(options.chunk === undefined ? {} : { chunkGroups: options.chunk }),
  });
}

describe('reconciling accounts that hold one address', () => {
  it('moves what the person set up to the account that stays, and leaves the audit trail alone', async () => {
    const t = await tenant();
    const stays = await user(t, { email: 'Ada@Example.test', createdAt: '2026-01-01T00:00:00Z' });
    const goes = await user(t, { email: 'ada@example.test', createdAt: '2026-02-01T00:00:00Z' });
    const c1 = await client(t);
    const c2 = await client(t);
    const password = await credential(t, goes, 'password', true);
    const passkey = await credential(t, goes, 'webauthn');
    const live = await session(t, goes);
    const granted = await grant(t, goes, c1);
    await consent(t, goes, c1);
    await consent(t, goes, c2);
    await consent(t, stays, c1);
    await audit(t, goes);
    await audit(t, stays);
    const before = await auditRows(t);

    const report = await run([t]);

    expect(report).toMatchObject({
      groups: 1,
      merged: 1,
      accounts_retired: 1,
      refused: 0,
      failed: 0,
      moved: { credentials: 2, sessions: 1, grants: 1, consents: 1 },
    });
    expect(await owned('user_credentials', stays)).toEqual([password, passkey].sort());
    expect(await owned('user_credentials', goes)).toEqual([]);
    expect(await owned('sessions', stays)).toEqual([live]);
    expect(await owned('token_grants', stays)).toEqual([granted]);
    expect(await owned('token_grants', goes)).toEqual([]);
    const [kept] = await owner.sql<{ n: number }[]>`
      select count(*)::int n from consents where subject_id = ${stays}`;
    expect(kept?.n).toBe(2);
    expect(await state(goes)).toEqual({ email: null, verified: false, disabled: true });
    expect((await state(stays)).disabled).toBe(false);
    expect(await auditRows(t)).toBe(before);
    const [row] = await owner.sql<{ n: number; detail: Record<string, unknown> }[]>`
      select count(*) over ()::int n, detail from audit_events
       where tenant_id = ${t} and action = 'subject.reconcile' and resource_id = ${goes}`;
    expect(row?.n).toBe(1);
    expect(row?.detail).toMatchObject({ survivor: stays });
  });

  it('keeps the survivor’s own password, second factor and codes, and moves a passkey', async () => {
    const t = await tenant();
    const stays = await user(t, { email: 'a@x.test' });
    const goes = await user(t, { email: 'A@x.test', createdAt: '2026-03-01T00:00:00Z' });
    const mine = await credential(t, stays, 'password');
    const theirs = await credential(t, goes, 'password');
    const key = await credential(t, goes, 'webauthn');
    await run([t]);
    expect(await owned('user_credentials', stays)).toEqual([mine, key].sort());
    expect(await owned('user_credentials', goes)).toEqual([theirs]);
  });

  it('prefers the verified address, and carries nothing over from the unverified one', async () => {
    const t = await tenant();
    const older = await user(t, { email: 'b@x.test', createdAt: '2026-01-01T00:00:00Z' });
    const verified = await user(t, {
      email: 'B@x.test',
      verified: true,
      createdAt: '2026-05-01T00:00:00Z',
    });
    const password = await credential(t, older, 'password');
    await run([t]);
    expect((await state(older)).disabled).toBe(true);
    expect((await state(verified)).disabled).toBe(false);
    expect(await owned('user_credentials', older)).toEqual([password]);
    expect(await owned('user_credentials', verified)).toEqual([]);
  });

  it('refuses a pair where both have signed in, and changes nothing', async () => {
    const t = await tenant();
    const a = await user(t, { email: 'c@x.test' });
    const b = await user(t, { email: 'C@x.test', createdAt: '2026-02-01T00:00:00Z' });
    await session(t, a);
    await credential(t, b, 'password', true);
    const report = await run([t]);
    expect(report).toMatchObject({ groups: 1, merged: 0, refused: 1, accounts_retired: 0 });
    expect(report.refusals).toEqual([
      { tenant_id: t, reason: 'several_have_sign_ins', subject_ids: [a, b].sort() },
    ]);
    expect((await state(a)).disabled).toBe(false);
    expect((await state(b)).disabled).toBe(false);
    expect((await state(b)).email).toBe('C@x.test');
  });

  it('refuses when the unverified account left behind has signed in', async () => {
    const t = await tenant();
    const unverified = await user(t, { email: 'd@x.test' });
    await user(t, { email: 'D@x.test', verified: true, createdAt: '2026-02-01T00:00:00Z' });
    await session(t, unverified);
    const report = await run([t]);
    expect(report.refusals[0]?.reason).toBe('unverified_account_has_sign_ins');
    expect((await state(unverified)).disabled).toBe(false);
  });

  it('merges a group of three into one, in one pass', async () => {
    const t = await tenant();
    const a = await user(t, { email: 'e@x.test', createdAt: '2026-01-01T00:00:00Z' });
    const b = await user(t, { email: 'E@x.test', createdAt: '2026-02-01T00:00:00Z' });
    const c = await user(t, { email: 'e@X.test', createdAt: '2026-03-01T00:00:00Z' });
    await session(t, c);
    const report = await run([t]);
    expect(report).toMatchObject({ groups: 1, merged: 1, accounts_retired: 2 });
    expect((await state(a)).disabled).toBe(false);
    expect((await state(b)).disabled).toBe(true);
    expect((await state(c)).disabled).toBe(true);
    expect(await owned('sessions', a)).toHaveLength(1);
  });

  it('finds nothing the second time', async () => {
    const t = await tenant();
    await user(t, { email: 'f@x.test' });
    await user(t, { email: 'F@x.test', createdAt: '2026-02-01T00:00:00Z' });
    expect((await run([t])).merged).toBe(1);
    expect(await run([t])).toMatchObject({ groups: 0, merged: 0, refused: 0, accounts_retired: 0 });
  });

  it('changes nothing on a dry run and says what it would do', async () => {
    const t = await tenant();
    const a = await user(t, { email: 'g@x.test' });
    const b = await user(t, { email: 'G@x.test', createdAt: '2026-02-01T00:00:00Z' });
    await session(t, b);
    const before = await owner.sql`select * from users where tenant_id = ${t} order by subject_id`;
    const report = await run([t], { dryRun: true });
    expect(report).toMatchObject({
      dry_run: true,
      groups: 1,
      merged: 0,
      would_merge: 1,
      accounts_retired: 0,
    });
    expect(await owner.sql`select * from users where tenant_id = ${t} order by subject_id`).toEqual(
      before,
    );
    expect(await owned('sessions', b)).toHaveLength(1);
    expect((await state(a)).disabled).toBe(false);
    expect((await state(b)).disabled).toBe(false);
    const [none] = await owner.sql<{ n: number }[]>`
      select count(*)::int n from audit_events where tenant_id = ${t} and action = 'subject.reconcile'`;
    expect(none?.n).toBe(0);
  });

  it('walks every group when the pages are smaller than the number of groups', async () => {
    const t = await tenant();
    for (let n = 0; n < 5; n += 1) {
      await user(t, { email: `page${String(n)}@x.test` });
      await user(t, { email: `PAGE${String(n)}@x.test`, createdAt: '2026-02-01T00:00:00Z' });
    }
    const report = await run([t], { chunk: 2 });
    expect(report).toMatchObject({ groups: 5, merged: 5, accounts_retired: 5 });
  });

  it('leaves another tenant’s accounts alone', async () => {
    const mine = await tenant();
    const theirs = await tenant();
    await user(mine, { email: 'h@x.test' });
    await user(mine, { email: 'H@x.test', createdAt: '2026-02-01T00:00:00Z' });
    const a = await user(theirs, { email: 'h@x.test' });
    const b = await user(theirs, { email: 'H@x.test', createdAt: '2026-02-01T00:00:00Z' });
    await run([mine]);
    expect((await state(a)).disabled).toBe(false);
    expect((await state(b)).disabled).toBe(false);
  });

  it('does not treat the same address in two tenants as a duplicate', async () => {
    const one = await tenant();
    const two = await tenant();
    await user(one, { email: 'i@x.test' });
    await user(two, { email: 'I@x.test' });
    expect(await run([one, two])).toMatchObject({ groups: 0 });
  });

  it('puts a pair back as it was when any step of it fails', async () => {
    const t = await tenant();
    const stays = await user(t, { email: 'j@x.test' });
    const goes = await user(t, { email: 'J@x.test', createdAt: '2026-02-01T00:00:00Z' });
    const c = await client(t);
    const password = await credential(t, goes, 'password');
    await consent(t, goes, c);
    await owner.sql.unsafe(`
      create function refuse_consent_move() returns trigger language plpgsql
        as $$ begin raise exception 'refused for the test'; end $$;
      create trigger refuse_consent_move before update on consents
        for each row execute function refuse_consent_move();`);
    try {
      const report = await run([t]);
      expect(report).toMatchObject({ groups: 1, merged: 0, failed: 1 });
    } finally {
      await owner.sql.unsafe(`
        drop trigger refuse_consent_move on consents; drop function refuse_consent_move();`);
    }
    expect(await owned('user_credentials', goes)).toEqual([password]);
    expect(await owned('user_credentials', stays)).toEqual([]);
    expect((await state(goes)).disabled).toBe(false);
    expect((await state(goes)).email).toBe('J@x.test');
  });
});

describe('every repository method, called for another tenant', () => {
  it('finds and moves nothing of this tenant’s', async () => {
    const mine = await tenant();
    const stranger = await tenant();
    const a = await user(mine, { email: 'k@x.test' });
    const b = await user(mine, { email: 'K@x.test', createdAt: '2026-02-01T00:00:00Z' });
    const c = await client(mine);
    await credential(mine, b, 'password');
    await session(mine, b);
    await grant(mine, b, c);
    await consent(mine, b, c);
    await withTenant(app.db, stranger, async (tx) => {
      const repository = accountReconcileRepository(tx, stranger);
      expect(await repository.duplicateAddresses(null, 10)).toEqual([]);
      expect(await repository.lockAccounts('k@x.test')).toEqual([]);
      expect(await repository.credentialTypes(b)).toEqual(new Set());
      expect(await repository.moveCredentials(b, a, ['password'])).toBe(0);
      expect(await repository.moveSessions(b, a)).toBe(0);
      expect(await repository.moveGrants(b, a)).toBe(0);
      expect(await repository.moveConsents(b, a, NOW)).toBe(0);
    });
    expect(await owned('user_credentials', b)).toHaveLength(1);
    expect(await owned('sessions', b)).toHaveLength(1);
    expect(await owned('token_grants', b)).toHaveLength(1);
  });

  it('is refused by the policy as well, on a statement that names the other tenant', async () => {
    const mine = await tenant();
    const stranger = await tenant();
    const b = await user(mine, { email: 'l@x.test' });
    await session(mine, b);
    await withTenant(app.db, stranger, async (tx) => {
      expect(await accountReconcileRepository(tx, mine).moveSessions(b, randomUUID())).toBe(0);
    });
    expect(await owned('sessions', b)).toHaveLength(1);
  });
});

describe('the unique index on an address, held back to a later release', () => {
  // Built over one tenant's rows only, in a transaction that is always rolled
  // back: the index spans every tenant, and other tests leave refused pairs.
  async function buildOver(tenantId: string): Promise<string> {
    const rollback = new Error('rolled back on purpose');
    try {
      await owner.sql.begin(async (tx) => {
        await tx`delete from subjects where tenant_id <> ${tenantId}`;
        await tx.unsafe(UNIQUE_INDEX);
        throw rollback;
      });
    } catch (error) {
      if (error === rollback) return 'built';
      return error instanceof Error && 'code' in error ? String(error.code) : 'other';
    }
    return 'built';
  }

  it('cannot be built over a duplicate, and can once the command has run', async () => {
    const t = await tenant();
    await user(t, { email: 'm@x.test' });
    await user(t, { email: 'M@x.test', createdAt: '2026-02-01T00:00:00Z' });
    await user(t, { email: null });
    expect(await buildOver(t)).toBe('23505');
    await run([t]);
    expect(await buildOver(t)).toBe('built');
  });
});
