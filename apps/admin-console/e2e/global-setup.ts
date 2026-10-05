import { randomBytes } from 'node:crypto';
import { psql, publish, seed, type Account } from './stack.ts';

const TENANT_ADMIN = 'odudu-admin:tenant-admin';

function password(): string {
  return randomBytes(18).toString('base64url');
}

function subject(account: Account, ...extra: string[]): void {
  seed([
    'user',
    '--tenant',
    account.tenant,
    '--username',
    account.username,
    // Joined with `=`: a base64url password can begin with `-`, which
    // parseArgs would otherwise read as another option.
    `--password=${account.password}`,
    ...extra,
  ]);
}

function grant(account: Account, role: string): void {
  seed(['grant-role', '--tenant', account.tenant, '--username', account.username, '--role', role]);
}

function administrator(account: Account, ...extra: string[]): void {
  subject(account, ...extra);
  grant(account, TENANT_ADMIN);
}

// The groups and roles the Groups and Roles tests change, each changed by one
// test alone. `deep` nests `middle`, which nests view-users, so its reach is
// deeper than the console reads.
function seedGroupsRoles(tenant: string): void {
  seed(['tenant', '--name', tenant]);
  const groups = [
    ['eng'],
    ['platform', '/eng'],
    ['finance'],
    ['admins'],
    ['oncall', '/admins'],
    ['movable'],
    ['doomed'],
    ['child', '/doomed'],
    ['raced'],
    ['keyed'],
    ['dup'],
    ['dup', '/finance'],
  ];
  for (const [name, parent] of groups) {
    seed([
      'group',
      '--tenant',
      tenant,
      '--name',
      name ?? '',
      ...(parent === undefined ? [] : ['--parent', parent]),
    ]);
  }
  seed([
    'map-group-role',
    '--tenant',
    tenant,
    '--group',
    '/admins',
    '--role',
    'odudu-admin:view-users',
  ]);
  seed([
    'client',
    '--tenant',
    tenant,
    '--client-id',
    'portal',
    '--public',
    '--redirect-uri',
    'https://portal.example/callback',
  ]);
  for (const name of ['auditor', 'reader', 'helper', 'middle', 'deep']) {
    seed(['role', '--tenant', tenant, '--name', name]);
  }
  seed(['role', '--tenant', tenant, '--name', 'reader', '--client-id', 'portal']);
  nest(tenant, 'helper', 'odudu-admin:view-users');
  nest(tenant, 'middle', 'odudu-admin:view-users');
  nest(tenant, 'deep', 'middle');
}

// No seed command nests a role, so the edge goes in as the database owner.
// A child named `client:role` is that client's role; any other a tenant role.
function nest(tenant: string, parent: string, child: string): void {
  const role = (name: string): string => {
    const split = name.indexOf(':');
    const own = name.slice(split + 1);
    const owner =
      split === -1
        ? 'r.client_id is null'
        : `r.client_id = (select c.id from clients c where c.tenant_id = t.id and c.client_id = '${name.slice(0, split)}')`;
    return `(select r.id from roles r where r.tenant_id = t.id and r.name = '${own}' and ${owner})`;
  };
  psql(
    `insert into role_composites (tenant_id, parent_role_id, child_role_id) select t.id, ${role(parent)}, ${role(child)} from tenants t where t.name = '${tenant}'`,
  );
}

