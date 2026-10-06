import { signingKeyRepository, signJwt } from '@odudu/crypto';
import { withTenant } from '@odudu/db';
import { sessionRepository, SessionEntry } from '@odudu/authn-flows';
import { roleRepository } from '@odudu/domain-authz';
import { subjectRepository } from '@odudu/domain-identity';
import {
  ADMIN_API_AUDIENCE,
  ADMIN_CLIENT_ID,
  clientRepository,
  MANAGE_TENANTS,
  SYSTEM_TENANT_NAME,
  TENANT_CAPABILITIES,
} from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { tokenGrantRepository } from '@odudu/protocol-oidc';
import { MAX_LIMIT } from '@odudu/contracts/admin';
import { type LightMyRequestResponse } from 'fastify';
import { type Capture } from '#/testing/plan-paths';
import { isWork, type StatementRecorder } from '#/testing/plan-capture';
import { KEK, TARGET_TENANT, type PlanWorld } from '#/testing/plan-world';

export interface AdminIds {
  readonly subject: string;
  readonly client: string;
  readonly role: string;
  readonly group: string;
  readonly scope: string;
  readonly registrationToken: string;
  readonly key: string;
  readonly session: string;
}

export async function adminIds(world: PlanWorld): Promise<AdminIds> {
  const t = world.tenantId;
  const one = async (query: Promise<{ id: string }[]>, what: string): Promise<string> => {
    const row = (await query)[0];
    if (row === undefined) throw new Error(`no ${what} in the plan tenant`);
    return row.id;
  };
  const sql = world.owner.sql;
  return {
    subject: await one(
      sql`select subject_id as id from users where tenant_id = ${t} and username = 'user1'`,
      'subject',
    ),
    client: await one(
      sql`select id from clients where tenant_id = ${t} and client_id = 'app-1'`,
      'client',
    ),
    role: await one(sql`select id from roles where tenant_id = ${t} and name = 'role-1'`, 'role'),
    group: await one(
      sql`select id from groups where tenant_id = ${t} and name = 'group-1'`,
      'group',
    ),
    scope: await one(
      sql`select id from client_scopes where tenant_id = ${t} and name = 'scope-1'`,
      'scope',
    ),
    registrationToken: await one(
      sql`select id from client_registration_tokens where tenant_id = ${t} limit 1`,
      'registration token',
    ),
    key: await one(sql`select id from signing_keys where tenant_id = ${t} limit 1`, 'key'),
    session: await one(sql`select id from sessions where tenant_id = ${t} limit 1`, 'session'),
  };
}

// A bearer token the way the fixture mints one: a subject holding the
// named capabilities on the tenant's built-in admin client, a live
// session, and a grant, signed by the tenant's own key.
export async function mintAdminToken(
  world: PlanWorld,
  tenant: { readonly id: string; readonly name: string },
  capabilities: readonly string[],
): Promise<string> {
  const discovery = await world.http.inject({
    url: `/tenants/${tenant.name}/.well-known/openid-configuration`,
  });
  const issuer = discovery.json<{ issuer: string }>().issuer;
  return withTenant(world.app.db, tenant.id, async (tx) => {
    const adminClient = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
    if (adminClient === null) throw new Error(`${tenant.name} has no built-in admin client`);
    const subject = await subjectRepository(tx).create({ tenantId: tenant.id, type: 'user' });
    for (const capability of capabilities) {
      const role = await roleRepository(tx).byName(capability, adminClient.id);
      if (role === null) throw new Error(`no role ${capability} on the admin client`);
      await roleRepository(tx).assignToSubject(subject.id, role.id);
    }
    const sessionId = newId();
    await sessionRepository(tx).create({
      id: sessionId,
      tenantId: tenant.id,
      subjectId: subject.id,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      authenticators: ['pwd'],
      secretHash: SessionEntry.issue(sessionId).secretHash(),
    });
    const grantId = newId();
    await tokenGrantRepository(tx).create({
      id: grantId,
      tenantId: tenant.id,
      clientId: adminClient.id,
      subjectId: subject.id,
      scope: '',
      audience: [ADMIN_API_AUDIENCE],
      sessionId,
    });
    const key = await signingKeyRepository(tx).active();
    const iat = Math.floor(Date.now() / 1000);
    return signJwt(
      {
        iss: issuer,
        sub: subject.id,
        aud: [ADMIN_API_AUDIENCE],
        client_id: ADMIN_CLIENT_ID,
        scope: '',
        iat,
        exp: iat + 3600,
        jti: newId(),
        grant_id: grantId,
        sid: sessionId,
      },
      { key, kek: KEK, typ: 'at+jwt' },
    );
  });
}

export interface AdminTokens {
  readonly tenant: string;
  readonly system: string;
  // Callers holding one capability each, which every other is beyond: the
  // widest set of holders a ceiling over the tenant has to exclude.
  readonly usersOnly: string;
  readonly sessionsOnly: string;
}

