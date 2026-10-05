import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import {
  credentialRepository,
  evaluatePassword,
  hashPassword,
  subjectRepository,
  userRepository,
  verifyPassword,
} from '@odudu/domain-identity';
import { emailOutbox } from '@odudu/email';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tenantSettingsRepository } from '#/repository/tenant-settings';
import { actionTokens } from '#/schema/action-tokens';
import { enqueueActionsLink } from '#/usecase/execute-actions';
import { enqueueResetLink } from '#/usecase/reset-password';
import { registerActionTokenRoute } from '#/view/routes/action-token';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;
const owed: { subjectId: string; actions: readonly string[] }[] = [];

const OLD_PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'a much longer new passphrase';

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);
  appHandle = createDatabase(await createAppRole(containerHandle.adminUrl), { max: 5 });
  app = appHandle;

  http = Fastify();
  http.register(formbody);
  registerActionTokenRoute(http, {
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
    unchangedPasswordViolations: () => Promise.resolve([]),
    clearPasswordUpdateAction: () => Promise.resolve(),
    addRequiredActions: (_tx, _tenantId, subjectId, actions) => {
      owed.push({ subjectId, actions });
      return Promise.resolve();
    },
  });
  await http.ready();
}, 120_000);

afterAll(async () => {
  await http.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

interface Seeded {
  readonly tenantName: string;
  readonly tenantId: string;
  readonly subjectId: string;
}

async function seed(resetPasswordAllowed: boolean): Promise<Seeded> {
  const tenantId = newId();
  const tenantName = `actions-${tenantId.slice(-12)}`;
  await owner.db.insert(tenants).values({ id: tenantId, name: tenantName, resetPasswordAllowed });
  const subjectId = await withTenant(app.db, tenantId, async (tx) => {
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await userRepository(tx).create({
      subjectId: subject.id,
      tenantId,
      username: 'ada',
      email: 'ada@example.test',
    });
    await credentialRepository(tx).insert({
      tenantId,
      subjectId: subject.id,
      type: 'password',
      secret: { kind: 'password', hash: await hashPassword(OLD_PASSWORD) },
    });
    return subject.id;
  });
  return { tenantName, tenantId, subjectId };
}

async function mail(
  seeded: Seeded,
  actions: readonly string[],
  redirectUri: string | null,
): Promise<string> {
  const link = await withTenant(app.db, seeded.tenantId, async (tx) => {
    const tenant = {
      tenantId: seeded.tenantId,
      tenantName: seeded.tenantName,
      tenantDisplayName: seeded.tenantName,
      issuerBase: 'https://idp.example.test',
    };
    const user = { subjectId: seeded.subjectId, email: 'ada@example.test' };
    await enqueueActionsLink(tx, tenant, user, { actions, redirectUri });
    const rows = await tx.select().from(emailOutbox);
    return /visiting this link:\n\n(\S+)/.exec(rows[rows.length - 1]?.bodyText ?? '')?.[1];
  });
  if (link === undefined) throw new Error('no link was mailed');
  return link;
}

function keyOf(link: string): string {
  return new URL(link).searchParams.get('key') ?? '';
}

function open(link: string) {
  const url = new URL(link);
  return http.inject({ method: 'GET', url: `${url.pathname}${url.search}` });
}

function submit(seeded: Seeded, key: string, password?: string) {
  return http.inject({
    method: 'POST',
    url: `/tenants/${seeded.tenantName}/login-actions/action-token`,
    payload: new URLSearchParams({
      key,
      ...(password === undefined ? {} : { password }),
    }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

async function passwordIs(seeded: Seeded, password: string): Promise<boolean> {
  return withTenant(app.db, seeded.tenantId, async (tx) => {
    const stored = await credentialRepository(tx).passwordFor(seeded.subjectId);
    return stored !== null && verifyPassword(stored, password);
  });
}

describe('a link that takes its subject through required actions', () => {
  it('sets the password it asks for, owes the rest, and is spent', async () => {
    const seeded = await seed(true);
    await withTenant(app.db, seeded.tenantId, async (tx) => {
      await enqueueResetLink(
        tx,
        {
          tenantId: seeded.tenantId,
          tenantName: seeded.tenantName,
          tenantDisplayName: 'x',
          issuerBase: 'https://idp.example.test',
        },
        { subjectId: seeded.subjectId, email: 'ada@example.test' },
      );
    });
    const link = await mail(
      seeded,
      ['configure-totp', 'update-password'],
      'https://app.example/cb?a=1&b="x"',
    );

    const first = await open(link);
    const second = await open(link);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.body).toContain(
      '<li>Choose a new password</li>\n<li>Set up an authenticator app</li>',
    );
    expect(first.body).toContain('name="password"');

    const done = await submit(seeded, keyOf(link), NEW_PASSWORD);
    expect(done.statusCode).toBe(200);
    expect(done.body).toContain('<li>Set up an authenticator app</li>');
    expect(done.body).toContain('href="https://app.example/cb?a=1&amp;b=&quot;x&quot;"');
    expect(done.headers['content-security-policy']).toContain("default-src 'none'");
    expect(await passwordIs(seeded, NEW_PASSWORD)).toBe(true);
    expect(owed.filter((entry) => entry.subjectId === seeded.subjectId)).toEqual([
      { subjectId: seeded.subjectId, actions: ['configure-totp'] },
    ]);

    expect((await submit(seeded, keyOf(link), 'another long passphrase')).statusCode).toBe(400);
    const outstanding = await withTenant(app.db, seeded.tenantId, (tx) =>
      tx.select().from(actionTokens).where(eq(actionTokens.subjectId, seeded.subjectId)),
    );
    expect(outstanding.every((row) => row.consumedAt !== null)).toBe(true);
  });

  it('asks for no password when the link names none, and leaves it unchanged', async () => {
    const seeded = await seed(false);
    const link = await mail(seeded, ['generate-recovery-codes', 'configure-passkey'], null);
    const page = await open(link);
    expect(page.statusCode).toBe(200);
    expect(page.body).not.toContain('name="password"');

    const done = await submit(seeded, keyOf(link));
    expect(done.statusCode).toBe(200);
    expect(done.body).not.toContain('<a ');
    expect(await passwordIs(seeded, OLD_PASSWORD)).toBe(true);
    expect(owed.filter((entry) => entry.subjectId === seeded.subjectId)).toEqual([
      { subjectId: seeded.subjectId, actions: ['configure-passkey', 'generate-recovery-codes'] },
    ]);
  });

  it('keeps a link usable through a missing or weak password, then accepts a good one', async () => {
    const seeded = await seed(true);
    const link = await mail(seeded, ['update-password'], null);
    const missing = await submit(seeded, keyOf(link));
    expect(missing.statusCode).toBe(400);
    expect(missing.body).toContain('A new password is required.');
    const weak = await submit(seeded, keyOf(link), 'short');
    expect(weak.statusCode).toBe(400);
    expect((await submit(seeded, keyOf(link), NEW_PASSWORD)).statusCode).toBe(200);
  });

  it('is stopped by the reset kill switch when it sets a password', async () => {
    const seeded = await seed(false);
    const link = await mail(seeded, ['update-password'], null);
    expect((await open(link)).statusCode).toBe(400);
    expect((await submit(seeded, keyOf(link), NEW_PASSWORD)).statusCode).toBe(400);
    expect(await passwordIs(seeded, OLD_PASSWORD)).toBe(true);
  });
});