// Names are fresh each run, so a stack kept up between runs seeds again.
export default function globalSetup(): void {
  const run = `e2e-${Date.now().toString(36)}`;
  const admin = { tenant: `${run}-a`, username: 'grace', password: password() };
  const forced = { tenant: admin.tenant, username: 'hopper', password: password() };
  const expiring = { tenant: admin.tenant, username: 'lovelace', password: password() };
  const other = { tenant: `${run}-b`, username: 'ada', password: password() };
  const system = { tenant: 'system', username: `root-${run}`, password: password() };
  const limited = { tenant: admin.tenant, username: 'babbage', password: password() };
  const overview = { tenant: `${run}-c`, username: 'turing', password: password() };
  const resumer = { tenant: 'system', username: `resume-${run}`, password: password() };
  const systemAdmins = {
    candidate: { tenant: 'system', username: `candidate-${run}`, password: password() },
    revokee: { tenant: 'system', username: `revokee-${run}`, password: password() },
    limited: { tenant: 'system', username: `watcher-${run}`, password: password() },
    bystander: { tenant: 'system', username: `bystander-${run}`, password: password() },
    created: `created-${run}`,
  };
  const subjects = {
    admin: { tenant: `${run}-s`, username: 'noether', password: password() },
    viewer: { tenant: `${run}-s`, username: 'watcher', password: password() },
    edited: 'ada',
    conflict: 'augusta',
    typed: 'hypatia',
    keyed: 'euclid',
    measured: 'somerville',
    locked: { tenant: `${run}-s`, username: 'lamarr', password: password() },
    issued: { tenant: `${run}-s`, username: 'franklin', password: password() },
    doomed: 'turing',
    departing: { tenant: `${run}-s`, username: 'meitner', password: password() },
    renamer: { tenant: `${run}-t`, username: 'hamilton', password: password() },
    renamed: 'rena',
    prefix: `made-${run}`,
    member: 'curie',
    asked: { tenant: `${run}-s`, username: 'lise', password: password() },
    holder: 'sklodowska',
    listed: 'yalow',
    ender: { tenant: `${run}-s`, username: 'rosalind', password: password() },
    raced: 'hodgkin',
    resumer: { tenant: `${run}-s`, username: 'kovalevskaya', password: password() },
    drafted: 'germain',
  };
  const groupsRoles = {
    admin: { tenant: `${run}-r`, username: 'ines', password: password() },
    limited: { tenant: `${run}-r`, username: 'kepler', password: password() },
    member: 'curie',
  };
  const tenants = {
    general: `${run}-d`,
    source: `${run}-e`,
    conflict: `${run}-f`,
    resume: `${run}-g`,
    prefix: `${run}-n`,
  };

  seed(['tenant', '--name', admin.tenant]);
  seed(['tenant', '--name', other.tenant]);
  seed(['tenant', '--name', overview.tenant]);
  for (const name of [tenants.general, tenants.source, tenants.conflict, tenants.resume]) {
    seed(['tenant', '--name', name]);
  }
  seed([
    'client',
    '--tenant',
    tenants.source,
    '--client-id',
    'billing',
    `--client-secret=${password()}`,
    '--redirect-uri',
    'https://billing.example/callback',
  ]);
  administrator(admin);
  administrator(forced, '--require-password-change');
  administrator(expiring);
  administrator(other);
  administrator(overview);
  subject(limited);
  grant(limited, 'odudu-admin:manage-tenant');
  seed(['tenant', '--name', subjects.admin.tenant]);
  administrator(subjects.admin);
  subject(subjects.viewer);
  grant(subjects.viewer, 'odudu-admin:view-users');
  for (const username of [
    subjects.edited,
    subjects.conflict,
    subjects.typed,
    subjects.keyed,
    subjects.measured,
  ]) {
    subject({ tenant: subjects.admin.tenant, username, password: password() });
  }
  subject(subjects.locked);
  subject(subjects.issued);
  subject({ tenant: subjects.admin.tenant, username: subjects.doomed, password: password() });
  administrator(subjects.departing);
  subject(
    { tenant: subjects.admin.tenant, username: subjects.member, password: password() },
    `--email=${subjects.member}@example.test`,
  );
  for (const username of [subjects.holder, subjects.listed, subjects.raced, subjects.drafted]) {
    subject({ tenant: subjects.admin.tenant, username, password: password() });
  }
  subject(subjects.asked);
  grant({ ...subjects.admin, username: subjects.listed }, 'odudu-admin:view-audit');
  administrator(subjects.ender);
  administrator(subjects.resumer);
  for (const name of ['ops', 'finance']) {
    seed(['group', '--tenant', subjects.admin.tenant, '--name', name]);
  }
  for (const name of ['auditor', 'billing-reader']) {
    seed(['role', '--tenant', subjects.admin.tenant, '--name', name]);
  }
  seed([
    'map-group-role',
    '--tenant',
    subjects.admin.tenant,
    '--group',
    '/finance',
    '--role',
    'billing-reader',
  ]);
  seedGroupsRoles(groupsRoles.admin.tenant);
  administrator(groupsRoles.admin);
  subject(groupsRoles.limited);
  grant(groupsRoles.limited, 'odudu-admin:manage-tenant');
  subject({ tenant: groupsRoles.admin.tenant, username: groupsRoles.member, password: password() });
  seed([
    'join-group',
    '--tenant',
    groupsRoles.admin.tenant,
    '--username',
    groupsRoles.member,
    '--group',
    '/eng',
  ]);
  seed(['tenant', '--name', subjects.renamer.tenant]);
  administrator(subjects.renamer);
  subject({ tenant: subjects.renamer.tenant, username: subjects.renamed, password: password() });
  // Creates the system tenant; its own generated password is not used.
  seed(['admin', '--username', `boot-${run}`]);
  administrator(system);
  administrator(resumer);
  subject(systemAdmins.candidate);
  administrator(systemAdmins.revokee);
  subject(systemAdmins.limited);
  subject(systemAdmins.bystander);
  grant(systemAdmins.limited, 'odudu-admin:manage-tenants');
  grant(systemAdmins.limited, 'odudu-admin:view-users');

  publish({
    admin,
    forced,
    expiring,
    other,
    system,
    limited,
    overview,
    resumer,
    tenants,
    systemAdmins,
    subjects,
    groupsRoles,
  });
}
