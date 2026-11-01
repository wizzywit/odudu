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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { accountTestDeps } from '#/testing/support';
import { tenantSettingsRepository } from '#/repository/tenant-settings';
import { actionTokens } from '#/schema/action-tokens';
import { enqueueActionsLink } from '#/usecase/execute-actions';
import { enqueueResetLink } from '#/usecase/reset-password';
import { registerActionTokenRoute } from '#/view/routes/action-token';

vi.mock('#/view/messages', async (importOriginal) => {
  const { withFrench } = await import('@odudu/testkit/i18n');
  return withFrench(await importOriginal(), {
    'password.rule.minLength':
      'Le mot de passe doit comporter au moins {min, number, ::group-off} caractères.',
    'password.rule.maxLength':
      'Le mot de passe ne doit pas dépasser {max, number, ::group-off} caractères.',
  });
});

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
    ...accountTestDeps,
    findHeldSignIn: () => Promise.resolve(null),
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
  await owner.db.insert(tenants).values({
    id: tenantId,
    name: tenantName,
    resetPasswordAllowed,
    supportedLocales: ['en', 'fr'],
  });
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

async function mail(seeded: Seeded, actions: readonly string[]): Promise<string> {
  const link = await withTenant(app.db, seeded.tenantId, async (tx) => {
    const tenant = {
      tenantId: seeded.tenantId,
      tenantName: seeded.tenantName,
      tenantDisplayName: seeded.tenantName,
      issuerBase: 'https://idp.example.test',
      now: () => new Date(),
    };
    const user = { subjectId: seeded.subjectId, email: 'ada@example.test' };
    await enqueueActionsLink(tx, tenant, user, { actions });
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

function submit(seeded: Seeded, key: string, password?: string, language?: string) {
  return http.inject({
    method: 'POST',
    url: `/tenants/${seeded.tenantName}/login-actions/action-token`,
    payload: new URLSearchParams({
      key,
      ...(password === undefined ? {} : { password }),
    }).toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(language === undefined ? {} : { 'accept-language': language }),
    },
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
          now: () => new Date(),
        },
        { subjectId: seeded.subjectId, email: 'ada@example.test' },
      );
    });
    const link = await mail(seeded, ['configure-totp', 'update-password']);

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
    expect(done.body).not.toMatch(/<a[\s>]/u);
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

  it('mails each action as the catalogue words it, whatever locale the subject holds', async () => {
    const seeded = await seed(true);
    const rows = await withTenant(app.db, seeded.tenantId, async (tx) => {
      const tenant = {
        tenantId: seeded.tenantId,
        tenantName: seeded.tenantName,
        tenantDisplayName: 'Acme <Co>',
        issuerBase: 'https://idp.example.test',
        now: () => new Date(),
      };
      for (const locale of [null, 'de-CH', 'not a tag']) {
        const user = { subjectId: seeded.subjectId, email: 'ada@example.test', locale };
        await enqueueActionsLink(tx, tenant, user, {
          actions: ['configure-totp', 'update-password'],
        });
      }
      return tx.select().from(emailOutbox);
    });
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.subject).toBe('Update your Acme <Co> account');
      expect(row.bodyText).toContain('- Choose a new password\n- Set up an authenticator app\n');
      expect(row.bodyHtml).toMatch(
        /<li[^>]*>Choose a new password<\/li><li[^>]*>Set up an authenticator app<\/li>/u,
      );
      expect(row.bodyHtml).toContain('<bdi>Acme &lt;Co&gt;</bdi>');
    }
  });

  it.each([
    ['2026-12-31T23:59:59Z', '2026'],
    ['2027-01-01T00:00:00Z', '2027'],
    ['2031-06-01T12:00:00Z', '2031'],
  ])('stamps the mail with the year of the clock it was given: %s', async (instant, year) => {
    const seeded = await seed(true);
    const rows = await withTenant(app.db, seeded.tenantId, async (tx) => {
      await enqueueActionsLink(
        tx,
        {
          tenantId: seeded.tenantId,
          tenantName: seeded.tenantName,
          tenantDisplayName: 'Acme',
          issuerBase: 'https://idp.example.test',
          now: () => new Date(instant),
        },
        { subjectId: seeded.subjectId, email: 'ada@example.test' },
        { actions: ['configure-totp'] },
      );
      return tx.select().from(emailOutbox);
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.bodyHtml).toContain(`\u00a9 ${year} Odudu`);
    expect(rows[0]?.bodyText).toContain(`\u00a9 ${year} Odudu`);
  });

  it('asks for no password when the link names none, and leaves it unchanged', async () => {
    const seeded = await seed(false);
    const link = await mail(seeded, ['generate-recovery-codes', 'configure-passkey']);
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
    const link = await mail(seeded, ['update-password']);
    const missing = await submit(seeded, keyOf(link));
    expect(missing.statusCode).toBe(400);
    expect(missing.body).toContain('A new password is required.');
    const weak = await submit(seeded, keyOf(link), 'short');
    expect(weak.statusCode).toBe(400);
    expect((await submit(seeded, keyOf(link), NEW_PASSWORD)).statusCode).toBe(200);
  });

  it('puts the actions form back in place, with the list, the key and the reasons', async () => {
    const seeded = await seed(true);
    const link = await mail(seeded, ['update-password', 'configure-totp']);
    const key = keyOf(link);

    for (const [password, reason] of [
      [undefined, 'A new password is required.'],
      ['zq9xv', 'Password must be at least 15 characters long.'],
    ] as const) {
      const refused = await submit(seeded, key, password);
      expect(refused.statusCode).toBe(400);
      expect(refused.body).toContain('<form method="post"');
      expect(refused.body).toContain(`name="key" value="${key}"`);
      expect(refused.body).toContain('<li>Choose a new password</li>');
      expect(refused.body).toContain('<li>Set up an authenticator app</li>');
      expect(refused.body).toContain(reason);
      expect(refused.body).toContain('aria-invalid="true" aria-describedby="form-error-0');
      expect(refused.body).not.toContain('zq9xv');
    }
  });

  it('refuses a common password on an actions link, without spending the link', async () => {
    const seeded = await seed(true);
    const link = await mail(seeded, ['update-password']);

    const refused = await submit(seeded, keyOf(link), '1qaz2wsx3edc4rfv');
    expect(refused.statusCode).toBe(400);
    expect(refused.body).toContain(
      '>That password is too easy to guess. Choose a different one.</li>',
    );
    expect((await submit(seeded, keyOf(link), NEW_PASSWORD)).statusCode).toBe(200);
  });

  it('words a weak password from the catalogue with the tenant minimum, in the page language', async () => {
    const seeded = await seed(true);
    const link = await mail(seeded, ['update-password']);

    const english = await submit(seeded, keyOf(link), 'short');
    expect(english.statusCode).toBe(400);
    expect(english.body).toContain('>Password must be at least 15 characters long.</li>');
    expect(english.body).not.toMatch(/<li[^>]*><bdi>/u);

    const french = await submit(seeded, keyOf(link), 'short', 'fr');
    expect(french.headers['content-language']).toBe('fr');
    expect(french.body).toContain('>Le mot de passe doit comporter au moins 15 caractères.</li>');
    expect(french.body).not.toMatch(/<li[^>]*><bdi>/u);
  });

  it('refuses a too-long password on an actions link and on a reset link, with the limit', async () => {
    const seeded = await seed(true);
    const long = 'x'.repeat(300);
    const actions = await mail(seeded, ['update-password']);
    const reset = await mailReset(seeded);
    for (const link of [actions, reset]) {
      const refused = await submit(seeded, keyOf(link), long, 'fr');
      expect(refused.statusCode).toBe(400);
      expect(refused.body).toContain('>Le mot de passe ne doit pas dépasser 256 caractères.</li>');
      expect(refused.body).not.toMatch(/<li[^>]*><bdi>/u);
    }
    expect((await submit(seeded, keyOf(actions), NEW_PASSWORD)).statusCode).toBe(200);
  });

  it('is stopped by the reset kill switch when it sets a password', async () => {
    const seeded = await seed(false);
    const link = await mail(seeded, ['update-password']);
    expect((await open(link)).statusCode).toBe(400);
    expect((await submit(seeded, keyOf(link), NEW_PASSWORD)).statusCode).toBe(400);
    expect(await passwordIs(seeded, OLD_PASSWORD)).toBe(true);
  });

  it('is retired by a completed reset, and retires one itself', async () => {
    const seeded = await seed(true);
    const actions = await mail(seeded, ['update-password', 'configure-totp']);
    const reset = await mailReset(seeded);
    expect((await submit(seeded, keyOf(reset), NEW_PASSWORD)).statusCode).toBe(200);
    expect((await submit(seeded, keyOf(actions), 'yet another long passphrase')).statusCode).toBe(
      400,
    );

    const first = await mail(seeded, ['update-password']);
    const sibling = await mail(seeded, ['update-password', 'configure-passkey']);
    const laterReset = await mailReset(seeded);
    expect((await submit(seeded, keyOf(first), 'a fourth long passphrase')).statusCode).toBe(200);
    expect((await submit(seeded, keyOf(sibling), 'a fifth long passphrase')).statusCode).toBe(400);
    expect((await submit(seeded, keyOf(laterReset), 'a sixth long passphrase')).statusCode).toBe(
      400,
    );
    expect(await passwordIs(seeded, 'a fourth long passphrase')).toBe(true);
  });

  it('leaves a link that sets no password to a reset', async () => {
    const seeded = await seed(true);
    const actions = await mail(seeded, ['configure-totp']);
    const reset = await mailReset(seeded);
    expect((await submit(seeded, keyOf(reset), NEW_PASSWORD)).statusCode).toBe(200);
    expect((await submit(seeded, keyOf(actions))).statusCode).toBe(200);
  });
});

async function mailReset(seeded: Seeded): Promise<string> {
  const link = await withTenant(app.db, seeded.tenantId, async (tx) => {
    await enqueueResetLink(
      tx,
      {
        tenantId: seeded.tenantId,
        tenantName: seeded.tenantName,
        tenantDisplayName: seeded.tenantName,
        issuerBase: 'https://idp.example.test',
        now: () => new Date(),
      },
      { subjectId: seeded.subjectId, email: 'ada@example.test' },
    );
    const rows = await tx.select().from(emailOutbox);
    return /visiting this link:\n\n(\S+)/.exec(rows[rows.length - 1]?.bodyText ?? '')?.[1];
  });
  if (link === undefined) throw new Error('no reset link was mailed');
  return link;
}
