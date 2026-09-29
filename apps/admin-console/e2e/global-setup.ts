import { randomBytes } from 'node:crypto';
import { publish, seed, type Account } from './stack.ts';

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
    locked: { tenant: `${run}-s`, username: 'lamarr', password: password() },
    issued: { tenant: `${run}-s`, username: 'franklin', password: password() },
    doomed: 'turing',
    departing: { tenant: `${run}-s`, username: 'meitner', password: password() },
    renamer: { tenant: `${run}-t`, username: 'hamilton', password: password() },
    renamed: 'rena',
    prefix: `made-${run}`,
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
  for (const username of [subjects.edited, subjects.conflict]) {
    subject({ tenant: subjects.admin.tenant, username, password: password() });
  }
  subject(subjects.locked);
  subject(subjects.issued);
  subject({ tenant: subjects.admin.tenant, username: subjects.doomed, password: password() });
  administrator(subjects.departing);
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
  });
}
