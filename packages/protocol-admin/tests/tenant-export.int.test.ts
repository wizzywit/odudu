import {
  ASSIGNMENT_LIMIT,
  EXPORT_COLLECTION_CAP,
  EXPORT_SUBJECT_CAP,
  TENANT_DOCUMENT_MEDIA_TYPE,
  tenantDocumentSchema,
  type TenantDocument,
} from '@odudu/contracts/admin';
import { PRIVATE_JWK_MEMBERS, signingKeyRepository, unwrapPrivateJwk } from '@odudu/crypto';
import { withTenant } from '@odudu/db';
import { auditEvents } from '@odudu/domain-audit';
import { groupRepository, roleRepository } from '@odudu/domain-authz';
import { credentialRepository, hashPassword } from '@odudu/domain-identity';
import { ADMIN_CLIENT_ID, clients, clientScopeRepository } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { tenantSmtpRepository } from '@odudu/protocol-admin';
import { clientOidcConfig } from '@odudu/protocol-oidc';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

// The fixture's own key-encryption key (admin-fixture.ts), which is what
// wraps every signing key and SMTP password it stores.
const KEK = Buffer.alloc(32, 7);

function exportTenant(token: string, tenantName: string, query = '') {
  return fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${tenantName}/export${query}`,
    headers: { authorization: `Bearer ${token}` },
  });
}

interface SeededTenant {
  readonly id: string;
  readonly name: string;
  readonly clientId: string;
  readonly secrets: readonly string[];
}

// One of everything the export has to leave out: a confidential client's
// secret, an SMTP password, a password hash, a TOTP seed and the private
// half of the tenant's signing key — each returned in the stored form and,
// where one exists, the plaintext.
async function seededTenant(): Promise<SeededTenant> {
  const t = await fixture.createTenant(`export-${newId()}`);
  const client = await fixture.createConfidentialClient(t.name, {});
  const subject = await fixture.createSubject(t.name, 'grace');
  const smtpPassword = `smtp-${newId()}`;
  const totpSeed = `JBSWY3DPEHPK3PXP${newId().replaceAll('-', '')}`;
  const password = `pw-${newId()}`;
  const passwordHash = await hashPassword(password);

  const token = await fixture.adminToken(t.name, ['manage-tenant', 'manage-clients']);
  const put = await fixture.http.inject({
    method: 'PUT',
    url: `/admin/tenants/${t.name}/smtp`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: {
      host: 'smtp.example.test',
      port: 587,
      from_address: 'noreply@example.test',
      username: 'mailer',
      password: smtpPassword,
      starttls: true,
    },
  });
  expect(put.statusCode).toBe(200);

  const stored = await withTenant(fixture.app.db, t.id, async (tx) => {
    const credentials = credentialRepository(tx);
    await credentials.insert({
      tenantId: t.id,
      subjectId: subject.id,
      type: 'password',
      secret: { kind: 'password', hash: passwordHash },
    });
    await credentials.insert({
      tenantId: t.id,
      subjectId: subject.id,
      type: 'totp',
      secret: { kind: 'totp', secret: totpSeed, digits: 6, lastStep: 0 },
    });

    const roles = roleRepository(tx);
    const reader = await roles.create({ tenantId: t.id, name: 'billing-reader' });
    const auditor = await roles.create({ tenantId: t.id, name: 'billing-auditor' });
    await roles.addComposite(auditor.id, reader.id);
    await roles.assignToSubject(subject.id, auditor.id);
    const groups = groupRepository(tx);
    const finance = await groups.create({ tenantId: t.id, name: 'finance', parentId: null });
    const payroll = await groups.create({ tenantId: t.id, name: 'payroll', parentId: finance.id });
    await groups.mapRole(payroll.id, reader.id);
    await groups.addToSubject(subject.id, payroll.id);
    const openid = await clientScopeRepository(tx).byName('openid');
    if (openid === null) throw new Error('expected the openid scope');
    await roles.mapToClientScope(openid.id, reader.id);

    const [row] = await tx
      .select({ secretHash: clients.secretHash })
      .from(clients)
      .where(eq(clients.id, client.id));
    const smtp = await tenantSmtpRepository(tx).byTenantId(t.id);
    const key = await signingKeyRepository(tx).active();
    return {
      secretHash: row?.secretHash ?? null,
      smtpEncrypted: smtp?.passwordEncrypted ?? null,
      privateJwkEncrypted: key.privateJwkEncrypted,
    };
  });
  if (stored.secretHash === null || stored.smtpEncrypted === null) {
    throw new Error('expected a stored client secret hash and SMTP password');
  }

  const privateJwk = unwrapPrivateJwk<Record<string, unknown>>(stored.privateJwkEncrypted, KEK);
  const privateMembers = PRIVATE_JWK_MEMBERS.flatMap((member) => {
    const value = privateJwk[member];
    return typeof value === 'string' ? [value] : [];
  });
  expect(privateMembers.length).toBeGreaterThan(0);

  return {
    id: t.id,
    name: t.name,
    clientId: client.clientId,
    secrets: [
      client.secret,
      stored.secretHash,
      smtpPassword,
      stored.smtpEncrypted,
      password,
      passwordHash,
      totpSeed,
      stored.privateJwkEncrypted,
      ...privateMembers,
    ],
  };
}

function parsed(payload: string): TenantDocument {
  return tenantDocumentSchema.parse(JSON.parse(payload));
}

describe('GET /admin/tenants/{tenant}/export', () => {
  it('answers a document that validates against tenantDocumentSchema', async () => {
    const t = await seededTenant();
    const token = await fixture.adminToken(t.name, ['manage-tenant', 'manage-clients']);

    const res = await exportTenant(token, t.name);

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain(TENANT_DOCUMENT_MEDIA_TYPE);
    expect(res.headers['cache-control']).toBe('no-store');
    const document = parsed(res.payload);
    expect(document.version).toBe(1);
    expect(document.subjects).toBeUndefined();
    expect(document.settings).toHaveProperty('username_editable');
    expect(document.settings).not.toHaveProperty('client_registration_policy');
    expect(document.registration_policy.client_registration_policy).toBeTypeOf('string');
    expect(document.smtp).toEqual({
      host: 'smtp.example.test',
      port: 587,
      from_address: 'noreply@example.test',
      username: 'mailer',
      starttls: true,
    });
    expect(document.flow.length).toBeGreaterThan(0);
  });

  it('carries no secret seeded into the tenant, in any stored or plaintext form', async () => {
    const t = await seededTenant();
    const token = await fixture.adminToken(t.name, [
      'manage-tenant',
      'manage-clients',
      'view-users',
    ]);

    const res = await exportTenant(token, t.name, '?include=subjects');

    expect(res.statusCode).toBe(200);
    for (const secret of t.secrets) {
      expect(res.payload, secret).not.toContain(secret);
    }
  });

  it('lists each secret it leaves out under omitted, by its JSON path', async () => {
    const t = await seededTenant();
    const token = await fixture.adminToken(t.name, ['manage-tenant', 'manage-clients']);

    const document = parsed((await exportTenant(token, t.name)).payload);

    const index = document.clients.findIndex((client) => client.client_id === t.clientId);
    expect(index).toBeGreaterThanOrEqual(0);
    const confidential = document.clients.flatMap((client, i) =>
      client.type === 'confidential' ? [`clients[${String(i)}].secret`] : [],
    );
    expect(confidential).toContain(`clients[${String(index)}].secret`);
    expect(document.omitted).toEqual(expect.arrayContaining([...confidential, 'smtp.password']));
  });

  it('refers to roles, groups, scopes and clients by name, never by row id', async () => {
    const t = await seededTenant();
    const token = await fixture.adminToken(t.name, [
      'manage-tenant',
      'manage-clients',
      'view-users',
    ]);

    const res = await exportTenant(token, t.name, '?include=subjects');
    const document = parsed(res.payload);

    // The fixture's client_id embeds an id of its own; every row id is a
    // UUIDv7 and none may appear.
    expect(res.payload.replaceAll(t.clientId, '')).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/u,
    );
    const reader = { name: 'billing-reader', client: null };
    expect(document.roles.find((role) => role.name === 'billing-auditor')?.composites).toEqual([
      reader,
    ]);
    expect(document.groups.map((group) => group.path)).toEqual(['/finance', '/finance/payroll']);
    expect(document.groups[1]?.roles).toEqual([reader]);
    const openid = document.scopes.find((scope) => scope.name === 'openid');
    expect(openid?.builtin).toBe(true);
    expect(openid?.roles).toEqual([reader]);
    expect(openid?.clients).toEqual([{ client_id: t.clientId, assignment: 'default' }]);
    const grace = document.subjects?.find((subject) => subject.username === 'grace');
    expect(grace?.roles).toEqual([{ name: 'billing-auditor', client: null }]);
    expect(grace?.groups).toEqual(['/finance/payroll']);
  });

  it('leaves the built-in admin client out, and marks its capability roles built in', async () => {
    const t = await seededTenant();
    const token = await fixture.adminToken(t.name, ['manage-tenant', 'manage-clients']);

    const document = parsed((await exportTenant(token, t.name)).payload);

    expect(document.clients.map((client) => client.client_id)).not.toContain(ADMIN_CLIENT_ID);
    for (const scope of document.scopes) {
      expect(scope.clients.map((c) => c.client_id)).not.toContain(ADMIN_CLIENT_ID);
    }
    const manageUsers = document.roles.find(
      (role) => role.name === 'manage-users' && role.client === ADMIN_CLIENT_ID,
    );
    expect(manageUsers?.builtin).toBe(true);
    expect(manageUsers?.composites).toEqual([{ name: 'view-users', client: ADMIN_CLIENT_ID }]);
    expect(document.roles.find((role) => role.name === 'billing-reader')?.builtin).toBe(false);
  });

  it('writes a tenant.export audit row naming whether subjects were included', async () => {
    const t = await seededTenant();
    const token = await fixture.adminToken(t.name, [
      'manage-tenant',
      'manage-clients',
      'view-users',
    ]);

    expect((await exportTenant(token, t.name, '?include=subjects')).statusCode).toBe(200);

    const rows = await withTenant(fixture.app.db, t.id, (tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.action, 'tenant.export')),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventType: 'admin_mutation',
      outcome: 'allowed',
      resourceType: 'tenant',
      resourceId: t.id,
      detail: { include_subjects: true },
    });
  });

  it('exports nothing of another tenant', async () => {
    const t = await seededTenant();
    const other = await seededTenant();
    const suffix = newId();
    const foreign = {
      role: `foreign-role-${suffix}`,
      group: `foreign-group-${suffix}`,
      username: `foreign-user-${suffix}`,
    };
    await fixture.createSubject(other.name, foreign.username);
    await withTenant(fixture.app.db, other.id, async (tx) => {
      await roleRepository(tx).create({ tenantId: other.id, name: foreign.role });
      await groupRepository(tx).create({ tenantId: other.id, name: foreign.group, parentId: null });
    });
    const token = await fixture.adminToken(t.name, [
      'manage-tenant',
      'manage-clients',
      'view-users',
    ]);

    const res = await exportTenant(token, t.name, '?include=subjects');

    for (const value of [other.clientId, foreign.role, foreign.group, foreign.username]) {
      expect(res.payload, value).not.toContain(value);
    }
    const document = parsed(res.payload);
    expect(document.clients.map((client) => client.client_id)).toEqual([t.clientId]);
    expect(document.subjects?.map((subject) => subject.username)).toEqual(['grace']);
  });

  it('refuses a caller with manage-tenant alone, since a client is read with manage-clients', async () => {
    const t = await fixture.createTenant(`export-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const res = await exportTenant(token, t.name);

    expect(res.statusCode).toBe(403);
    const refused = await withTenant(fixture.app.db, t.id, (tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.action, 'capability.refused')),
    );
    expect(refused.map((row) => row.detail)).toContainEqual({
      capability: 'manage-clients',
      reason: 'missing_capability',
    });
    const exported = await withTenant(fixture.app.db, t.id, (tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.action, 'tenant.export')),
    );
    expect(exported).toEqual([]);
  });

  it('refuses ?include=subjects with 403 to a caller without view-users', async () => {
    const t = await fixture.createTenant(`export-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant', 'manage-clients']);

    const res = await exportTenant(token, t.name, '?include=subjects');

    expect(res.statusCode).toBe(403);
    expect(res.headers['content-type']).toContain('application/problem+json');
    const refused = await withTenant(fixture.app.db, t.id, (tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.action, 'capability.refused')),
    );
    expect(refused.map((row) => row.detail)).toContainEqual({
      capability: 'view-users',
      reason: 'missing_capability',
    });
    const exported = await withTenant(fixture.app.db, t.id, (tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.action, 'tenant.export')),
    );
    expect(exported).toEqual([]);
  });

  it('strips private members from a jwks stored before they were refused, naming each', async () => {
    const t = await fixture.createTenant(`export-${newId()}`);
    const client = await fixture.createConfidentialClient(t.name, {});
    const privateValues = Object.fromEntries(
      PRIVATE_JWK_MEMBERS.map((member) => [member, `private-${member}-${newId()}`]),
    );
    const publicKey = { kty: 'EC', crv: 'P-256', x: 'public-x', y: 'public-y', kid: 'one' };
    await withTenant(fixture.app.db, t.id, (tx) =>
      tx
        .update(clientOidcConfig)
        .set({ jwks: { keys: [publicKey, { ...publicKey, kid: 'two', ...privateValues }] } })
        .where(eq(clientOidcConfig.clientId, client.id)),
    );
    const token = await fixture.adminToken(t.name, ['manage-tenant', 'manage-clients']);

    const res = await exportTenant(token, t.name);

    expect(res.statusCode).toBe(200);
    for (const value of Object.values(privateValues)) {
      expect(res.payload, value).not.toContain(value);
    }
    const document = parsed(res.payload);
    expect(document.clients[0]?.jwks).toEqual({ keys: [publicKey, { ...publicKey, kid: 'two' }] });
    expect(document.omitted).toContain('clients[0].jwks.keys[1]');
    expect(document.omitted).not.toContain('clients[0].jwks.keys[0]');
  });

  it('refuses an unknown include with 400', async () => {
    const t = await fixture.createTenant(`export-${newId()}`);
    const token = await fixture.adminToken(t.name, [
      'manage-tenant',
      'manage-clients',
      'view-users',
    ]);

    expect((await exportTenant(token, t.name, '?include=sessions')).statusCode).toBe(400);
  });

  it('refuses a tenant whose roles are more than one document holds, naming which, and 413 over HTTP', async () => {
    const t = await fixture.createTenant(`export-${newId()}`);
    await fixture.owner.sql`
      insert into roles (id, tenant_id, name)
      select gen_random_uuid(), ${t.id}, 'bulk-' || g
        from generate_series(1, ${EXPORT_COLLECTION_CAP} - (select count(*) from roles where tenant_id = ${t.id}) + 1) g`;
    const token = await fixture.adminToken(t.name, ['manage-tenant', 'manage-clients']);

    const res = await exportTenant(token, t.name);

    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ type: 'about:blank#export-too-large', status: 413 });
    expect(JSON.stringify(res.json())).toContain('roles');
  }, 60_000);

  it('refuses a tenant whose one role nests more composites than an import takes, naming the count', async () => {
    const t = await fixture.createTenant(`export-${newId()}`);
    await fixture.owner.sql`
      with parent as (
        insert into roles (id, tenant_id, name) values (gen_random_uuid(), ${t.id}, 'big-parent')
        returning id),
      kids as (
        insert into roles (id, tenant_id, name)
        select gen_random_uuid(), ${t.id}, 'kid-' || g from generate_series(1, ${ASSIGNMENT_LIMIT + 1}) g
        returning id)
      insert into role_composites (tenant_id, parent_role_id, child_role_id)
      select ${t.id}, parent.id, kids.id from parent, kids`;
    const token = await fixture.adminToken(t.name, ['manage-tenant', 'manage-clients']);

    const res = await exportTenant(token, t.name);

    expect(res.statusCode).toBe(413);
    const detail = String(res.json<{ detail?: unknown }>().detail);
    expect(detail).toContain(String(ASSIGNMENT_LIMIT + 1));
    expect(detail).toContain(String(ASSIGNMENT_LIMIT));
  }, 60_000);

  it(`refuses ?include=subjects with 413 above ${String(EXPORT_SUBJECT_CAP)} subjects, naming P7`, async () => {
    const t = await fixture.createTenant(`export-${newId()}`);
    await withTenant(fixture.app.db, t.id, (tx) =>
      tx.execute(sql`
        WITH made AS (
          INSERT INTO subjects (id, tenant_id, type)
          SELECT gen_random_uuid(), ${t.id}, 'user'
          FROM generate_series(1, ${EXPORT_SUBJECT_CAP + 1})
          RETURNING id
        )
        INSERT INTO users (subject_id, tenant_id, username)
        SELECT id, ${t.id}, 'bulk-' || id FROM made
      `),
    );
    const token = await fixture.adminToken(t.name, [
      'manage-tenant',
      'manage-clients',
      'view-users',
    ]);

    const res = await exportTenant(token, t.name, '?include=subjects');

    expect(res.statusCode).toBe(413);
    const body: unknown = res.json();
    expect(body).toMatchObject({ type: 'about:blank#export-too-large', status: 413 });
    expect(JSON.stringify(body)).toContain('P7');
    expect((await exportTenant(token, t.name)).statusCode).toBe(200);
  }, 60_000);
});