export async function adminTokens(world: PlanWorld): Promise<AdminTokens> {
  const [system] = await world.owner.sql<{ id: string }[]>`
    select id from tenants where name = ${SYSTEM_TENANT_NAME}`;
  if (system === undefined) throw new Error('no system tenant');
  return {
    tenant: await mintAdminToken(
      world,
      { id: world.tenantId, name: TARGET_TENANT },
      TENANT_CAPABILITIES,
    ),
    system: await mintAdminToken(world, { id: system.id, name: SYSTEM_TENANT_NAME }, [
      MANAGE_TENANTS,
      ...TENANT_CAPABILITIES,
    ]),
    usersOnly: await mintAdminToken(world, { id: world.tenantId, name: TARGET_TENANT }, [
      'manage-users',
    ]),
    sessionsOnly: await mintAdminToken(world, { id: world.tenantId, name: TARGET_TENANT }, [
      'manage-sessions',
    ]),
  };
}

export interface QueryCount {
  readonly path: string;
  readonly small: number;
  readonly large: number;
}

// How many rows a collection answered with, for the bound every route holds.
export interface ReadSize {
  readonly path: string;
  readonly rows: number;
}

function rowsOf(res: LightMyRequestResponse): number | undefined {
  if (!(res.headers['content-type'] ?? '').startsWith('application/json')) return undefined;
  const body: unknown = res.json();
  if (typeof body !== 'object' || body === null || !('items' in body)) return undefined;
  return Array.isArray(body.items) ? body.items.length : undefined;
}

export interface AdminDrive {
  readonly path: string;
  readonly system?: boolean;
  // Statuses other than 200 that are the answer: an export past its row cap.
  readonly alsoAnswers?: readonly number[];
}

function get(world: PlanWorld, token: string, url: string): Promise<LightMyRequestResponse> {
  return world.http.inject({ url, headers: { authorization: `Bearer ${token}` } });
}

export function adminPaths(ids: AdminIds): {
  readonly lists: AdminDrive[];
  readonly reads: AdminDrive[];
} {
  const T = `/admin/tenants/${TARGET_TENANT}`;
  const S = `${T}/subjects`;
  const C = `${T}/clients`;
  const lists: AdminDrive[] = [
    { path: S },
    { path: `${S}?username=user1` },
    { path: `${S}?email=user1` },
    { path: `${S}?name=name%201` },
    { path: `${S}?given_name=given1` },
    { path: `${S}?family_name=family1` },
    { path: `${S}?type=service` },
    { path: `${S}?enabled=false` },
    { path: `${S}?role=${ids.role}` },
    { path: `${S}?group=${ids.group}` },
    { path: `${S}?capability=any` },
    { path: `${S}?locked=true` },
    { path: C },
    { path: `${C}?client_id=app-1` },
    { path: `${C}?client_id_exact=app-1` },
    { path: `${C}?type=confidential` },
    { path: `${C}?enabled=false` },
    // A prefix every client of the tenant matches: more than a budget of rows.
    { path: `${C}?client_id=app-` },
    { path: `${C}?name=application` },
    { path: `${C}?name=application%201` },
    { path: `${C}?type=public` },
    { path: `${C}?enabled=false` },
    { path: `${T}/roles` },
    { path: `${T}/roles?name=role-1` },
    { path: `${T}/roles?name=role-` },
    { path: `${T}/roles?client=tenant` },
    { path: `${T}/roles?client=${ids.client}` },
    { path: `${T}/groups` },
    { path: `${T}/groups?name=group-1` },
    { path: `${T}/groups?name=group-` },
    { path: `${T}/groups?parent=root` },
    { path: `${T}/groups?parent=${ids.group}` },
    { path: `${T}/scopes` },
    { path: `${T}/scopes?name=scope-1` },
    { path: `${T}/sessions` },
    { path: `${T}/sessions?client=${ids.client}` },
    { path: `${T}/audit` },
    { path: `${T}/audit?event_type=authentication` },
    { path: `${T}/audit?actor_subject_id=${ids.subject}` },
    { path: `${T}/audit?action=login.success` },
    { path: `${T}/audit?outcome=refused` },
    { path: `${T}/audit?resource_type=subject&resource_id=${ids.subject}` },
    { path: `${T}/mail` },
    { path: `${T}/mail?status=queued` },
    { path: `${T}/mail?status=retrying` },
    { path: `${T}/mail?status=sent` },
    { path: `${T}/mail?status=failed` },
    { path: `${C}/${ids.client}/logout-deliveries` },
    { path: `${C}/${ids.client}/logout-deliveries?status=pending` },
    { path: `${C}/${ids.client}/logout-deliveries?status=delivered` },
    { path: `${C}/${ids.client}/logout-deliveries?status=failed` },
    { path: `${C}/${ids.client}/sessions` },
    { path: `${T}/registration-tokens` },
    { path: `${T}/keys` },
    { path: `${T}/flow/executions` },
    { path: `${S}/${ids.subject}/credentials` },
    { path: `${S}/${ids.subject}/consents` },
    { path: `${S}/${ids.subject}/roles` },
    { path: `${S}/${ids.subject}/effective-roles` },
    { path: `${S}/${ids.subject}/admin-capabilities` },
    { path: `${S}/${ids.subject}/groups` },
    { path: `${S}/${ids.subject}/sessions` },
    { path: `${S}/${ids.subject}/grants` },
    { path: `${S}/${ids.subject}/required-actions` },
    { path: `${T}/roles/${ids.role}/composites` },
    { path: `${T}/groups/${ids.group}/roles` },
    { path: `${T}/scopes/${ids.scope}/roles` },
    { path: `${T}/scopes/${ids.scope}/mappers` },
    { path: `${T}/scopes/${ids.scope}/clients` },
    { path: '/admin/tenants', system: true },
    { path: '/admin/tenants?name=tn1', system: true },
    { path: '/admin/tenants?display_name=tenant%201', system: true },
    { path: '/admin/tenants?enabled=false', system: true },
  ];
  const counts = [
    `${S}/count`,
    `${S}/count?username=user1`,
    `${S}/count?role=${ids.role}`,
    `${C}/count`,
    `${C}/count?client_id=app-1`,
    `${T}/roles/count`,
    `${T}/roles/count?name=role-1`,
    `${T}/groups/count`,
    `${T}/groups/count?name=group-1`,
    `${T}/scopes/count`,
    `${T}/sessions/count`,
    `${T}/audit/count`,
    `${T}/audit/count?event_type=authentication`,
    `${T}/audit/count?actor_subject_id=${ids.subject}`,
  ].map((path): AdminDrive => ({ path }));
  const reads: AdminDrive[] = [
    ...counts,
    { path: '/admin/tenants/count', system: true },
    { path: `${T}/whoami` },
    { path: T },
    { path: `${T}/settings` },
    { path: `${T}/smtp` },
    { path: `${T}/audit/export`, alsoAnswers: [413] },
    { path: `${T}/audit/export?actor_subject_id=${ids.subject}` },
    { path: `${T}/audit/export?resource_type=subject&resource_id=${ids.subject}` },
    { path: `${T}/export`, system: true },
    { path: `${S}/${ids.subject}` },
    { path: `${S}/${ids.subject}/profile` },
    { path: `${S}/${ids.subject}/lockout` },
    { path: `${S}/username-policy` },
    { path: `${C}/${ids.client}` },
    { path: `${C}/${ids.client}/installation` },
    { path: `${C}/${ids.client}/evaluate?subject=${ids.subject}&scope=openid` },
    { path: `${T}/roles/${ids.role}` },
    { path: `${T}/groups/${ids.group}` },
    { path: `${T}/scopes/${ids.scope}` },
  ];
  return { lists, reads };
}

