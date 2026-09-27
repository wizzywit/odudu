import { executionRepository, requiredActionRepository } from '@odudu/authn-flows';
import {
  TENANT_IMPORT_BODY_LIMIT,
  tenantDocumentSchema,
  type TenantDocument,
} from '@odudu/contracts/admin';
import { signingKeyRepository } from '@odudu/crypto';
import { withTenant } from '@odudu/db';
import { auditEvents } from '@odudu/domain-audit';
import { groupRepository, roleRepository } from '@odudu/domain-authz';
import {
  credentialRepository,
  hashPassword,
  subjectRepository,
  userCredentials,
  userRepository,
} from '@odudu/domain-identity';
import {
  ADMIN_CLIENT_ID,
  clientRepository,
  clientScopeMapperRepository,
  clientScopeRepository,
  tenantSettingsRepository,
} from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { tenantLookupRepository } from '@odudu/protocol-oidc';
import { eq } from 'drizzle-orm';
import { type LightMyRequestResponse } from 'fastify';
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

// `tenant-admin` as well as `manage-tenants`: the import grants capability
// roles, and the capability ceiling admits only what the caller holds.
async function operatorToken(): Promise<string> {
  return fixture.systemAdminToken(['manage-tenants', 'tenant-admin']);
}

function postImport(token: string, body: unknown): Promise<LightMyRequestResponse> {
  return fixture.http.inject({
    method: 'POST',
    url: '/admin/tenant-imports',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: JSON.stringify(body),
  });
}

