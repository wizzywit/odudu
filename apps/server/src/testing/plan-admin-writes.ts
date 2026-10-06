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
    [
      'revoke all of a subject’s grants',
      { method: 'DELETE', url: `${T}/subjects/${editedSubject}/grants` },
    ],
    ['clear every lockout of the tenant', { method: 'DELETE', url: `${T}/lockouts` }],
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
        body: { name: `made-${newId().slice(-8)}` },
        system: true,
      },
    ],
    [
      'delete a tenant',
      { method: 'DELETE', url: `/admin/tenants/${small.name}?confirm=${small.name}`, system: true },
    ],
  ];

  for (const [label, call] of calls) {
    const token = call.system === true ? tokens.system : tokens.tenant;
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (call.body !== undefined) headers['content-type'] = 'application/json';
    if (call.etagFrom !== undefined) {
      const current = await world.http.inject({ url: call.etagFrom, headers });
      headers['if-match'] = String(current.headers.etag);
    }
    const res: LightMyRequestResponse = await capture(
      `${call.method} ${call.url.replace(/[0-9a-f-]{36}/gu, '<id>')} (${label})`,
      'admin',
      () =>
        world.http.inject({
          method: call.method,
          url: call.url,
          headers,
          ...(call.body === undefined ? {} : { payload: JSON.stringify(call.body) }),
        }),
    );
    if (res.statusCode >= 500 || res.statusCode === 401 || res.statusCode === 403) {
      throw new Error(
        `${call.method} ${call.url} (${label}): ${String(res.statusCode)} ${res.body.slice(0, 300)}`,
      );
    }
  }
}
