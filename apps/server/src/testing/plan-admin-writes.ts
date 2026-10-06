import { newId } from '@odudu/kernel';
import { type LightMyRequestResponse } from 'fastify';
import { type AdminIds, type AdminTokens } from '#/testing/plan-admin-drives';
import { type Capture } from '#/testing/plan-paths';
import { TARGET_TENANT, type PlanWorld } from '#/testing/plan-world';

interface Call {
  readonly method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly url: string;
  readonly body?: unknown;
  // Fetched first, and sent as If-Match, for the routes that refuse without it.
  readonly etagFrom?: string;
  readonly system?: boolean;
  readonly as?: 'usersOnly' | 'sessionsOnly';
  // The `id` of this call's answer, kept to fill `{name}` in a later call's url.
  readonly saveAs?: string;
  // A body made from what another route answers, for a replacement of a set
  // the tenant already holds.
  readonly bodyFrom?: { readonly url: string; readonly make: (answer: unknown) => unknown };
}

// The mutating routes, each answering through the lookups a write makes: the
// rows a delete cascades to, the sets a replacement reads, the counts a bulk
// pass takes. A victim is a row the volume gave the shape being exercised.
export async function driveAdminWrites(
  world: PlanWorld,
  capture: Capture,
  tokens: AdminTokens,
  ids: AdminIds,
): Promise<void> {
  const T = `/admin/tenants/${TARGET_TENANT}`;
  const sql = world.owner.sql;
  const t = world.tenantId;
  const pick = async (query: Promise<{ id: string }[]>, what: string): Promise<string> => {
    const row = (await query)[0];
    if (row === undefined) throw new Error(`no ${what} to write to`);
    return row.id;
  };
  const victimSubject = await pick(
    sql`select subject_id as id from users where tenant_id = ${t} and username ~ '^user4[0-9]*$' order by username limit 1`,
    'subject',
  );
  const editedSubject = await pick(
    sql`select subject_id as id from users where tenant_id = ${t} and username ~ '^user5[0-9]*$' order by username limit 1`,
    'subject',
  );
  const victimClient = await pick(
    sql`select id from clients where tenant_id = ${t} and client_id ~ '^app-9[0-9]*$' order by client_id limit 1`,
    'client',
  );
  const editedClient = await pick(
    sql`select id from clients where tenant_id = ${t} and client_id ~ '^app-10[0-9]*$' order by client_id limit 1`,
    'client',
  );
  const victimRole = await pick(
    sql`select id from roles where tenant_id = ${t} and name ~ '^role-4[0-9]+$' order by name limit 1`,
    'role',
  );
  const victimGroup = await pick(
    sql`select id from groups where tenant_id = ${t} and name ~ '^group-4[0-9]+$' order by name limit 1`,
    'group',
  );
  const victimScope = await pick(
    sql`select id from client_scopes where tenant_id = ${t} and name ~ '^scope-9[0-9]+$' order by name limit 1`,
    'scope',
  );
  const [small] = await sql<
    { name: string }[]
  >`select name from tenants where name ~ '^tn7[0-9]*$' order by name limit 1`;
  if (small === undefined) throw new Error('no small tenant to delete');
  const bulkIds = (
    await sql<{ id: string }[]>`
      select subject_id as id from users where tenant_id = ${t} and username like 'user1%' limit 50`
  ).map((row) => row.id);

  const one = pick;
  const probe = ids.subject;
  const credential = await one(
    sql`select id from user_credentials where tenant_id = ${t} and subject_id = ${probe} and type = 'webauthn' limit 1`,
    'credential',
  );
  const consentClient = await one(
    sql`select client_id as id from consents where tenant_id = ${t} and subject_id = ${probe} limit 1`,
    'consent',
  );
  const probeSession = await one(
    sql`select id from sessions where tenant_id = ${t} and subject_id = ${probe} limit 1`,
    'session',
  );
  const grantClient = await one(
    sql`select client_id as id from token_grants where tenant_id = ${t} and subject_id = ${probe} limit 1`,
    'grant',
  );
  const roleNamed = (name: string) =>
    one(sql`select id from roles where tenant_id = ${t} and name = ${name}`, name);
  const groupNamed = (name: string) =>
    one(sql`select id from groups where tenant_id = ${t} and name = ${name}`, name);
  const nestedParent = await roleNamed('role-3001');
  const nestedChild = await roleNamed('role-3002');
  const edgeChild = await one(
    sql`select child_role_id as id from role_composites where tenant_id = ${t} and parent_role_id = ${ids.role} limit 1`,
    'composite',
  );
  const defaultRole = await roleNamed('role-3003');
  const defaultGroup = await groupNamed('group-3003');
  const patchedRole = await roleNamed('role-3004');
  const patchedGroup = await groupNamed('group-3004');
  const mappedGroup = await groupNamed('group-3005');
  const patchedScope = await one(
    sql`select id from client_scopes where tenant_id = ${t} and name = 'scope-3'`,
    'scope',
  );
  const scopeClient = await one(
    sql`select id from clients where tenant_id = ${t} and client_id = 'app-20'`,
    'client',
  );
  const secretClient = await one(
    sql`select id from clients where tenant_id = ${t} and client_id = 'app-30' and type = 'confidential'
        union all select id from clients where tenant_id = ${t} and client_id = 'plans-app' limit 1`,
    'confidential client',
  );
  // Made first and exported, since a tenant the volume seeds has no flow or scopes to import.
  const exportable = { name: `made-${newId().slice(-8)}` };

  await sql`
    update users set email = ${`mailed-${newId().slice(-8)}@example.test`}, email_verified = false
     where subject_id = ${editedSubject}`;
  const calls: [string, Call][] = [
    [
      'create a subject',
      { method: 'POST', url: `${T}/subjects`, body: { username: `made-${newId().slice(-8)}` } },
    ],
    [
      'amend a subject',
      { method: 'PATCH', url: `${T}/subjects/${editedSubject}`, body: { enabled: false } },
    ],
    [
      'replace a subject’s roles',
      {
        method: 'PUT',
        url: `${T}/subjects/${editedSubject}/roles`,
        body: { role_ids: [ids.role] },
        etagFrom: `${T}/subjects/${editedSubject}/roles`,
      },
    ],
    [
      'replace a subject’s groups',
      {
        method: 'PUT',
        url: `${T}/subjects/${editedSubject}/groups`,
        body: { group_ids: [ids.group] },
        etagFrom: `${T}/subjects/${editedSubject}/groups`,
      },
    ],
    [
      'end all of a subject’s sessions',
      { method: 'DELETE', url: `${T}/subjects/${editedSubject}/sessions` },
    ],
    ['clear every lockout of the tenant', { method: 'DELETE', url: `${T}/lockouts` }],
    [
      'clear the lockouts as a caller holding one capability',
      { method: 'DELETE', url: `${T}/lockouts`, as: 'usersOnly' },
    ],
    [
      'end every session as a caller holding one capability',
      { method: 'DELETE', url: `${T}/sessions`, as: 'sessionsOnly' },
    ],
    [
      'revoke a client’s grants as a caller holding one capability',
      { method: 'DELETE', url: `${T}/clients/${editedClient}/grants`, as: 'sessionsOnly' },
    ],
    [
      'bulk disable subjects',
      { method: 'POST', url: `${T}/subjects/bulk`, body: { action: 'disable', ids: bulkIds } },
    ],
    [
      'end the sessions of a client',
      { method: 'DELETE', url: `${T}/sessions?client=${victimClient}` },
    ],
    ['delete a subject', { method: 'DELETE', url: `${T}/subjects/${victimSubject}` }],
    [
      'create a client',
      {
        method: 'POST',
        url: `${T}/clients`,
        body: {
          client_id: `made-${newId().slice(-8)}`,
          redirect_uris: ['https://made.example/cb'],
          token_endpoint_auth_method: 'none',
        },
      },
    ],
    [
      'amend a client',
      {
        method: 'PATCH',
        url: `${T}/clients/${editedClient}`,
        body: { name: 'amended' },
        etagFrom: `${T}/clients/${editedClient}`,
      },
    ],
    ['revoke a client’s grants', { method: 'DELETE', url: `${T}/clients/${victimClient}/grants` }],
    ['delete a client', { method: 'DELETE', url: `${T}/clients/${victimClient}` }],
    [
      'create a role',
      { method: 'POST', url: `${T}/roles`, body: { name: `made-${newId().slice(-8)}` } },
    ],
    ['delete a role', { method: 'DELETE', url: `${T}/roles/${victimRole}` }],
    [
      'create a group',
      { method: 'POST', url: `${T}/groups`, body: { name: `made-${newId().slice(-8)}` } },
    ],
    ['delete a group', { method: 'DELETE', url: `${T}/groups/${victimGroup}` }],
    [
      'create a scope',
      { method: 'POST', url: `${T}/scopes`, body: { name: `made-${newId().slice(-8)}` } },
    ],
    ['delete a scope', { method: 'DELETE', url: `${T}/scopes/${victimScope}` }],
    [
      'mint a registration token',
      { method: 'POST', url: `${T}/registration-tokens`, body: { uses: 1, ttl_seconds: 3600 } },
    ],
    [
      'amend the settings',
      {
        method: 'PATCH',
        url: `${T}/settings`,
        body: { access_token_ttl_seconds: 600 },
        etagFrom: `${T}/settings`,
      },
    ],
    [
      'create a tenant',
      {
        method: 'POST',
        url: '/admin/tenants',
        body: { name: exportable.name },
        system: true,
      },
    ],
    [
      'disable a tenant',
      {
        method: 'PATCH',
        url: `/admin/tenants/${small.name}`,
        system: true,
        body: { enabled: false },
      },
    ],
    [
      'delete a tenant',
      { method: 'DELETE', url: `/admin/tenants/${small.name}?confirm=${small.name}`, system: true },
    ],
    [
      'amend a subject’s profile',
      {
        method: 'PATCH',
        url: `${T}/subjects/${editedSubject}/profile`,
        body: { given_name: 'Plan' },
      },
    ],
    [
      'delete a credential',
      { method: 'DELETE', url: `${T}/subjects/${probe}/credentials/${credential}` },
    ],
    [
      'withdraw a consent',
      { method: 'DELETE', url: `${T}/subjects/${probe}/consents/${consentClient}` },
    ],
    ['set a password', { method: 'POST', url: `${T}/subjects/${editedSubject}/password` }],
    [
      'set the tenant’s SMTP',
      {
        method: 'PUT',
        url: `${T}/smtp`,
        body: { host: 'smtp.example.test', port: 587, from_address: 'plans@example.test' },
      },
    ],
    [
      'mail a password reset',
      { method: 'POST', url: `${T}/subjects/${editedSubject}/password-reset` },
    ],
    ['mail a verification', { method: 'POST', url: `${T}/subjects/${editedSubject}/verification` }],
    [
      'mail required actions',
      {
        method: 'POST',
        url: `${T}/subjects/${editedSubject}/actions-email`,
        body: { actions: ['update-password'] },
      },
    ],
    ['clear one lockout', { method: 'DELETE', url: `${T}/subjects/${editedSubject}/lockout` }],
    [
      'delete the recovery codes',
      { method: 'DELETE', url: `${T}/subjects/${editedSubject}/recovery-codes` },
    ],
    [
      'require actions of a subject',
      {
        method: 'PUT',
        url: `${T}/subjects/${editedSubject}/required-actions`,
        body: { actions: ['update-password'] },
        etagFrom: `${T}/subjects/${editedSubject}/required-actions`,
      },
    ],
    [
      'end one session',
      { method: 'DELETE', url: `${T}/subjects/${probe}/sessions/${probeSession}` },
    ],
    [
      'revoke a subject’s grants for one client',
      { method: 'DELETE', url: `${T}/subjects/${probe}/grants/${grantClient}` },
    ],
    [
      'import a tenant',
      {
        method: 'POST',
        url: '/admin/tenant-imports',
        system: true,
        body: { name: `imported-${newId().slice(-8)}`, document: {} },
        bodyFrom: {
          url: `/admin/tenants/${exportable.name}/export`,
          make: (answer: unknown) => ({ name: `imported-${newId().slice(-8)}`, document: answer }),
        },
      },
    ],
    [
      'amend the tenant',
      {
        method: 'PATCH',
        url: `/admin/tenants/${TARGET_TENANT}`,
        system: true,
        body: { display_name: 'Plans' },
      },
    ],
    ['rotate a client secret', { method: 'POST', url: `${T}/clients/${secretClient}/secret` }],
    [
      'revoke a registration token',
      { method: 'DELETE', url: `${T}/registration-tokens/${ids.registrationToken}` },
    ],
    [
      'amend a role',
      {
        method: 'PATCH',
        url: `${T}/roles/${patchedRole}`,
        body: { description: 'amended' },
        etagFrom: `${T}/roles/${patchedRole}`,
      },
    ],
    [
      'nest a role',
      {
        method: 'POST',
        url: `${T}/roles/${nestedParent}/composites`,
        body: { child_role_id: nestedChild },
      },
    ],
    ['unnest a role', { method: 'DELETE', url: `${T}/roles/${ids.role}/composites/${edgeChild}` }],
    [
      'make a role a default',
      { method: 'PUT', url: `${T}/roles/${defaultRole}/default`, body: { default: true } },
    ],
    [
      'amend a group',
      {
        method: 'PATCH',
        url: `${T}/groups/${patchedGroup}`,
        body: { description: 'amended' },
        etagFrom: `${T}/groups/${patchedGroup}`,
      },
    ],
    [
      'replace a group’s roles',
      {
        method: 'PUT',
        url: `${T}/groups/${mappedGroup}/roles`,
        body: { role_ids: [ids.role] },
        etagFrom: `${T}/groups/${mappedGroup}/roles`,
      },
    ],
    [
      'make a group a default',
      { method: 'PUT', url: `${T}/groups/${defaultGroup}/default`, body: { default: true } },
    ],
    [
      'amend a scope',
      {
        method: 'PATCH',
        url: `${T}/scopes/${patchedScope}`,
        body: { description: 'amended' },
        etagFrom: `${T}/scopes/${patchedScope}`,
      },
    ],
    [
      'replace a scope’s roles',
      {
        method: 'PUT',
        url: `${T}/scopes/${ids.scope}/roles`,
        body: { role_ids: [ids.role] },
        etagFrom: `${T}/scopes/${ids.scope}/roles`,
      },
    ],
    [
      'set a scope’s mappers',
      {
        method: 'PUT',
        url: `${T}/scopes/${patchedScope}/mappers`,
        body: { mapper_names: [] },
        etagFrom: `${T}/scopes/${patchedScope}/mappers`,
      },
    ],
    [
      'assign a scope to a client',
      {
        method: 'PUT',
        url: `${T}/scopes/${patchedScope}/clients/${scopeClient}`,
        body: { assignment: 'optional' },
      },
    ],
    [
      'unassign a scope from a client',
      { method: 'DELETE', url: `${T}/scopes/${patchedScope}/clients/${scopeClient}` },
    ],
    [
      'create a signing key',
      { method: 'POST', url: `${T}/keys`, body: { alg: 'ES256' }, saveAs: 'newKey' },
    ],
    [
      'create a second signing key',
      { method: 'POST', url: `${T}/keys`, body: { alg: 'ES256' }, saveAs: 'nextKey' },
    ],
    ['promote a signing key', { method: 'POST', url: `${T}/keys/{nextKey}/promote` }],
    ['retire the key it replaced', { method: 'POST', url: `${T}/keys/{newKey}/retire` }],
    ['delete the retired key', { method: 'DELETE', url: `${T}/keys/{newKey}` }],
    ['delete the tenant’s SMTP', { method: 'DELETE', url: `${T}/smtp` }],
    [
      'replace the sign-in flow',
      {
        method: 'PUT',
        url: `${T}/flow/executions`,
        etagFrom: `${T}/flow/executions`,
        body: [],
        bodyFrom: {
          url: `${T}/flow/executions`,
          make: (answer: unknown) =>
            ((answer as { items?: unknown[] }).items ?? []).map((item) => ({
              authenticator: (item as { authenticator: string }).authenticator,
              requirement: (item as { requirement: string }).requirement,
            })),
        },
      },
    ],
  ];

  const saved = new Map<string, string>();
  for (const [label, call] of calls) {
    const token =
      call.as !== undefined
        ? tokens[call.as]
        : call.system === true
          ? tokens.system
          : tokens.tenant;
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    const url = call.url.replace(/\{(\w+)\}/gu, (_, name: string) => saved.get(name) ?? name);
    let body = call.body;
    if (call.bodyFrom !== undefined) {
      const from = await world.http.inject({ url: call.bodyFrom.url, headers });
      body = call.bodyFrom.make(from.json());
    }
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (call.etagFrom !== undefined) {
      const current = await world.http.inject({ url: call.etagFrom, headers });
      headers['if-match'] = String(current.headers.etag);
    }
    const res: LightMyRequestResponse = await capture(
      `${call.method} ${url.replace(/[0-9a-f-]{36}/gu, '<id>')} (${label})`,
      'admin',
      () =>
        world.http.inject({
          method: call.method,
          url,
          headers,
          ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
        }),
    );
    if (call.saveAs !== undefined) {
      saved.set(call.saveAs, res.json<{ id: string }>().id);
    }
    if (res.statusCode >= 300)
      console.warn(`${call.method} ${url}: ${String(res.statusCode)} ${res.body.slice(0, 300)}`);
    if (res.statusCode >= 500 || res.statusCode === 401 || res.statusCode === 403) {
      throw new Error(
        `${call.method} ${url} (${label}): ${String(res.statusCode)} ${res.body.slice(0, 300)}`,
      );
    }
  }
}
