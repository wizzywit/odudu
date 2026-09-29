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
  // Creates the system tenant; its own generated password is not used.
  seed(['admin', '--username', `boot-${run}`]);
  administrator(system);
  administrator(resumer);

  publish({ admin, forced, expiring, other, system, limited, overview, resumer, tenants });
}