async function exportOf(token: string, tenantName: string): Promise<TenantDocument> {
  const res = await fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${tenantName}/export?include=subjects`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.statusCode, res.payload).toBe(200);
  return tenantDocumentSchema.parse(JSON.parse(res.payload));
}

async function tenantIdOf(name: string): Promise<string | null> {
  const found = await tenantLookupRepository(fixture.owner.db).byName(name);
  return found?.id ?? null;
}

interface ImportAnswer {
  readonly tenant: { readonly id: string; readonly name: string };
  readonly client_secrets: readonly { readonly client_id: string; readonly secret: string }[];
}

interface ImportRefusal {
  readonly status: number;
  readonly errors?: readonly { readonly path: string; readonly message: string }[];
}

// One of nearly everything a document can carry, written the way the admin
// API or provisioning writes it: clients of both types, a service account
// holding a role, tenant and client roles with a composite and a default,
// a built-in role and a built-in scope amended, a built-in scope deleted,
// nested groups, a custom scope with a mapping, a mapper and an
// assignment, a changed flow and settings, an SMTP relay, and three
// subjects, one disabled and one holding a password.
async function seededSource(): Promise<{ id: string; name: string; confidentialId: string }> {
  const t = await fixture.createTenant(`import-src-${newId()}`);
  const confidential = await fixture.createConfidentialClient(t.name, {
    grantTypes: ['client_credentials'],
    redirectUris: [],
  });
  const token = await operatorToken();
  const spa = await fixture.http.inject({
    method: 'POST',
    url: `/admin/tenants/${t.name}/clients`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: {
      client_id: 'spa',
      name: 'Single-page app',
      token_endpoint_auth_method: 'none',
      redirect_uris: ['https://spa.example/callback'],
      web_origins: ['+'],
    },
  });
  expect(spa.statusCode, spa.payload).toBe(201);
  const smtp = await fixture.http.inject({
    method: 'PUT',
    url: `/admin/tenants/${t.name}/smtp`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: {
      host: 'smtp.example.test',
      port: 587,
      from_address: 'noreply@example.test',
      username: 'mailer',
      password: 'relay-password',
      starttls: true,
    },
  });
  expect(smtp.statusCode, smtp.payload).toBe(200);
  const ivan = await fixture.http.inject({
    method: 'POST',
    url: `/admin/tenants/${t.name}/subjects`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: { username: 'ivan' },
  });
  expect(ivan.statusCode, ivan.payload).toBe(201);

  await withTenant(fixture.app.db, t.id, async (tx) => {
    const roles = roleRepository(tx);
    const reader = await roles.create({
      tenantId: t.id,
      name: 'billing-reader',
      description: 'Reads invoices',
    });
    const auditor = await roles.create({ tenantId: t.id, name: 'billing-auditor' });
    await roles.addComposite(auditor.id, reader.id);
    await roles.create({ tenantId: t.id, name: 'member', defaultForNewSubjects: true });
    await roles.create({ tenantId: t.id, name: 'app-admin', clientId: confidential.id });
    const admin = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
    const manageUsers = await roles.byName('manage-users', admin?.id ?? null);
    if (manageUsers === null) throw new Error('expected manage-users');
    await roles.amend(manageUsers.id, { description: 'Administers subjects' });

    const client = await clientRepository(tx).byId(confidential.id);
    if (client?.serviceSubjectId == null) throw new Error('expected a service subject');
    await roles.assignToSubject(client.serviceSubjectId, reader.id);

    const groups = groupRepository(tx);
    const finance = await groups.create({ tenantId: t.id, name: 'finance', parentId: null });
    const payroll = await groups.create({ tenantId: t.id, name: 'payroll', parentId: finance.id });
    await groups.mapRole(payroll.id, auditor.id);

    const scopes = clientScopeRepository(tx);
    const billing = await scopes.create({
      tenantId: t.id,
      name: 'billing',
      description: 'Invoices',
      includeInIdToken: false,
    });
    await roles.mapToClientScope(billing.id, reader.id);
    await clientScopeMapperRepository(tx).replaceForScope(t.id, billing.id, ['roles']);
    await scopes.assignOrUpdate(confidential.id, billing.id, 'optional');
    const phone = await scopes.byName('phone');
    if (phone !== null) await scopes.delete(phone.id);
    const profile = await scopes.byName('profile');
    if (profile !== null) await scopes.amend(profile.id, { description: 'Who you are' });

    await executionRepository(tx).replaceForTenant(t.id, [
      { authenticator: 'password', requirement: 'required' },
      { authenticator: 'otp', requirement: 'conditional' },
    ]);
    await tenantSettingsRepository(tx).amend(t.id, {
      passwordMinLength: 12,
      usernameEditable: true,
    });

    const grace = await subjectRepository(tx).create({ tenantId: t.id, type: 'user' });
    await userRepository(tx).create({
      subjectId: grace.id,
      tenantId: t.id,
      username: 'grace',
      email: 'grace@example.test',
    });
    await userRepository(tx).updateProfile(grace.id, { givenName: 'Grace', locale: 'en-GB' });
    await userRepository(tx).setVerification(grace.id, { emailVerified: true });
    await roles.assignToSubject(grace.id, auditor.id);
    await groups.addToSubject(grace.id, payroll.id);
    await credentialRepository(tx).insert({
      tenantId: t.id,
      subjectId: grace.id,
      type: 'password',
      secret: { kind: 'password', hash: await hashPassword('grace-password') },
    });

    const hana = await subjectRepository(tx).create({ tenantId: t.id, type: 'user' });
    await userRepository(tx).create({ subjectId: hana.id, tenantId: t.id, username: 'hana' });
    await subjectRepository(tx).setEnabled(hana.id, false);
    await requiredActionRepository(tx).add(t.id, hana.id, 'configure-totp');
  });
  return { id: t.id, name: t.name, confidentialId: confidential.clientId };
}

// `name` travels in the request rather than the document, `display_name`
// may be replaced by the request, and `omitted` names what the source held
// and the new tenant never receives.
function withoutRenamedFields(document: TenantDocument): unknown {
  return {
    ...document,
    settings: { ...document.settings, display_name: null },
    omitted: [],
  };
}

describe('POST /admin/tenant-imports', () => {
  it('re-exports what it imported, apart from the name and what cannot travel', async () => {
    const source = await seededSource();
    const token = await operatorToken();
    const original = await exportOf(token, source.name);
    // What the comparison below would be holding if the seed had silently
    // not arrived in the export.
    expect(original.subjects?.map((subject) => [subject.username, subject.enabled])).toEqual([
      ['grace', true],
      ['hana', false],
      ['ivan', true],
    ]);
    expect(original.scopes.map((scope) => scope.name)).toContain('billing');
    expect(original.scopes.map((scope) => scope.name)).not.toContain('phone');
    expect(original.groups.map((group) => group.path)).toEqual(['/finance', '/finance/payroll']);
    expect(original.clients.map((client) => client.type).sort()).toEqual([
      'confidential',
      'public',
    ]);
    expect(original.smtp).not.toBeNull();
    const name = `import-${newId()}`;

    const res = await postImport(token, { name, display_name: 'Imported', document: original });

    expect(res.statusCode, res.payload).toBe(201);
    const answer = res.json<ImportAnswer>();
    expect(answer.tenant.name).toBe(name);
    const reexported = await exportOf(token, name);
    expect(reexported.settings.display_name).toBe('Imported');
    // A subject arrives with no credential, so every one owes a password:
    // `required_actions` gains `update-password` and nothing else changes.
    const expected: TenantDocument = {
      ...original,
      subjects: (original.subjects ?? []).map((subject) => ({
        ...subject,
        required_actions: [
          ...new Set([...subject.required_actions, 'update-password' as const]),
        ].sort(),
      })),
    };
    expect(withoutRenamedFields(reexported)).toEqual(withoutRenamedFields(expected));
  });

  it('answers each confidential client a fresh secret that authenticates at /token', async () => {
    const source = await seededSource();
    const token = await operatorToken();
    const document = await exportOf(token, source.name);
    const name = `import-${newId()}`;

    const answer = (await postImport(token, { name, document })).json<ImportAnswer>();

    const confidential = document.clients.filter((client) => client.type === 'confidential');
    expect(answer.client_secrets.map((entry) => entry.client_id).sort()).toEqual(
      confidential.map((client) => client.client_id).sort(),
    );
    const secret = answer.client_secrets.find((entry) => entry.client_id === source.confidentialId);
    if (secret === undefined) throw new Error('expected a secret for the confidential client');
    const granted = await fixture.http.inject({
      method: 'POST',
      url: `/tenants/${name}/protocol/openid-connect/token`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${secret.client_id}:${secret.secret}`).toString('base64')}`,
      },
      payload: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
    });
    expect(granted.statusCode, granted.payload).toBe(200);
  });

  it('mints the new tenant its own signing key', async () => {
    const source = await seededSource();
    const token = await operatorToken();
    const name = `import-${newId()}`;

    const answer = (
      await postImport(token, { name, document: await exportOf(token, source.name) })
    ).json<ImportAnswer>();

    const kids = async (tenantId: string): Promise<string[]> =>
      withTenant(fixture.app.db, tenantId, async (tx) =>
        (await signingKeyRepository(tx).listPublishable()).map((key) => key.kid),
      );
    const imported = await kids(answer.tenant.id);
    expect(imported).toHaveLength(1);
    expect(await kids(source.id)).not.toContain(imported[0]);
  });

  it('gives imported subjects no credential and an update-password action', async () => {
    const source = await seededSource();
    const token = await operatorToken();
    const name = `import-${newId()}`;

    const answer = (
      await postImport(token, { name, document: await exportOf(token, source.name) })
    ).json<ImportAnswer>();

    await withTenant(fixture.app.db, answer.tenant.id, async (tx) => {
      expect(await tx.select().from(userCredentials)).toEqual([]);
      for (const username of ['grace', 'hana', 'ivan']) {
        const user = await userRepository(tx).byUsername(username);
        if (user === null) throw new Error(`expected ${username}`);
        expect(await requiredActionRepository(tx).pendingFor(user.subject.id)).toContain(
          'update-password',
        );
      }
    });
  });

  it('writes tenant.import into the new tenant’s trail, with no secret in it', async () => {
    const source = await seededSource();
    const token = await operatorToken();
    const document = await exportOf(token, source.name);
    const name = `import-${newId()}`;

    const answer = (await postImport(token, { name, document })).json<ImportAnswer>();

    const rows = await withTenant(fixture.app.db, answer.tenant.id, (tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.action, 'tenant.import')),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.resourceId).toBe(answer.tenant.id);
    expect(rows[0]?.detail).toEqual({
      source_version: 1,
      counts: {
        clients: document.clients.length,
        roles: document.roles.length,
        groups: document.groups.length,
        scopes: document.scopes.length,
        subjects: document.subjects?.length ?? 0,
      },
    });
    for (const { secret } of answer.client_secrets) {
      expect(JSON.stringify(rows)).not.toContain(secret);
    }
  });

  it('lists every problem with its path in one 400, and creates no tenant', async () => {
    const source = await seededSource();
    const token = await operatorToken();
    const document = await exportOf(token, source.name);
    const scopeIndex = document.scopes.findIndex((scope) => scope.name === 'billing');
    const clientIndex = document.clients.findIndex((client) => client.client_id === 'spa');
    const broken: TenantDocument = {
      ...document,
      scopes: document.scopes.map((scope, index) =>
        index === scopeIndex
          ? { ...scope, roles: [{ name: 'no-such-role', client: null }] }
          : scope,
      ),
      clients: document.clients.map((client, index) =>
        index === clientIndex ? { ...client, redirect_uris: ['http://evil.example/cb'] } : client,
      ),
    };
    const name = `import-${newId()}`;

    const res = await postImport(token, { name, document: broken });

    expect(res.statusCode, res.payload).toBe(400);
    const paths = (res.json<ImportRefusal>().errors ?? []).map((error) => error.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        `document.scopes[${String(scopeIndex)}].roles[0]`,
        `document.clients[${String(clientIndex)}].redirect_uris`,
      ]),
    );
    expect(await tenantIdOf(name)).toBeNull();
  });

  it('reports a schema problem with its path', async () => {
    const token = await operatorToken();
    const name = `import-${newId()}`;

    const res = await postImport(token, { name, document: { version: 2, clients: 'none' } });

    expect(res.statusCode).toBe(400);
    const paths = (res.json<ImportRefusal>().errors ?? []).map((error) => error.path);
    expect(paths).toEqual(expect.arrayContaining(['document.version', 'document.clients']));
  });

  it('refuses a built-in the new tenant does not provision, and a minted capability', async () => {
    const source = await seededSource();
    const token = await operatorToken();
    const document = await exportOf(token, source.name);
    const broken: TenantDocument = {
      ...document,
      roles: [
        ...document.roles,
        {
          name: 'manage-tenants',
          client: ADMIN_CLIENT_ID,
          description: null,
          default_for_new_subjects: false,
          builtin: true,
          composites: [],
        },
        {
          name: 'manage-everything',
          client: ADMIN_CLIENT_ID,
          description: null,
          default_for_new_subjects: false,
          builtin: false,
          composites: [],
        },
      ],
    };

    const res = await postImport(token, { name: `import-${newId()}`, document: broken });

    expect(res.statusCode).toBe(400);
    const paths = (res.json<ImportRefusal>().errors ?? []).map((error) => error.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        `document.roles[${String(document.roles.length)}]`,
        `document.roles[${String(document.roles.length + 1)}]`,
      ]),
    );
  });

  it('refuses a default role that reaches an admin capability through a composite', async () => {
    const source = await seededSource();
    const token = await operatorToken();
    const document = await exportOf(token, source.name);
    const memberIndex = document.roles.findIndex((role) => role.name === 'member');
    const broken: TenantDocument = {
      ...document,
      roles: document.roles.map((role, index) =>
        index === memberIndex
          ? { ...role, composites: [{ name: 'billing-auditor', client: null }] }
          : role.name === 'billing-reader'
            ? { ...role, composites: [{ name: 'view-users', client: ADMIN_CLIENT_ID }] }
            : role,
      ),
    };

    const res = await postImport(token, { name: `import-${newId()}`, document: broken });

    expect(res.statusCode).toBe(400);
    const paths = (res.json<ImportRefusal>().errors ?? []).map((error) => error.path);
    expect(paths).toContain(`document.roles[${String(memberIndex)}].default_for_new_subjects`);
  });

  it('refuses a composite cycle and a client carrying a private key member', async () => {
    const source = await seededSource();
    const token = await operatorToken();
    const document = await exportOf(token, source.name);
    const readerIndex = document.roles.findIndex((role) => role.name === 'billing-reader');
    const spaIndex = document.clients.findIndex((client) => client.client_id === 'spa');
    const broken: TenantDocument = {
      ...document,
      roles: document.roles.map((role, index) =>
        index === readerIndex
          ? { ...role, composites: [{ name: 'billing-auditor', client: null }] }
          : role,
      ),
      clients: document.clients.map((client, index) =>
        index === spaIndex
          ? { ...client, jwks: { keys: [{ kty: 'oct', k: 'c2VjcmV0' }] } }
          : client,
      ),
    };

    const res = await postImport(token, { name: `import-${newId()}`, document: broken });

    expect(res.statusCode).toBe(400);
    const paths = (res.json<ImportRefusal>().errors ?? []).map((error) => error.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        `document.roles[${String(readerIndex)}].composites`,
        `document.clients[${String(spaIndex)}].jwks`,
      ]),
    );
  });

  it('refuses a setting outside its range, leaving no tenant behind', async () => {
    const source = await seededSource();
    const token = await operatorToken();
    const document = await exportOf(token, source.name);
    const name = `import-${newId()}`;

    const res = await postImport(token, {
      name,
      document: { ...document, settings: { ...document.settings, password_min_length: 4 } },
    });

    expect(res.statusCode, res.payload).toBe(400);
    expect((res.json<ImportRefusal>().errors ?? []).map((error) => error.path)).toEqual([
      'document.settings',
    ]);
    expect(await tenantIdOf(name)).toBeNull();
  });

  it('refuses a name already in use with 409 before writing anything', async () => {
    const source = await seededSource();
    const token = await operatorToken();
    const document = await exportOf(token, source.name);

    const res = await postImport(token, { name: source.name, document });

    expect(res.statusCode, res.payload).toBe(409);
    const rows = await withTenant(fixture.app.db, source.id, (tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.action, 'tenant.import')),
    );
    expect(rows).toEqual([]);
  });

  it.each(['system', 'count', 'Not-A-Label'])(
    'refuses the name %s with 400 before writing anything',
    async (name) => {
      const source = await seededSource();
      const token = await operatorToken();
      const document = await exportOf(token, source.name);

      const res = await postImport(token, { name, document });

      expect(res.statusCode).toBe(400);
      expect((res.json<ImportRefusal>().errors ?? []).map((error) => error.path)).toEqual(['name']);
    },
  );

  it('refuses a body above the import’s limit with 413', async () => {
    const token = await operatorToken();
    const padding = 'x'.repeat(TENANT_IMPORT_BODY_LIMIT);

    const res = await postImport(token, { name: `import-${newId()}`, document: { padding } });

    expect(res.statusCode).toBe(413);
  });

  it('admits a document above the server’s default body limit', async () => {
    const source = await seededSource();
    const token = await operatorToken();
    const document = await exportOf(token, source.name);
    const padded = {
      ...document,
      roles: document.roles.map((role) =>
        role.name === 'billing-reader' ? { ...role, description: 'x'.repeat(1_100_000) } : role,
      ),
    };

    const res = await postImport(token, { name: `import-${newId()}`, document: padded });

    expect(res.statusCode, res.payload.slice(0, 300)).toBe(201);
  });

  it('writes nothing into another tenant', async () => {
    const source = await seededSource();
    const bystander = await fixture.createTenant(`bystander-${newId()}`);
    const token = await operatorToken();
    const count = async (): Promise<number> =>
      withTenant(fixture.app.db, bystander.id, async (tx) => {
        const scopes = await clientScopeRepository(tx).allForTenant();
        const trail = await tx.select().from(auditEvents);
        return scopes.length + trail.length;
      });
    const before = await count();

    const res = await postImport(token, {
      name: `import-${newId()}`,
      document: await exportOf(token, source.name),
    });

    expect(res.statusCode).toBe(201);
    expect(await count()).toBe(before);
  });
});
