import { type Sql } from 'postgres';

export interface Outcome {
  client: string;
  subject: boolean;
  idle: boolean;
}

export async function outcomes(raw: Sql): Promise<Outcome[]> {
  return raw<Outcome[]>`
    select t.name || '/' || c.client_id as client,
           c.service_subject_id is not null as subject,
           c.service_account_idle as idle
      from clients c join tenants t on t.id = c.tenant_id
     where c.client_id like 'k-%'
     order by 1`;
}

export function expectedOutcomes(): Outcome[] {
  const expected = (name: string, subject: boolean, idle: boolean): Outcome[] =>
    ['one', 'two'].map((tenant) => ({ client: `${tenant}/${name}`, subject, idle }));
  return [
    ...expected('k-actor', true, true),
    ...expected('k-audit', true, true),
    ...expected('k-bare', false, false),
    ...expected('k-consent', true, true),
    ...expected('k-gone', false, false),
    ...expected('k-grant', true, true),
    ...expected('k-keeps', true, false),
    ...expected('k-public', false, false),
    ...expected('k-role', true, true),
    ...expected('k-xaudit', true, true),
  ].sort((a, b) => (a.client < b.client ? -1 : a.client > b.client ? 1 : 0));
}

export async function seed(raw: Sql): Promise<void> {
  await raw`insert into tenants (id, name) values (gen_random_uuid(), 'one'), (gen_random_uuid(), 'two')`;
  // keeps: has the grant. gone: none and nothing names it.
  // grant/role/audit/consent: none, but something does. actor: a delegated
  // grant names it as the actor. xaudit: only an event of the other tenant does.
  const specs: { client: string; grants: string[]; type: string; account: boolean }[] = [
    { client: 'k-keeps', grants: ['client_credentials'], type: 'confidential', account: true },
    { client: 'k-gone', grants: ['authorization_code'], type: 'confidential', account: true },
    { client: 'k-grant', grants: ['authorization_code'], type: 'confidential', account: true },
    { client: 'k-role', grants: ['authorization_code'], type: 'confidential', account: true },
    { client: 'k-actor', grants: ['authorization_code'], type: 'confidential', account: true },
    { client: 'k-xaudit', grants: ['authorization_code'], type: 'confidential', account: true },
    { client: 'k-audit', grants: ['authorization_code'], type: 'confidential', account: true },
    { client: 'k-consent', grants: ['authorization_code'], type: 'confidential', account: true },
    { client: 'k-public', grants: ['authorization_code'], type: 'public', account: false },
    { client: 'k-bare', grants: ['authorization_code'], type: 'confidential', account: false },
  ];
  for (const spec of specs) {
    await raw`
      with s as (
        insert into subjects (id, tenant_id, type)
        select gen_random_uuid(), t.id, 'service' from tenants t
         where t.name in ('one', 'two') and ${spec.account}
        returning id, tenant_id)
      insert into clients (id, tenant_id, client_id, name, type, secret_hash, service_subject_id)
      select gen_random_uuid(), t.id, ${spec.client}, ${spec.client}, ${spec.type},
             case when ${spec.type} = 'confidential' then 'x' end,
             (select s.id from s where s.tenant_id = t.id)
        from tenants t where t.name in ('one', 'two')`;
    await raw`
      insert into client_oidc_config (client_id, tenant_id, redirect_uris, grant_types,
                                      token_endpoint_auth_method)
      select c.id, c.tenant_id, ARRAY['https://a.example/cb'], ${spec.grants},
             case when c.type = 'public' then 'none' else 'client_secret_basic' end
        from clients c where c.client_id = ${spec.client}`;
  }
  await raw`
    insert into token_grants (id, tenant_id, client_id, subject_id, scope)
    select gen_random_uuid(), c.tenant_id, c.id, c.service_subject_id, 'x'
      from clients c where c.client_id = 'k-grant'`;
  await raw`
    with r as (insert into roles (id, tenant_id, name)
               select gen_random_uuid(), c.tenant_id, 'r-' || c.tenant_id
                 from clients c where c.client_id = 'k-role' returning id, tenant_id)
    insert into subject_roles (tenant_id, subject_id, role_id)
    select c.tenant_id, c.service_subject_id, r.id
      from clients c join r on r.tenant_id = c.tenant_id where c.client_id = 'k-role'`;
  await raw`
    insert into audit_events (id, tenant_id, event_type, action, outcome, actor_subject_id)
    select gen_random_uuid(), c.tenant_id, 'admin', 'client.amend', 'allowed', c.service_subject_id
      from clients c where c.client_id = 'k-audit'`;
  await raw`
    insert into audit_events (id, tenant_id, event_type, action, outcome, actor_tenant_id,
                              actor_subject_id)
    select gen_random_uuid(), other.id, 'admin', 'client.amend', 'allowed', c.tenant_id,
           c.service_subject_id
      from clients c
      join tenants other on other.id <> c.tenant_id and other.name in ('one', 'two')
     where c.client_id = 'k-xaudit'`;
  await raw`
    with u as (insert into subjects (id, tenant_id, type)
               select gen_random_uuid(), c.tenant_id, 'user'
                 from clients c where c.client_id = 'k-actor' returning id, tenant_id)
    insert into token_grants (id, tenant_id, client_id, subject_id, scope, actor_subject_id)
    select gen_random_uuid(), c.tenant_id, c.id, u.id, 'x', c.service_subject_id
      from clients c join u on u.tenant_id = c.tenant_id where c.client_id = 'k-actor'`;
  await raw`
    insert into consents (id, tenant_id, subject_id, client_id)
    select gen_random_uuid(), c.tenant_id, c.service_subject_id, c.id
      from clients c where c.client_id = 'k-consent'`;
}
