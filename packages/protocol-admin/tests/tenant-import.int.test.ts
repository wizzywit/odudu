import { executionRepository, requiredActionRepository } from '@odudu/authn-flows';
import {
  ASSIGNMENT_LIMIT,
  CLIENT_SCOPE_LIMIT,
  EXPORT_SUBJECT_CAP,
  GROUP_LIMIT,
  groupLimitMessage,
  ROLE_LIMIT,
  roleLimitMessage,
  SCOPE_LIMIT,
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
  WIRE_CLIENTS_PER_TENANT,
} from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import {
  ADMIN_CLIENT_REDIRECT_URI,
  clientOidcConfigRepository,
  tenantLookupRepository,
} from '@odudu/protocol-oidc';
import { eq, sql } from 'drizzle-orm';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FIXTURE_CONSOLE_BASE_URL,
  FIXTURE_CONSOLE_JWKS,
  startAdminFixture,
  type AdminFixture,
} from '#/testing/admin-fixture';

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
      skip_logout_confirmation: true,
      token_exchange_allowed_for_public: true,
      token_exchange_actor_from_other_client: true,
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
      cimdEnabled: true,
      clientRegistrationPolicy: 'mcp',
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
  it('stores a blank display name, from the request or the document, as none', async () => {
    const source = await fixture.createTenant(`blank-src-${newId()}`);
    const token = await operatorToken();
    const original = await exportOf(token, source.name);
    const viaRequest = `blank-a-${newId()}`;
    const first = await postImport(token, {
      name: viaRequest,
      display_name: '   ',
      document: original,
    });
    expect(first.statusCode, first.payload).toBe(201);
    expect((await exportOf(token, viaRequest)).settings.display_name).toBeNull();
    const viaDocument = `blank-b-${newId()}`;
    const second = await postImport(token, {
      name: viaDocument,
      document: { ...original, settings: { ...original.settings, display_name: '  ' } },
    });
    expect(second.statusCode, second.payload).toBe(201);
    expect((await exportOf(token, viaDocument)).settings.display_name).toBeNull();
  });

  it('exports a tenant whose stored display name is longer than the bound a write now has', async () => {
    const source = await fixture.createTenant(`legacy-src-${newId()}`);
    await fixture.owner
      .sql`update tenants set display_name = ${'x'.repeat(300)} where id = ${source.id}`;
    const token = await operatorToken();
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${source.name}/export`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode, res.payload).toBe(200);
    expect(res.json<{ settings: { display_name: string } }>().settings.display_name).toBe(
      'x'.repeat(300),
    );
  });

  it('refuses a document display name of 257 characters, naming it, and takes 256', async () => {
    const source = await fixture.createTenant(`bound-src-${newId()}`);
    const token = await operatorToken();
    const original = await exportOf(token, source.name);
    const withName = (display_name: string) => ({
      ...original,
      settings: { ...original.settings, display_name },
    });
    const refused = await postImport(token, {
      name: `bound-a-${newId()}`,
      document: withName('x'.repeat(257)),
    });
    expect(refused.statusCode).toBe(400);
    expect((refused.json<ImportRefusal>().errors ?? []).map((error) => error.path)).toEqual([
      'document.settings.display_name',
    ]);
    const name = `bound-b-${newId()}`;
    const taken = await postImport(token, { name, document: withName('x'.repeat(256)) });
    expect(taken.statusCode, taken.payload).toBe(201);
    expect((await exportOf(token, name)).settings.display_name).toBe('x'.repeat(256));
  });

  it('refuses a request display name of 257 characters, and makes no tenant', async () => {
    const source = await fixture.createTenant(`bound-req-${newId()}`);
    const token = await operatorToken();
    const original = await exportOf(token, source.name);
    const name = `bound-c-${newId()}`;
    const refused = await postImport(token, {
      name,
      display_name: 'x'.repeat(257),
      document: original,
    });
    expect(refused.statusCode).toBe(400);
    expect(await tenantIdOf(name)).toBeNull();
  });

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
    expect(original.settings.cimd_enabled).toBe(true);
    expect(original.registration_policy.client_registration_policy).toBe('mcp');
    expect(original.scopes.map((scope) => scope.name)).toContain('billing');
    expect(original.scopes.map((scope) => scope.name)).not.toContain('phone');
    expect(original.groups.map((group) => group.path)).toEqual(['/finance', '/finance/payroll']);
    // The seed's two clients and the built-in MCP client every tenant carries.
    expect(original.clients.map((client) => client.type).sort()).toEqual([
      'confidential',
      'public',
      'public',
    ]);
    expect(original.smtp).not.toBeNull();
    expect(
      original.clients.map((client) => [client.client_id, client.skip_logout_confirmation]),
    ).toEqual(expect.arrayContaining([['spa', true]]));
    expect(original.clients.find((client) => client.client_id === 'spa')).toMatchObject({
      token_exchange_allowed_for_public: true,
      token_exchange_actor_from_other_client: true,
    });
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

  describe('service accounts', () => {
    async function tenantWithAccounts(): Promise<{ name: string; token: string }> {
      const t = await fixture.createTenant(`acct-${newId()}`);
      const token = await operatorToken();
      const make = async (clientId: string, grants: string[]): Promise<string> => {
        const res = await fixture.http.inject({
          method: 'POST',
          url: `/admin/tenants/${t.name}/clients`,
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          payload: JSON.stringify({
            client_id: clientId,
            redirect_uris: ['https://app.example/cb'],
            grant_types: grants,
            token_endpoint_auth_method: 'client_secret_basic',
          }),
        });
        expect(res.statusCode, res.payload).toBe(201);
        return (
          res.json<{ id: string; service_subject_id: string | null }>().service_subject_id ?? ''
        );
      };
      const active = await make('active', ['authorization_code', 'client_credentials']);
      const idle = await make('idle', ['authorization_code', 'client_credentials']);
      await withTenant(fixture.app.db, t.id, async (tx) => {
        const role = await roleRepository(tx).create({ tenantId: t.id, name: 'reader' });
        await roleRepository(tx).assignToSubject(active, role.id);
        await roleRepository(tx).assignToSubject(idle, role.id);
        await tx.execute(
          sql`update client_oidc_config set grant_types = ARRAY['authorization_code']
               where client_id = (select id from clients where client_id = 'idle')`,
        );
        await tx.execute(
          sql`update clients set service_account_idle = true where client_id = 'idle'`,
        );
      });
      return { name: t.name, token };
    }

    it('exports roles for an account in use, none for an idle one, and names the omission', async () => {
      const { name, token } = await tenantWithAccounts();
      const document = await exportOf(token, name);
      const roles = (clientId: string) =>
        document.clients.find((client) => client.client_id === clientId)?.service_account_roles;
      expect(roles('active')).toEqual([{ name: 'reader', client: null }]);
      expect(roles('idle')).toEqual([]);
      const index = document.clients.findIndex((client) => client.client_id === 'idle');
      expect(document.omitted).toContain(`clients[${String(index)}].service_account_roles`);
    });

    it('imports its own export and exports the same document again', async () => {
      const { name, token } = await tenantWithAccounts();
      const original = await exportOf(token, name);
      const copy = `import-${newId()}`;
      const res = await postImport(token, { name: copy, document: original });
      expect(res.statusCode, res.payload).toBe(201);
      expect(withoutRenamedFields(await exportOf(token, copy))).toEqual(
        withoutRenamedFields(original),
      );
    });

    it('accepts a backup that lists roles for a client without the grant, and drops them', async () => {
      const { name, token } = await tenantWithAccounts();
      const original = await exportOf(token, name);
      const legacy: TenantDocument = {
        ...original,
        clients: original.clients.map((client) =>
          client.client_id === 'idle'
            ? { ...client, service_account_roles: [{ name: 'reader', client: null }] }
            : client,
        ),
      };
      const copy = `import-${newId()}`;
      const res = await postImport(token, { name: copy, document: legacy });
      expect(res.statusCode, res.payload).toBe(201);
      const again = await exportOf(token, copy);
      expect(again.clients.find((c) => c.client_id === 'idle')?.service_account_roles).toEqual([]);
    });

    async function importWith(
      clientId: string,
      change: Partial<TenantDocument['clients'][number]>,
    ): Promise<{ statusCode: number; paths: string[] }> {
      const { name, token } = await tenantWithAccounts();
      const original = await exportOf(token, name);
      const edited: TenantDocument = {
        ...original,
        clients: original.clients.map((client) =>
          client.client_id === clientId ? { ...client, ...change } : client,
        ),
      };
      const res = await postImport(token, { name: `import-${newId()}`, document: edited });
      const errors = res.statusCode === 400 ? (res.json<ImportRefusal>().errors ?? []) : [];
      return { statusCode: res.statusCode, paths: errors.map((error) => error.path) };
    }

    it('drops a role a client without the grant lists even when the backup lost the role', async () => {
      const outcome = await importWith('idle', {
        service_account_roles: [{ name: 'deleted-long-ago', client: null }],
      });
      expect(outcome.statusCode).toBe(201);
    });

    it('still refuses a missing role listed for a client that holds the grant', async () => {
      const outcome = await importWith('active', {
        service_account_roles: [{ name: 'deleted-long-ago', client: null }],
      });
      expect(outcome.statusCode).toBe(400);
      expect(outcome.paths.some((path) => path.endsWith('.service_account_roles[0]'))).toBe(true);
    });

    it('still refuses roles listed for a public client', async () => {
      const outcome = await importWith('idle', {
        type: 'public',
        token_endpoint_auth_method: 'none',
        service_account_roles: [{ name: 'reader', client: null }],
      });
      expect(outcome.statusCode).toBe(400);
      expect(outcome.paths.some((path) => path.endsWith('.service_account_roles'))).toBe(true);
    });
  });

  it('exports a tenant holding a metadata document client and a role it owns, and imports the document', async () => {
    const source = await seededSource();
    const token = await operatorToken();
    await withTenant(fixture.app.db, source.id, async (tx) => {
      const created = await clientRepository(tx).create({
        tenantId: source.id,
        clientId: 'https://notes.example.com/client.json',
        name: 'Notes',
        type: 'public',
        secretHash: null,
        registrationOrigin: 'cimd',
        metadataUsedAt: new Date(),
      });
      await roleRepository(tx).create({
        tenantId: source.id,
        name: 'notes-editor',
        clientId: created.id,
      });
    });

    const document = await exportOf(token, source.name);

    expect(document.clients.map((client) => client.client_id)).not.toContain(
      'https://notes.example.com/client.json',
    );
    expect(document.roles.map((role) => role.client)).not.toContain(
      'https://notes.example.com/client.json',
    );
    const res = await postImport(token, { name: `import-${newId()}`, document });
    expect(res.statusCode, res.payload).toBe(201);
  });

  async function mcpClientRows(tenantId: string) {
    return withTenant(fixture.app.db, tenantId, async (tx) => {
      const repository = clientRepository(tx);
      const client = await repository.byClientId('odudu-mcp');
      const config =
        client === null ? null : await clientOidcConfigRepository(tx).byClientId(client.id);
      const held =
        client === null ? [] : await clientScopeRepository(tx).forClientByAssignment(client.id);
      return { client, config, held };
    });
  }

  it('carries the built-in MCP client in the export and reproduces it on import, once', async () => {
    const source = await fixture.createTenant(`mcp-src-${newId()}`);
    const token = await operatorToken();
    const original = await exportOf(token, source.name);
    const exported = original.clients.find((client) => client.client_id === 'odudu-mcp');
    expect(exported).toMatchObject({
      type: 'public',
      redirect_uris: ['http://127.0.0.1', 'http://[::1]'],
      grant_types: ['authorization_code', 'refresh_token'],
      audiences: ['urn:odudu:params:admin-api'],
      consent_required: true,
    });
    expect(
      original.scopes
        .filter((scope) => scope.name.startsWith('mcp:'))
        .map((scope) => [scope.name, scope.clients.find((c) => c.client_id === 'odudu-mcp')]),
    ).toEqual([
      ['mcp:read', { client_id: 'odudu-mcp', assignment: 'default' }],
      ['mcp:write', { client_id: 'odudu-mcp', assignment: 'optional' }],
    ]);

    // The new tenant is provisioned with its own built-in client and the
    // document describes one too: neither a conflict nor a second client.
    const name = `mcp-copy-${newId()}`;
    const res = await postImport(token, { name, document: original });
    expect(res.statusCode, res.payload).toBe(201);
    const imported = await tenantIdOf(name);
    const rows = await mcpClientRows(imported ?? '');
    expect(rows.client).toMatchObject({ type: 'public', secretHash: null, builtinMcp: true });
    expect(rows.config?.redirectUris).toEqual(['http://127.0.0.1', 'http://[::1]']);
    expect(Object.fromEntries(rows.held.map((h) => [h.scope.name, h.assignment]))).toMatchObject({
      'mcp:read': 'default',
      'mcp:write': 'optional',
    });
    const count = await fixture.owner.sql<{ n: number }[]>`
      select count(*)::int as n from clients where tenant_id = ${imported ?? ''} and client_id = 'odudu-mcp'`;
    expect(count[0]?.n).toBe(1);
    expect(withoutRenamedFields(await exportOf(token, name))).toEqual(
      withoutRenamedFields(original),
    );
  });

  it.each([
    ['a confidential type', { type: 'confidential' }, 'type'],
    [
      'a client_credentials grant',
      { grant_types: ['authorization_code', 'client_credentials'] },
      'grant_types',
    ],
    [
      'a secret-bearing auth method',
      { token_endpoint_auth_method: 'client_secret_basic', type: 'confidential' },
      'type',
    ],
    ['an https redirect', { redirect_uris: ['https://evil.example/cb'] }, 'redirect_uris'],
    ['localhost', { redirect_uris: ['http://localhost'] }, 'redirect_uris'],
    ['a loopback with a port', { redirect_uris: ['http://127.0.0.1:8080'] }, 'redirect_uris'],
    ['a loopback with a path', { redirect_uris: ['http://127.0.0.1/cb'] }, 'redirect_uris'],
  ])('refuses an odudu-mcp client with %s, creating no tenant', async (_label, change, field) => {
    const source = await fixture.createTenant(`mcp-bad-${newId()}`);
    const token = await operatorToken();
    const original = await exportOf(token, source.name);
    const document = {
      ...original,
      clients: original.clients.map((client) =>
        client.client_id === 'odudu-mcp' ? { ...client, ...change } : client,
      ),
    };
    const name = `mcp-bad-copy-${newId()}`;
    const res = await postImport(token, { name, document });
    expect(res.statusCode, res.payload).toBe(400);
    const errors = res.json<{ errors: { path: string; message: string }[] }>().errors;
    expect(errors.some((e) => e.path.includes('document.clients[') && e.path.endsWith(field))).toBe(
      true,
    );
    expect(await tenantIdOf(name)).toBeNull();
  });

  it('keeps a disabled built-in MCP client disabled across an import', async () => {
    const source = await fixture.createTenant(`mcp-off-${newId()}`);
    const token = await operatorToken();
    await withTenant(fixture.app.db, source.id, async (tx) => {
      const client = await clientRepository(tx).byClientId('odudu-mcp');
      if (client === null) throw new Error('expected odudu-mcp');
      await clientRepository(tx).update(client.id, { enabled: false });
    });
    const name = `mcp-off-copy-${newId()}`;
    const res = await postImport(token, { name, document: await exportOf(token, source.name) });
    expect(res.statusCode, res.payload).toBe(201);
    const rows = await mcpClientRows((await tenantIdOf(name)) ?? '');
    expect(rows.client).toMatchObject({ enabled: false, builtinMcp: true });
  });

  it('leaves the provisioned MCP client in place for a document that predates it', async () => {
    const source = await fixture.createTenant(`mcp-old-${newId()}`);
    const token = await operatorToken();
    const original = await exportOf(token, source.name);
    const older: TenantDocument = {
      ...original,
      clients: original.clients.filter((client) => client.client_id !== 'odudu-mcp'),
      scopes: original.scopes.map((scope) => ({
        ...scope,
        clients: scope.clients.filter((entry) => entry.client_id !== 'odudu-mcp'),
      })),
    };
    const name = `mcp-old-copy-${newId()}`;
    const res = await postImport(token, { name, document: older });
    expect(res.statusCode, res.payload).toBe(201);
    const rows = await mcpClientRows((await tenantIdOf(name)) ?? '');
    expect(rows.client).toMatchObject({ builtinMcp: true, enabled: true });
    expect(rows.config).not.toBeNull();
  });

  it('carries a tenant’s languages and default across, and refuses a default outside the list', async () => {
    const source = await fixture.createTenant(`lang-src-${newId()}`);
    const tenantToken = await fixture.adminToken(source.name, ['manage-tenant']);
    const patched = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${source.name}/settings`,
      headers: { authorization: `Bearer ${tenantToken}`, 'content-type': 'application/json' },
      payload: { supported_locales: ['en', 'fr-CA', 'ar'], default_locale: 'fr-CA' },
    });
    expect(patched.statusCode, patched.payload).toBe(200);
    const token = await operatorToken();
    const original = await exportOf(token, source.name);
    expect(original.settings).toMatchObject({
      supported_locales: ['en', 'fr-CA', 'ar'],
      default_locale: 'fr-CA',
    });

    const name = `lang-${newId()}`;
    const imported = await postImport(token, { name, document: original });
    expect(imported.statusCode, imported.payload).toBe(201);
    expect((await exportOf(token, name)).settings).toMatchObject({
      supported_locales: ['en', 'fr-CA', 'ar'],
      default_locale: 'fr-CA',
    });

    const refused = await postImport(token, {
      name: `lang-bad-${newId()}`,
      document: {
        ...original,
        settings: {
          ...original.settings,
          supported_locales: ['en', 'en_US'],
          default_locale: 'de',
        },
      },
    });
    expect(refused.statusCode).toBe(400);
    expect((refused.json<ImportRefusal>().errors ?? []).map((error) => error.path).sort()).toEqual([
      'document.settings.default_locale',
      'document.settings.supported_locales',
    ]);
  });

  describe('message overrides', () => {
    async function sourceWith(
      overrides: { locale: string; key: string; message: string }[],
    ): Promise<{ id: string; name: string }> {
      const t = await fixture.createTenant(`ovr-src-${newId()}`);
      for (const o of overrides) {
        await fixture.owner.sql`
          insert into message_overrides (tenant_id, locale, key, message)
          values (${t.id}, ${o.locale}, ${o.key}, ${o.message})`;
      }
      return t;
    }
    const stored = async (tenantId: string) =>
      fixture.owner.sql<{ locale: string; key: string; message: string }[]>`
        select locale, key, message from message_overrides
         where tenant_id = ${tenantId} order by locale, key`;

    it('travel with the document, in locale and key order', async () => {
      const source = await sourceWith([
        { locale: 'fr', key: 'login.title', message: 'Connexion' },
        { locale: 'de', key: 'login.title', message: '<b>Anmelden</b> {x}' },
      ]);
      const token = await operatorToken();
      const original = await exportOf(token, source.name);
      expect(original.message_overrides).toEqual([
        { locale: 'de', key: 'login.title', message: '<b>Anmelden</b> {x}' },
        { locale: 'fr', key: 'login.title', message: 'Connexion' },
      ]);
      const name = `ovr-${newId()}`;
      const res = await postImport(token, { name, document: original });
      expect(res.statusCode, res.payload).toBe(201);
      expect((await exportOf(token, name)).message_overrides).toEqual(original.message_overrides);
      const id = await tenantIdOf(name);
      expect(await stored(id ?? '')).toHaveLength(2);
    });

    it('are absent from an older document, which imports with none', async () => {
      const source = await fixture.createTenant(`old-src-${newId()}`);
      const token = await operatorToken();
      const exported = await exportOf(token, source.name);
      const without = (record: object, ...names: string[]): Record<string, unknown> =>
        Object.fromEntries(Object.entries(record).filter(([name]) => !names.includes(name)));
      const name = `old-${newId()}`;
      const res = await postImport(token, {
        name,
        document: {
          ...without(exported, 'message_overrides'),
          settings: without(exported.settings, 'supported_locales', 'default_locale'),
        },
      });
      expect(res.statusCode, res.payload).toBe(201);
      const again = await exportOf(token, name);
      expect(again.message_overrides).toEqual([]);
      expect(again.settings).toMatchObject({ supported_locales: ['en'], default_locale: null });
    });

    it('are each checked as the admin API checks one, all reported with their paths', async () => {
      const source = await fixture.createTenant(`bad-src-${newId()}`);
      const token = await operatorToken();
      const original = await exportOf(token, source.name);
      const res = await postImport(token, {
        name: `bad-${newId()}`,
        document: {
          ...original,
          message_overrides: [
            { locale: 'fr', key: 'login.nonesuch', message: 'x' },
            { locale: 'fr', key: 'login.title', message: 'Hi {name' },
            { locale: 'fr', key: 'login.submit', message: 'ok' },
            { locale: 'FR', key: 'login.submit', message: 'again' },
          ],
        },
      });
      expect(res.statusCode).toBe(400);
      expect((res.json<ImportRefusal>().errors ?? []).map((e) => e.path).sort()).toEqual([
        'document.message_overrides[0].key',
        'document.message_overrides[1].message',
        'document.message_overrides[3]',
      ]);
    });

    it('refuse a 501st, naming how many the document holds, and create no tenant', async () => {
      const source = await fixture.createTenant(`over-src-${newId()}`);
      const token = await operatorToken();
      const original = await exportOf(token, source.name);
      const name = `over-${newId()}`;
      const one = { locale: 'fr', key: 'login.title', message: 'x' };
      const res = await postImport(token, {
        name,
        document: { ...original, message_overrides: Array.from({ length: 501 }, () => one) },
      });
      expect(res.statusCode).toBe(400);
      expect(res.payload).toContain('501 entries, at most 500');
      expect(await tenantIdOf(name)).toBeNull();
    });

    it('carry a full 500 through an export and an import', async () => {
      const t = await fixture.createTenant(`full-src-${newId()}`);
      // 100 two-letter locales of five keys each.
      await fixture.owner.sql`
        insert into message_overrides (tenant_id, locale, key, message)
        select ${t.id}::uuid, chr(97 + l / 26) || chr(97 + l % 26), k, 'x'
          from generate_series(0, 99) l,
               unnest(array['login.title', 'login.submit', 'login.username',
                            'login.password', 'login.verify']) k`;
      const token = await operatorToken();
      const original = await exportOf(token, t.name);
      expect(original.message_overrides).toHaveLength(500);
      const name = `full-${newId()}`;
      const res = await postImport(token, { name, document: original });
      expect(res.statusCode, res.payload).toBe(201);
      expect(await stored((await tenantIdOf(name)) ?? '')).toHaveLength(500);
    });
  });

  it('counts only the clients an operator made against the max_clients it carries', async () => {
    const source = await fixture.createTenant(`cap-src-${newId()}`);
    const token = await operatorToken();
    const original = await exportOf(token, source.name);
    const base = original.clients.find((client) => client.client_id === 'odudu-mcp');
    if (base === undefined) throw new Error('fixture: a tenant exports no built-in MCP client');
    const made = (n: number, origin: 'anonymous' | 'operator') => ({
      ...base,
      client_id: `${origin}-${String(n)}`,
      registration_origin: origin,
    });
    const document = (clients: TenantDocument['clients']): TenantDocument => ({
      ...original,
      settings: { ...original.settings, max_clients: 2 },
      clients,
    });
    const selfRegistered = [1, 2, 3].map((n) => made(n, 'anonymous'));
    const ok = await postImport(token, {
      name: `cap-ok-${newId()}`,
      document: document([...original.clients, ...selfRegistered]),
    });
    expect(ok.statusCode, ok.payload).toBe(201);
    const refused = await postImport(token, {
      name: `cap-no-${newId()}`,
      document: document([...original.clients, made(2, 'operator')]),
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.payload).toContain('max_clients is 2');
  });

  it('refuses a document holding more self-registered clients than the tenant admits', async () => {
    const source = await fixture.createTenant(`wire-src-${newId()}`);
    const token = await operatorToken();
    const original = await exportOf(token, source.name);
    const base = original.clients.find((client) => client.client_id === 'odudu-mcp');
    if (base === undefined) throw new Error('fixture: a tenant exports no built-in MCP client');
    const selfRegistered = (count: number) =>
      Array.from({ length: count }, (_, n) => ({
        ...base,
        client_id: `self-${String(n)}`,
        registration_origin: 'anonymous' as const,
      }));
    const document = (count: number): TenantDocument => ({
      ...original,
      clients: [...original.clients, ...selfRegistered(count)],
    });
    const refused = await postImport(token, {
      name: `wire-no-${newId()}`,
      document: document(WIRE_CLIENTS_PER_TENANT + 1),
    });
    expect(refused.statusCode, refused.payload).toBe(400);
    expect(refused.payload).toContain('document.clients');
    expect(refused.payload).toContain(String(WIRE_CLIENTS_PER_TENANT + 1));
    expect(refused.payload).toContain(String(WIRE_CLIENTS_PER_TENANT));
    const ok = await postImport(token, {
      name: `wire-ok-${newId()}`,
      document: document(WIRE_CLIENTS_PER_TENANT),
    });
    expect(ok.statusCode, ok.payload).toBe(201);
  });

  it('refuses a self-registered client whose redirect address is not a URL', async () => {
    const source = await fixture.createTenant(`bad-src-${newId()}`);
    const token = await operatorToken();
    const original = await exportOf(token, source.name);
    const base = original.clients.find((client) => client.client_id === 'odudu-mcp');
    if (base === undefined) throw new Error('fixture: a tenant exports no built-in MCP client');
    const refused = await postImport(token, {
      name: `bad-${newId()}`,
      document: {
        ...original,
        clients: [
          ...original.clients,
          {
            ...base,
            client_id: 'self-registered',
            registration_origin: 'anonymous',
            redirect_uris: ['not a url'],
          },
        ],
      },
    });
    expect(refused.statusCode, refused.payload).toBe(400);
    expect(refused.payload).toContain('.redirect_uris');
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

  it("registers the console's URIs on the imported tenant's admin client", async () => {
    const source = await seededSource();
    const token = await operatorToken();
    const answer = (
      await postImport(token, {
        name: `import-${newId()}`,
        document: await exportOf(token, source.name),
      })
    ).json<ImportAnswer>();

    const config = await withTenant(fixture.app.db, answer.tenant.id, async (tx) => {
      const client = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
      if (client === null) throw new Error('the admin client was not provisioned');
      return clientOidcConfigRepository(tx).byClientId(client.id);
    });
    expect(config?.redirectUris).toEqual([
      ADMIN_CLIENT_REDIRECT_URI,
      `${FIXTURE_CONSOLE_BASE_URL}/console/auth/callback`,
    ]);
    expect(config?.postLogoutRedirectUris).toEqual([`${FIXTURE_CONSOLE_BASE_URL}/console/`]);
  });

  it("registers the console's key on the imported tenant's admin client", async () => {
    const source = await seededSource();
    const token = await operatorToken();
    const answer = (
      await postImport(token, {
        name: `import-${newId()}`,
        document: await exportOf(token, source.name),
      })
    ).json<ImportAnswer>();

    const stored = await withTenant(fixture.app.db, answer.tenant.id, async (tx) => {
      const client = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
      if (client === null) throw new Error('the admin client was not provisioned');
      return { client, config: await clientOidcConfigRepository(tx).byClientId(client.id) };
    });
    expect(stored.client.type).toBe('confidential');
    expect(stored.config).toMatchObject({
      tokenEndpointAuthMethod: 'private_key_jwt',
      jwks: FIXTURE_CONSOLE_JWKS,
    });
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
        message_overrides: document.message_overrides.length,
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

  it('refuses a document that hands every new subject more roles than a subject may hold', async () => {
    const source = await seededSource();
    const token = await operatorToken();
    const document = await exportOf(token, source.name);
    const broken: TenantDocument = {
      ...document,
      roles: [
        ...document.roles,
        ...Array.from({ length: ASSIGNMENT_LIMIT + 1 }, (_, n) => ({
          name: `default-${String(n)}`,
          client: null,
          description: null,
          default_for_new_subjects: true,
          builtin: false,
          composites: [],
        })),
      ],
    };

    const res = await postImport(token, { name: `import-${newId()}`, document: broken });

    expect(res.statusCode).toBe(400);
    const errors = res.json<ImportRefusal>().errors ?? [];
    expect(errors.map((error) => error.path)).toContain('document.roles');
    const message = errors.find((error) => error.path === 'document.roles')?.message ?? '';
    expect(message).toMatch(/^\d{3} roles are handed to every new subject, at most 200$/u);
  });

  it('names the limit and the count when a set in the document is over it', async () => {
    const source = await seededSource();
    const token = await operatorToken();
    const document = await exportOf(token, source.name);
    const [first, ...rest] = document.roles;
    if (first === undefined) throw new Error('the source has no role');
    const broken: TenantDocument = {
      ...document,
      roles: [
        {
          ...first,
          composites: Array.from({ length: ASSIGNMENT_LIMIT + 1 }, (_, n) => ({
            name: `nested-${String(n)}`,
            client: null,
          })),
        },
        ...rest,
      ],
    };

    const res = await postImport(token, { name: `import-${newId()}`, document: broken });

    expect(res.statusCode).toBe(400);
    const errors = res.json<ImportRefusal>().errors ?? [];
    const named = errors.find((error) => error.path === 'document.roles[0].composites');
    expect(named?.message).toContain(String(ASSIGNMENT_LIMIT + 1));
    expect(named?.message).toContain(String(ASSIGNMENT_LIMIT));
  });

  it('refuses a document that defines more roles than a tenant may, in the words a create is refused with', async () => {
    const source = await seededSource();
    const token = await operatorToken();
    const document = await exportOf(token, source.name);
    const broken: TenantDocument = {
      ...document,
      roles: [
        ...document.roles,
        ...Array.from({ length: ROLE_LIMIT }, (_, n) => ({
          name: `bulk-${String(n)}`,
          client: null,
          description: null,
          default_for_new_subjects: false,
          builtin: false,
          composites: [],
        })),
      ],
    };

    const res = await postImport(token, { name: `import-${newId()}`, document: broken });

    expect(res.statusCode).toBe(400);
    const errors = res.json<ImportRefusal>().errors ?? [];
    const named = errors.find((error) => error.path === 'document.roles');
    expect(named?.message).toContain(roleLimitMessage());
  });

  it('counts the capability roles every tenant is provisioned with: exactly the limit in custom roles is too many', async () => {
    const source = await seededSource();
    const token = await operatorToken();
    const document = await exportOf(token, source.name);
    const broken: TenantDocument = {
      ...document,
      roles: Array.from({ length: ROLE_LIMIT }, (_, n) => ({
        name: `custom-${String(n)}`,
        client: null,
        description: null,
        default_for_new_subjects: false,
        builtin: false,
        composites: [],
      })),
    };

    const res = await postImport(token, { name: `import-${newId()}`, document: broken });

    expect(res.statusCode).toBe(400);
    const errors = res.json<ImportRefusal>().errors ?? [];
    expect(errors.find((error) => error.path === 'document.roles')?.message).toContain(
      roleLimitMessage(),
    );
  });

  it('counts a capability role the document carries once, so the limit is reached and not passed', async () => {
    const source = await seededSource();
    const token = await operatorToken();
    const document = await exportOf(token, source.name);
    const custom = ROLE_LIMIT - document.roles.length;
    const atTheLimit: TenantDocument = {
      ...document,
      roles: [
        ...document.roles,
        ...Array.from({ length: custom }, (_, n) => ({
          name: `custom-${String(n)}`,
          client: null,
          description: null,
          default_for_new_subjects: false,
          builtin: false,
          composites: [],
        })),
      ],
    };

    const res = await postImport(token, { name: `import-${newId()}`, document: atTheLimit });

    expect(res.statusCode, res.payload.slice(0, 300)).toBe(201);
  });

  it('refuses a document that defines more groups than a tenant may, in the same words', async () => {
    const source = await seededSource();
    const token = await operatorToken();
    const document = await exportOf(token, source.name);
    const broken: TenantDocument = {
      ...document,
      groups: [
        ...document.groups,
        ...Array.from({ length: GROUP_LIMIT }, (_, n) => ({
          path: `/bulk-${String(n)}`,
          description: null,
          default_for_new_subjects: false,
          roles: [],
        })),
      ],
    };

    const res = await postImport(token, { name: `import-${newId()}`, document: broken });

    expect(res.statusCode).toBe(400);
    const errors = res.json<ImportRefusal>().errors ?? [];
    const named = errors.find((error) => error.path === 'document.groups');
    expect(named?.message).toContain(groupLimitMessage());
  });

  it('refuses a document that defines more scopes than a tenant may', async () => {
    const source = await seededSource();
    const token = await operatorToken();
    const document = await exportOf(token, source.name);
    const broken: TenantDocument = {
      ...document,
      scopes: [
        ...document.scopes,
        ...Array.from({ length: SCOPE_LIMIT }, (_, n) => ({
          name: `bulk-${String(n)}`,
          description: null,
          include_in_id_token: false,
          include_in_access_token: false,
          default_client_assignment: null,
          consent_text: null,
          description_i18n: {},
          consent_text_i18n: {},
          display_order: 0,
          builtin: false,
          roles: [],
          mappers: [],
          clients: [],
        })),
      ],
    };

    const res = await postImport(token, { name: `import-${newId()}`, document: broken });

    expect(res.statusCode).toBe(400);
    const paths = (res.json<ImportRefusal>().errors ?? []).map((error) => error.path);
    expect(paths).toContain('document.scopes');
  });

  it('refuses a document marking more scopes for every new client than a client may carry', async () => {
    const source = await seededSource();
    const token = await operatorToken();
    const document = await exportOf(token, source.name);
    const broken: TenantDocument = {
      ...document,
      scopes: [
        ...document.scopes,
        ...Array.from({ length: CLIENT_SCOPE_LIMIT + 1 }, (_, n) => ({
          name: `marked-${String(n)}`,
          description: null,
          include_in_id_token: false,
          include_in_access_token: false,
          default_client_assignment: 'default' as const,
          consent_text: null,
          description_i18n: {},
          consent_text_i18n: {},
          display_order: 0,
          builtin: false,
          roles: [],
          mappers: [],
          clients: [],
        })),
      ],
    };

    const res = await postImport(token, { name: `import-${newId()}`, document: broken });

    expect(res.statusCode).toBe(400);
    const errors = res.json<ImportRefusal>().errors ?? [];
    const message = errors.find((error) => error.path === 'document.scopes')?.message ?? '';
    expect(message).toMatch(/^\d{3} scopes are assigned to every new client, at most 200$/u);
  });

  it('refuses a client the document gives more scopes than a client may carry', async () => {
    const source = await seededSource();
    const token = await operatorToken();
    const document = await exportOf(token, source.name);
    const [client] = document.clients;
    if (client === undefined) throw new Error('the source has no client');
    const broken: TenantDocument = {
      ...document,
      scopes: [
        ...document.scopes,
        ...Array.from({ length: CLIENT_SCOPE_LIMIT + 1 }, (_, n) => ({
          name: `carried-${String(n)}`,
          description: null,
          include_in_id_token: false,
          include_in_access_token: false,
          default_client_assignment: null,
          consent_text: null,
          description_i18n: {},
          consent_text_i18n: {},
          display_order: 0,
          builtin: false,
          roles: [],
          mappers: [],
          clients: [{ client_id: client.client_id, assignment: 'optional' as const }],
        })),
      ],
    };

    const res = await postImport(token, { name: `import-${newId()}`, document: broken });

    expect(res.statusCode).toBe(400);
    const errors = res.json<ImportRefusal>().errors ?? [];
    const message =
      errors.find((error) => error.path === `document.clients[0].scopes`)?.message ?? '';
    expect(message).toMatch(/holds \d{3} scopes, at most 200$/u);
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

  it(`refuses more than ${String(EXPORT_SUBJECT_CAP)} subjects at document.subjects, naming P7`, async () => {
    const source = await seededSource();
    const token = await operatorToken();
    const document = await exportOf(token, source.name);
    const grace = (document.subjects ?? []).find((subject) => subject.username === 'grace');
    if (grace === undefined) throw new Error('expected seededSource to hold grace');
    const name = `import-${newId()}`;
    const subjects = Array.from({ length: EXPORT_SUBJECT_CAP + 1 }, (_, index) => ({
      ...grace,
      username: `user-${String(index)}`,
      email: null,
    }));

    const res = await postImport(token, {
      name,
      document: {
        ...document,
        settings: { ...document.settings, password_min_length: 4 },
        subjects,
      },
    });

    expect(res.statusCode).toBe(400);
    const errors = res.json<ImportRefusal>().errors ?? [];
    expect(errors.map((error) => error.path)).toEqual(
      expect.arrayContaining(['document.subjects', 'document.settings.password_min_length']),
    );
    const cap = errors.find((error) => error.path === 'document.subjects');
    expect(cap?.message).toContain(`more than ${String(EXPORT_SUBJECT_CAP)} subjects`);
    expect(cap?.message).toContain('P7');
    expect(await tenantIdOf(name)).toBeNull();
  });

  it('refuses a composite on a built-in role beyond what a new tenant provisions', async () => {
    const source = await seededSource();
    const token = await operatorToken();
    const document = await exportOf(token, source.name);
    const viewUsersIndex = document.roles.findIndex(
      (role) => role.builtin && role.name === 'view-users',
    );
    const name = `import-${newId()}`;
    const broken: TenantDocument = {
      ...document,
      roles: document.roles.map((role, index) =>
        index === viewUsersIndex
          ? { ...role, composites: [...role.composites, { name: 'member', client: null }] }
          : role,
      ),
    };

    const res = await postImport(token, { name, document: broken });

    expect(res.statusCode, res.payload).toBe(400);
    const errors = res.json<ImportRefusal>().errors ?? [];
    const extra = errors.find(
      (error) => error.path === `document.roles[${String(viewUsersIndex)}].composites[0]`,
    );
    expect(extra?.message).toContain('view-users');
    expect(await tenantIdOf(name)).toBeNull();
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

  it('refuses out-of-range settings and token lifetimes together, each by its path', async () => {
    const source = await seededSource();
    const token = await operatorToken();
    const document = await exportOf(token, source.name);
    const spaIndex = document.clients.findIndex((client) => client.client_id === 'spa');
    const name = `import-${newId()}`;

    const res = await postImport(token, {
      name,
      document: {
        ...document,
        settings: {
          ...document.settings,
          password_min_length: 4,
          sso_session_idle_seconds: 7200,
          sso_session_max_seconds: 3600,
        },
        clients: document.clients.map((client, index) =>
          index === spaIndex
            ? { ...client, access_token_ttl_seconds: 7200, refresh_token_ttl_seconds: 0 }
            : client,
        ),
      },
    });

    expect(res.statusCode, res.payload).toBe(400);
    expect((res.json<ImportRefusal>().errors ?? []).map((error) => error.path).sort()).toEqual(
      [
        'document.settings.password_min_length',
        'document.settings.sso_session_idle_seconds',
        `document.clients[${String(spaIndex)}].access_token_ttl_seconds`,
        `document.clients[${String(spaIndex)}].refresh_token_ttl_seconds`,
      ].sort(),
    );
    expect(await tenantIdOf(name)).toBeNull();
  });

  it('refuses an smtp port above 65535 alongside another problem, both by path', async () => {
    const source = await seededSource();
    const token = await operatorToken();
    const document = await exportOf(token, source.name);
    if (document.smtp === null) throw new Error('expected seededSource to configure smtp');
    const name = `import-${newId()}`;

    const res = await postImport(token, {
      name,
      document: {
        ...document,
        settings: { ...document.settings, password_min_length: 4 },
        smtp: { ...document.smtp, port: 65536 },
      },
    });

    expect(res.statusCode, res.payload).toBe(400);
    expect((res.json<ImportRefusal>().errors ?? []).map((error) => error.path)).toEqual(
      expect.arrayContaining(['document.smtp.port', 'document.settings.password_min_length']),
    );
    expect(await tenantIdOf(name)).toBeNull();
  });

  it('refuses a grant of a capability the caller does not hold', async () => {
    const source = await seededSource();
    const document = await exportOf(await operatorToken(), source.name);
    const confidentialIndex = document.clients.findIndex(
      (client) => client.client_id === source.confidentialId,
    );
    const graceIndex = (document.subjects ?? []).findIndex(
      (subject) => subject.username === 'grace',
    );
    const broken: TenantDocument = {
      ...document,
      roles: [
        ...document.roles,
        {
          name: 'helpdesk',
          client: null,
          description: null,
          default_for_new_subjects: false,
          builtin: false,
          composites: [{ name: 'manage-users', client: ADMIN_CLIENT_ID }],
        },
      ],
      clients: document.clients.map((client, index) =>
        index === confidentialIndex
          ? {
              ...client,
              service_account_roles: [
                ...client.service_account_roles,
                { name: 'tenant-admin', client: ADMIN_CLIENT_ID },
              ],
            }
          : client,
      ),
      subjects: (document.subjects ?? []).map((subject, index) =>
        index === graceIndex
          ? { ...subject, roles: [...subject.roles, { name: 'helpdesk', client: null }] }
          : subject,
      ),
    };
    const name = `import-${newId()}`;

    const res = await postImport(await fixture.systemAdminToken(['manage-tenants']), {
      name,
      document: broken,
    });

    expect(res.statusCode, res.payload).toBe(400);
    const paths = (res.json<ImportRefusal>().errors ?? []).map((error) => error.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        `document.clients[${String(confidentialIndex)}].service_account_roles`,
        `document.subjects[${String(graceIndex)}].roles`,
      ]),
    );
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
    // A description is bounded, so the bulk is many roles and groups, each at the
    // bound, and as many as a tenant may define.
    const padding = Array.from({ length: ROLE_LIMIT - document.roles.length }, (_, index) => ({
      name: `padding-${String(index)}`,
      client: null,
      description: 'x'.repeat(1_000),
      default_for_new_subjects: false,
      builtin: false,
      composites: [],
    }));
    const groupPadding = Array.from({ length: 1_000 }, (_, index) => ({
      path: `/padding-${String(index)}`,
      description: 'x'.repeat(1_000),
      default_for_new_subjects: false,
      roles: [],
    }));
    const padded = {
      ...document,
      roles: [...document.roles, ...padding],
      groups: [...document.groups, ...groupPadding],
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