// Each listing is asked for one row and for MAX_LIMIT, and has to cost the
// same number of statements for both; the larger request is the one whose
// plans are explained.
export async function driveAdmin(
  world: PlanWorld,
  recorder: StatementRecorder,
  capture: Capture,
  tokens: AdminTokens,
  ids: AdminIds,
): Promise<{ counts: QueryCount[]; sizes: ReadSize[] }> {
  const { lists, reads } = adminPaths(ids);
  const counts: QueryCount[] = [];
  const sizes: ReadSize[] = [];

  for (const drive of lists) {
    const token = drive.system === true ? tokens.system : tokens.tenant;
    const joiner = drive.path.includes('?') ? '&' : '?';
    const sized = (limit: number): string => `${drive.path}${joiner}limit=${String(limit)}`;
    await get(world, token, sized(1));
    const small = await recorder.record(() => get(world, token, sized(1)));
    if (small.result.statusCode !== 200) {
      throw new Error(
        `GET ${drive.path}: ${String(small.result.statusCode)} ${small.result.body.slice(0, 300)}`,
      );
    }
    const response = await capture(`GET ${drive.path}`, 'admin', () =>
      get(world, token, sized(MAX_LIMIT)),
    );
    if (response.statusCode !== 200)
      throw new Error(`GET ${drive.path}: ${String(response.statusCode)}`);
    const listed = rowsOf(response);
    if (listed !== undefined) sizes.push({ path: `GET ${drive.path}`, rows: listed });
    const large = await recorder.record(() => get(world, token, sized(MAX_LIMIT)));
    counts.push({
      path: `GET ${drive.path}`,
      small: small.statements.filter(isWork).length,
      large: large.statements.filter(isWork).length,
    });
  }

  for (const drive of reads) {
    const token = drive.system === true ? tokens.system : tokens.tenant;
    const res = await capture(`GET ${drive.path}`, 'admin', () => get(world, token, drive.path));
    if (res.statusCode !== 200 && drive.alsoAnswers?.includes(res.statusCode) !== true) {
      throw new Error(`GET ${drive.path}: ${String(res.statusCode)} ${res.body.slice(0, 300)}`);
    }
    const listed = rowsOf(res);
    if (listed !== undefined) sizes.push({ path: `GET ${drive.path}`, rows: listed });
  }
  return { counts, sizes };
}
