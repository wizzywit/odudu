import { ASSIGNMENT_LIMIT, SCOPE_LIMIT } from '@odudu/contracts/admin';
import { type DatabaseHandle } from '@odudu/db';

// The volume the plan check seeds, in SQL, around a tenant the seed command
// has already provisioned. The design volume is 1,000,000 subjects and
// 10,000 clients in a tenant, 10,000 tenants and 100,000,000 audit events
// (ADR 0041); this is the fraction of it at which the planner already
// prefers an index wherever one fits and a sequential scan wherever none
// does, so a plan that is wrong here is wrong at the design volume too.
export const PLAN_VOLUME = {
  tenants: 5_000,
  subjectsPerOtherTenant: 20,
  clientsPerOtherTenant: 20,
  rolesPerOtherTenant: 20,
  groupsPerOtherTenant: 10,
  scopesPerOtherTenant: 5,
  subjects: 200_000,
  clients: 10_000,
  confidentialClients: 1_000,
  roles: 5_000,
  clientRoles: 10_000,
  groups: 5_000,
  scopes: SCOPE_LIMIT - 20,
  sessions: 200_000,
  grants: 300_000,
  authorizationCodes: 100_000,
  authenticationSessions: 50_000,
  mail: 100_000,
  logoutDeliveries: 100_000,
  assertionIds: 100_000,
  auditEvents: 600_000,
  auditEventsPerOtherTenant: 80,
  // The size of each collection a drive pages through: more than MAX_LIMIT,
  // so a page of MAX_LIMIT is full and has a next page.
  fanOut: 300,
  // Tables a tenant fills with one row per role, group or scope, or per sign-in:
  // above the large-table threshold so a scan of one is caught.
  registrationTokens: 6_000,
  consoleRows: 6_000,
  // What a set the admin API replaces whole holds, at the most it may.
  assignments: ASSIGNMENT_LIMIT,
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

// The volume as the text a script splices in; arithmetic on it stays in SQL.
function asText(volume: typeof PLAN_VOLUME): Record<keyof typeof PLAN_VOLUME, string> {
  return Object.fromEntries(
    Object.entries(volume).map(([key, value]) => [key, String(value)]),
  ) as Record<keyof typeof PLAN_VOLUME, string>;
}

export interface VolumeTarget {
  readonly tenantId: string;
  readonly clientDbId: string;
}

// Interpolated rather than bound: the temp tables it builds live on one
// connection, and the only values spliced in are two UUIDs this function
// checks itself.
function volumeStatements(target: VolumeTarget): string[] {
  for (const id of [target.tenantId, target.clientDbId]) {
    if (!UUID.test(id)) throw new Error(`plan volume: ${JSON.stringify(id)} is not a UUID`);
  }
  const v = asText(PLAN_VOLUME);
  const t = `'${target.tenantId}'`;
  const c0 = `'${target.clientDbId}'`;

  const script = `
insert into tenants (id, name, display_name)
select gen_random_uuid(), 'tn' || g,
       case when g % 3 = 0 then null else 'Tenant ' || g end
  from generate_series(1, ${v.tenants}) g;
create temp table vol_other as
  select id, row_number() over () n from tenants where name like 'tn%';
analyze vol_other;

insert into subjects (id, tenant_id, type)
select gen_random_uuid(), o.id, 'user'
  from vol_other o cross join generate_series(1, ${v.subjectsPerOtherTenant});
insert into users (subject_id, tenant_id, username, email, name)
select s.id, s.tenant_id, 'o' || row_number() over (),
       'o' || row_number() over () || '@example.com', 'Other ' || row_number() over ()
  from subjects s where s.tenant_id in (select id from vol_other);
insert into clients (id, tenant_id, client_id, name, type)
select gen_random_uuid(), o.id, 'c' || g, 'App ' || g, 'public'
  from vol_other o cross join generate_series(1, ${v.clientsPerOtherTenant}) g;
insert into client_oidc_config (client_id, tenant_id, redirect_uris, grant_types, token_endpoint_auth_method, web_origins)
select id, tenant_id, '{https://app.example/cb}', '{authorization_code}', 'none', '{+}'
  from clients where tenant_id in (select id from vol_other);
insert into client_origins (tenant_id, client_id, origin)
select tenant_id, client_id, 'https://app.example' from client_oidc_config
 where tenant_id in (select id from vol_other);
insert into roles (id, tenant_id, name)
select gen_random_uuid(), o.id, 'r' || g
  from vol_other o cross join generate_series(1, ${v.rolesPerOtherTenant}) g;
insert into groups (id, tenant_id, name, path)
select gen_random_uuid(), o.id, 'g' || g, '/g' || g
  from vol_other o cross join generate_series(1, ${v.groupsPerOtherTenant}) g;
insert into client_scopes (id, tenant_id, name)
select gen_random_uuid(), o.id, 's' || g
  from vol_other o cross join generate_series(1, ${v.scopesPerOtherTenant}) g;
insert into sessions (id, tenant_id, subject_id, expires_at, authenticators, secret_hash)
select gen_random_uuid(), s.tenant_id, s.id, now() + interval '1 day', '{pwd}', md5(s.id::text)
  from subjects s where s.tenant_id in (select id from vol_other);
insert into login_failures (tenant_id, subject_id, failure_count, first_failure_at, last_failure_at)
select s.tenant_id, s.id, 1, now(), now()
  from subjects s where s.tenant_id in (select id from vol_other);
insert into audit_events (id, tenant_id, occurred_at, event_type, action, outcome, resource_type, resource_id)
select gen_random_uuid(), o.id, now() - (g || ' seconds')::interval,
       'admin_mutation', 'client.create', 'allowed', 'client', g::text
  from vol_other o cross join generate_series(1, ${v.auditEventsPerOtherTenant}) g;

insert into subjects (id, tenant_id, type)
select gen_random_uuid(), ${t}, 'user' from generate_series(1, ${v.subjects});
create temp table vol_subjects as
  select row_number() over (order by id) n, id from subjects
   where tenant_id = ${t} and type = 'user'
     and id not in (select subject_id from users where tenant_id = ${t});
create unique index on vol_subjects (n);
analyze vol_subjects;
insert into users (subject_id, tenant_id, username, email, name, given_name, family_name)
select id, ${t}, 'user' || n, 'user' || n || '@example.com', 'Name ' || n,
       case when n % 4 = 0 then null else 'Given' || (n % 500) end, 'Family' || (n % 900)
  from vol_subjects;
insert into user_credentials (id, tenant_id, subject_id, type, secret_data)
select gen_random_uuid(), ${t}, id, 'password', '{"hash":"x"}'::jsonb
  from vol_subjects;

insert into clients (id, tenant_id, client_id, name, type)
select gen_random_uuid(), ${t}, 'app-' || g, 'Application ' || g, 'public'
  from generate_series(1, ${v.clients}) g;
create temp table vol_clients as
  select row_number() over (order by id) n, id from clients
   where tenant_id = ${t} and client_id like 'app-%';
create unique index on vol_clients (n);
analyze vol_clients;
insert into client_oidc_config (client_id, tenant_id, redirect_uris, grant_types, token_endpoint_auth_method, web_origins)
select id, ${t}, array['https://app' || (n % 5000) || '.example/cb'], '{authorization_code}', 'none', '{+}'
  from vol_clients;
insert into client_origins (tenant_id, client_id, origin)
select ${t}, id, 'https://app' || (n % 5000) || '.example' from vol_clients;

-- Confidential clients, each with a service account, a fifth of them (never the ones the write drives edit) holding an
-- admin capability: what a client's page of answers reads its reach from.
create temp table vol_service as
  select g n, gen_random_uuid() id from generate_series(1, ${v.confidentialClients}) g;
insert into subjects (id, tenant_id, type) select id, ${t}, 'service' from vol_service;
update clients c set type = 'confidential', secret_hash = 'x', service_subject_id = s.id
  from vol_service s where c.tenant_id = ${t} and c.client_id = 'app-' || s.n;
update client_oidc_config o set token_endpoint_auth_method = 'client_secret_basic'
  from clients c join vol_service s on c.client_id = 'app-' || s.n
 where c.tenant_id = ${t} and o.client_id = c.id;
insert into subject_roles (tenant_id, subject_id, role_id)
select ${t}, s.id, r.id
  from vol_service s
  join roles r on r.client_id = (select id from clients where tenant_id = ${t} and client_id = 'odudu-admin')
              and r.name = 'view-users'
 where s.n % 5 = 3;

insert into client_scope_assignments (tenant_id, client_id, client_scope_id, assignment)
select ${t}, c.id, a.client_scope_id, a.assignment
  from vol_clients c
 cross join (select client_scope_id, assignment from client_scope_assignments where client_id = ${c0}) a;

insert into roles (id, tenant_id, name)
select gen_random_uuid(), ${t}, 'role-' || g from generate_series(1, ${v.roles}) g;
insert into roles (id, tenant_id, client_id, name)
select gen_random_uuid(), ${t}, c.id, 'crole-' || g
  from vol_clients c cross join generate_series(1, ${v.clientRoles} / 100) g where c.n <= 100;
insert into groups (id, tenant_id, name, path)
select gen_random_uuid(), ${t}, 'group-' || g, '/group-' || g from generate_series(1, ${v.groups}) g;
insert into client_scopes (id, tenant_id, name)
select gen_random_uuid(), ${t}, 'scope-' || g from generate_series(1, ${v.scopes}) g;
create temp table vol_roles as
  select row_number() over (order by name) n, id from roles where tenant_id = ${t} and name like 'role-%';
create temp table vol_groups as
  select row_number() over (order by name) n, id from groups where tenant_id = ${t} and name like 'group-%';
create temp table vol_scopes as
  select row_number() over (order by name) n, id from client_scopes where tenant_id = ${t} and name like 'scope-%';
analyze vol_roles, vol_groups, vol_scopes;

insert into groups (id, tenant_id, parent_id, name, path)
select gen_random_uuid(), ${t}, p.id, 'child-' || g, '/group-' || p.n || '/child-' || g
  from vol_groups p cross join generate_series(1, ${v.fanOut}) g where p.n = 1;
insert into group_roles (tenant_id, group_id, role_id)
select ${t}, g.id, r.id from vol_groups g join vol_roles r on r.n <= ${v.assignments} where g.n = 1;
insert into role_composites (tenant_id, parent_role_id, child_role_id)
select ${t}, p.id, r.id from vol_roles p join vol_roles r on r.n between 2 and ${v.assignments} + 1 where p.n = 1;
insert into client_scope_roles (tenant_id, client_scope_id, role_id)
select ${t}, s.id, r.id from vol_scopes s join vol_roles r on r.n <= ${v.assignments} where s.n = 1;
insert into client_scope_assignments (tenant_id, client_id, client_scope_id, assignment)
select ${t}, c.id, s.id, 'optional' from vol_scopes s join vol_clients c on c.n <= ${v.fanOut} where s.n = 1;
insert into client_registration_tokens (id, tenant_id, token_hash, remaining_uses, expires_at)
select gen_random_uuid(), ${t}, md5(g::text) || md5('r' || g), 5, now() + interval '1 day'
  from generate_series(1, ${v.registrationTokens}) g;

insert into group_roles (tenant_id, group_id, role_id)
select ${t}, g.id, r.id from vol_groups g join vol_roles r on r.n = g.n where g.n between 2 and ${v.groups};
insert into role_composites (tenant_id, parent_role_id, child_role_id)
select ${t}, p.id, c.id from vol_roles p
  join vol_roles c on c.n in (p.n + ${v.roles} / 2, p.n + ${v.roles} / 2 + 1)
 where p.n between 2 and ${v.roles} / 2 - 1;
-- One role the probe subject holds, nested under most of the others: what a
-- page of effective roles must not read in full.
insert into role_composites (tenant_id, parent_role_id, child_role_id)
select ${t}, p.id, c.id from vol_roles p join vol_roles c on c.n = 5
 where p.n between ${v.roles} / 2 + 2 and ${v.roles} - 100;
insert into client_scope_roles (tenant_id, client_scope_id, role_id)
select ${t}, s.id, r.id from vol_scopes s
  join vol_roles r on r.n between s.n * 5 and s.n * 5 + 5 where s.n between 2 and ${v.scopes};
insert into console_sessions (id, tenant_id, subject_id, secret_hash, access_token_wrapped,
                              refresh_token_wrapped, id_token_wrapped, access_expires_at,
                              created_at, last_seen_at, expires_at)
select gen_random_uuid(), ${t}, s.id, decode(md5(g::text) || md5('s' || g), 'hex'), 'x', 'x', 'x',
       now() + interval '5 minutes', now(), now(),
       case when g <= ${v.consoleRows} / 50 then now() - interval '1 hour' else now() + interval '8 hours' end
  from generate_series(1, ${v.consoleRows}) g join vol_subjects s on s.n = g;
insert into console_logins (id, tenant_id, state_hash, verifier_wrapped, nonce, return_to, expires_at)
select gen_random_uuid(), ${t}, decode(md5(g::text) || md5('l' || g), 'hex'), 'x', 'n', '/',
       case when g <= ${v.consoleRows} / 50 then now() - interval '1 hour' else now() + interval '10 minutes' end
  from generate_series(1, ${v.consoleRows}) g;

insert into subject_roles (tenant_id, subject_id, role_id)
select ${t}, s.id, r.id from vol_subjects s join vol_roles r on r.n = 1 + (s.n % ${v.roles});
insert into subject_groups (tenant_id, subject_id, group_id)
select ${t}, s.id, g.id from vol_subjects s join vol_groups g on g.n = 1 + (s.n % ${v.groups});
insert into subject_roles (tenant_id, subject_id, role_id)
select ${t}, s.id, r.id from vol_subjects s join vol_roles r on r.n between 3 and ${v.assignments} + 1
 where s.n = 1 and not exists (
   select 1 from subject_roles x where x.subject_id = s.id and x.role_id = r.id);
insert into subject_groups (tenant_id, subject_id, group_id)
select ${t}, s.id, g.id from vol_subjects s join vol_groups g on g.n between 3 and ${v.assignments} + 1
 where s.n = 1 and not exists (
   select 1 from subject_groups x where x.subject_id = s.id and x.group_id = g.id);

insert into consents (id, tenant_id, subject_id, client_id)
select gen_random_uuid(), ${t}, id, ${c0} from vol_subjects;
insert into consents (id, tenant_id, subject_id, client_id)
select gen_random_uuid(), ${t}, s.id, c.id from vol_subjects s join vol_clients c on c.n <= ${v.fanOut}
 where s.n = 1;
insert into login_failures (tenant_id, subject_id, failure_count, first_failure_at, last_failure_at)
select ${t}, id, 1, now(), now() from vol_subjects where n % 10 = 0;
insert into user_required_actions (tenant_id, subject_id, action)
select ${t}, id, 'update-password' from vol_subjects where n % 10 = 1;
insert into action_tokens (id, tenant_id, subject_id, type, token_hash, expires_at)
select gen_random_uuid(), ${t}, id, 'verify_email', md5(n::text) || md5('a' || n), now() + interval '1 day'
  from vol_subjects where n % 4 = 0;

insert into user_credentials (id, tenant_id, subject_id, type, secret_data, label, lookup_key)
select gen_random_uuid(), ${t}, s.id, 'webauthn',
       '{"publicKey":"k","counter":0,"transports":[]}'::jsonb, 'key ' || g, 'lk' || g
  from vol_subjects s cross join generate_series(1, 12) g where s.n = 1;
insert into user_credentials (id, tenant_id, subject_id, type, secret_data)
select gen_random_uuid(), ${t}, s.id, k.type, '{"hash":"h"}'::jsonb
  from vol_subjects s
 cross join (values ('recovery-code'), ('recovery-code'), ('recovery-code'), ('password-history'), ('password-history')) k(type)
 where s.n = 1;

create temp table vol_sessions as
  select row_number() over () n, id from (select gen_random_uuid() id from generate_series(1, ${v.sessions})) x;
analyze vol_sessions;
insert into sessions (id, tenant_id, subject_id, expires_at, authenticators, secret_hash)
select x.id, ${t}, s.id, now() + interval '1 day', '{pwd}', md5(x.n::text)
  from vol_sessions x join vol_subjects s on s.n = x.n;
insert into sessions (id, tenant_id, subject_id, expires_at, authenticators, secret_hash)
select gen_random_uuid(), ${t}, s.id, now() + interval '1 day', '{pwd}', md5(g::text)
  from vol_subjects s cross join generate_series(1, 5) g where s.n = 1;

create temp table vol_grants as
  select row_number() over () n, gen_random_uuid() id from generate_series(1, ${v.grants});
analyze vol_grants;
insert into token_grants (id, tenant_id, client_id, subject_id, scope, audience, session_id)
select g.id, ${t}, ${c0}, s.id, 'openid', '{}', case when g.n <= ${v.sessions} then x.id end
  from vol_grants g
  join vol_subjects s on s.n = 1 + (g.n % ${v.subjects})
  left join vol_sessions x on x.n = g.n;
insert into token_grants (id, tenant_id, client_id, subject_id, scope, audience)
select gen_random_uuid(), ${t}, c.id, s.id, 'openid', '{}'
  from vol_subjects s join vol_clients c on c.n <= ${v.fanOut} where s.n = 1;
insert into refresh_tokens (token_hash, tenant_id, grant_id, expires_at)
select md5(g.id::text) || md5(g.n::text), ${t}, g.id, now() + interval '7 days' from vol_grants g;
insert into authorization_codes (code_hash, tenant_id, client_id, subject_id, redirect_uri, scope,
                                 code_challenge, code_challenge_method, auth_time, expires_at, consumed_at, grant_id)
select md5(g.id::text), ${t}, ${c0}, s.id, 'https://app.example/cb', 'openid',
       'x', 'S256', now(),
       case when g.n <= ${v.authorizationCodes} / 50 then now() - interval '2 hours' else now() + interval '5 minutes' end,
       case when g.n <= ${v.authorizationCodes} / 50 then now() - interval '2 hours' end, g.id
  from vol_grants g join vol_subjects s on s.n = 1 + (g.n % ${v.subjects})
 where g.n <= ${v.authorizationCodes};
insert into authentication_sessions (id, tenant_id, pending_request, expires_at)
select gen_random_uuid(), ${t}, '{}'::jsonb,
       case when g <= ${v.authenticationSessions} / 50 then now() - interval '2 hours' else now() + interval '5 minutes' end
  from generate_series(1, ${v.authenticationSessions}) g;
insert into email_outbox (id, tenant_id, to_address, subject, body_text, body_html, created_at, sent_at)
select gen_random_uuid(), ${t}, 'u' || g || '@example.com', 's', 'x', 'x',
       now() - (g || ' seconds')::interval, now()
  from generate_series(1, ${v.mail}) g;
insert into backchannel_logout_deliveries (id, tenant_id, client_id, endpoint, logout_token, created_at, session_id, delivered_at)
select gen_random_uuid(), ${t}, ${c0}, 'https://rp.example/b', 't',
       now() - (g || ' seconds')::interval, gen_random_uuid(), now()
  from generate_series(1, ${v.logoutDeliveries}) g;
insert into client_assertion_jti (tenant_id, oauth_client_id, jti, expires_at)
select ${t}, 'plans-app', md5(g::text),
       case when g <= ${v.assertionIds} / 50 then now() - interval '1 hour' else now() + interval '2 hours' end
  from generate_series(1, ${v.assertionIds}) g;

insert into audit_events (id, tenant_id, occurred_at, event_type, action, outcome, actor_subject_id, resource_type, resource_id)
select gen_random_uuid(), ${t}, now() - (g || ' seconds')::interval,
       (array['authentication','token','admin_mutation','session'])[1 + g % 4],
       (array['login.success','token.issue','client.create','session.end'])[1 + g % 4],
       'allowed', s.id, 'subject', s.id::text
  from generate_series(1, ${v.auditEvents}) g
  join vol_subjects s on s.n = 1 + (g % ${v.subjects});

drop table vol_other, vol_subjects, vol_clients, vol_service, vol_roles, vol_groups, vol_scopes, vol_sessions, vol_grants;
`;
  return script
    .split(/;\n/u)
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '');
}

export async function seedPlanVolume(owner: DatabaseHandle, target: VolumeTarget): Promise<void> {
  const connection = await owner.sql.reserve();
  try {
    // The rows are consistent by construction, so the foreign-key triggers
    // that would re-check every one are switched off for this connection:
    // with them the load takes more than twice as long.
    await connection.unsafe("set session_replication_role = 'replica'");
    // Keys that are the same on every run: a gen_random_uuid() found first on
    // the search path counts instead of drawing, so the same seed is the same
    // data and the statistics taken of it do not move between runs.
    await connection.unsafe(`
      create schema vol_keys;
      create sequence vol_keys.n;
      create function vol_keys.gen_random_uuid() returns uuid language sql
        as $$ select overlay(overlay(md5(nextval('vol_keys.n')::text) placing '4' from 13 for 1)
                              placing '8' from 17 for 1)::uuid $$`);
    await connection.unsafe('set search_path = vol_keys, public, pg_catalog');
    for (const statement of volumeStatements(target)) await connection.unsafe(statement);
    await connection.unsafe('set search_path = public, pg_catalog');
    await connection.unsafe('drop schema vol_keys cascade');
    // Statistics from every row, not a sample of 30,000: a target of 10,000
    // samples 3,000,000 rows, more than any table here holds, so the plans do
    // not depend on which rows a random draw took. Vacuumed as well, which sets
    // the visibility map an index-only scan relies on.
    await connection.unsafe('set default_statistics_target = 10000');
    await connection.unsafe('vacuum analyze');
  } finally {
    await connection.unsafe('reset default_statistics_target');
    await connection.unsafe('reset session_replication_role');
    connection.release();
  }
}
