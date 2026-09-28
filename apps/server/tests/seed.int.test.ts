import { actionTokens } from '@odudu/account';
import { provisionTenant, requiredActionRepository } from '@odudu/authn-flows';
import { generateSigningKey, signingKeyRepository, signingKeys } from '@odudu/crypto';
import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { effectiveRoles, roleRepository } from '@odudu/domain-authz';
import { subjects, users } from '@odudu/domain-identity';
import {
  ADMIN_CLIENT_ID,
  clientRegistrationTokenRepository,
  clientRepository,
  clients,
  clientScopeRepository,
  SYSTEM_TENANT_ID,
  SYSTEM_TENANT_NAME,
  TENANT_ADMIN,
  TENANT_DEFAULT_SCOPE_NAMES,
  TENANT_NAME_RULE,
} from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { clientOidcConfigRepository, tenantLookupRepository } from '@odudu/protocol-oidc';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed, seedAdmin, type SeedOptions } from '#/cli/seed';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;

  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);

  const appUrl = await createAppRole(container.adminUrl);

  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = Buffer.alloc(32, 7).toString('base64');
}, 120_000);

afterAll(async () => {
  delete process.env.ODUDU_DATABASE_URL;
  delete process.env.ODUDU_APP_DATABASE_URL;
  delete process.env.ODUDU_KEK;
  await ownerHandle?.close();
  await containerHandle?.stop();
});

// Every helper below scopes by tenantId: this container's owner is a
// superuser and so escapes RLS even under FORCE, and each test seeds its own
// tenant, so an unscoped count would
// pick up every tenant this file has already seeded rather than just the
// one under test.
async function countClients(tenantId: string): Promise<number> {
  const rows = await owner.db.select().from(clients).where(eq(clients.tenantId, tenantId));
  return rows.length;
}

async function countSigningKeys(tenantId: string): Promise<number> {
  const rows = await owner.db.select().from(signingKeys).where(eq(signingKeys.tenantId, tenantId));
  return rows.length;
}

async function clientType(tenantId: string, clientId: string): Promise<string> {
  const rows = await owner.db
    .select({ type: clients.type })
    .from(clients)
    .where(and(eq(clients.tenantId, tenantId), eq(clients.clientId, clientId)));
  const row = rows[0];
  if (row === undefined) throw new Error(`no client ${clientId} in tenant ${tenantId}`);
  return row.type;
}

async function tokenEndpointAuthMethod(tenantId: string, oauthClientId: string): Promise<string> {
  return withTenant(owner.db, tenantId, async (tx) => {
    const clientRows = await tx
      .select()
      .from(clients)
      .where(and(eq(clients.tenantId, tenantId), eq(clients.clientId, oauthClientId)));
    const clientRow = clientRows[0];
    if (clientRow === undefined)
      throw new Error(`no client ${oauthClientId} in tenant ${tenantId}`);
    const config = await clientOidcConfigRepository(tx).byClientId(clientRow.id);
    if (config === null) throw new Error(`no oidc config for client ${oauthClientId}`);
    return config.tokenEndpointAuthMethod;
  });
}

async function serviceSubjectType(tenantId: string, clientId: string): Promise<string | null> {
  const clientRows = await owner.db
    .select({ serviceSubjectId: clients.serviceSubjectId })
    .from(clients)
    .where(and(eq(clients.tenantId, tenantId), eq(clients.clientId, clientId)));
  const clientRow = clientRows[0];
  if (clientRow === undefined) throw new Error(`no client ${clientId} in tenant ${tenantId}`);
  if (clientRow.serviceSubjectId === null) return null;

  const subjectRows = await owner.db
    .select({ type: subjects.type })
    .from(subjects)
    .where(eq(subjects.id, clientRow.serviceSubjectId));
  const subjectRow = subjectRows[0];
  if (subjectRow === undefined) throw new Error(`no subject ${clientRow.serviceSubjectId}`);
  return subjectRow.type;
}

async function seededEmail(tenantId: string, username: string): Promise<string | null> {
  const rows = await owner.db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.username, username)));
  const row = rows[0];
  if (row === undefined) throw new Error(`no user ${username} in tenant ${tenantId}`);
  return row.email;
}

async function assignedScopes(tenantId: string, oauthClientId: string): Promise<string[]> {
  return withTenant(owner.db, tenantId, async (tx) => {
    const clientRows = await tx
      .select()
      .from(clients)
      .where(and(eq(clients.tenantId, tenantId), eq(clients.clientId, oauthClientId)));
    const clientRow = clientRows[0];
    if (clientRow === undefined)
      throw new Error(`no client ${oauthClientId} in tenant ${tenantId}`);
    const scopes = await clientScopeRepository(tx).forClient(clientRow.id);
    return scopes.map((scope) => scope.name).sort();
  });
}

function uniqueOptions(): SeedOptions {
  const suffix = newId();
  return {
    tenant: `acme-${suffix}`,
    clientId: 'web-app',
    clientSecret: 's3cret',
    redirectUris: ['https://app.example/callback'],
    username: 'ada',
    password: 'correct-horse-battery',
  };
}

describe('seed', () => {
  it('creates a tenant, a client, a user and a signing key', async () => {
    const options = uniqueOptions();

    const result = await seed(options);

    expect(result).toMatchObject({ created: true, tenant: options.tenant, clientId: 'web-app' });
    expect(await countSigningKeys(result.tenantId)).toBe(1);
  });

  // /authorize refuses a scope the client is not assigned, so a seeded
  // client that got none would refuse `openid` on its very first request.
  it('assigns the tenant vocabulary to the client it creates', async () => {
    const options = uniqueOptions();

    const result = await seed(options);

    expect(await assignedScopes(result.tenantId, result.clientId)).toEqual(
      [...TENANT_DEFAULT_SCOPE_NAMES].sort(),
    );
  });

  it('is idempotent: running twice does not duplicate or fail', async () => {
    const options = uniqueOptions();

    const first = await seed(options);
    await expect(seed(options)).resolves.toMatchObject({ created: false });
    // The requested client plus the built-in odudu-admin this tenant's
    // creation now provisions alongside it.
    expect(await countClients(first.tenantId)).toBe(2);
    expect(await countSigningKeys(first.tenantId)).toBe(1);
  });

  it('creates a public client when no secret is given', async () => {
    const options = uniqueOptions();
    const publicOptions: SeedOptions = {
      tenant: options.tenant,
      clientId: options.clientId,
      redirectUris: options.redirectUris,
      username: 'ada',
      password: 'correct-horse-battery',
    };

    const result = await seed(publicOptions);

    expect(await clientType(result.tenantId, result.clientId)).toBe('public');
  });

  it('refuses a redirect URI that is not absolute', async () => {
    const options = uniqueOptions();

    await expect(seed({ ...options, redirectUris: ['/callback'] })).rejects.toThrow(/absolute/);
  });

  // seedClientBootstrap is a third door that can create a tenant
  // (resolveTenantId's create branch, when the name it is given resolves to
  // no existing row) — the same rule createTenant and `seed tenant` refuse
  // through applies here too, so this door cannot hand a caller a reserved
  // or malformed tenant a raw CHECK violation would otherwise report.
  it('refuses the reserved tenant name count, creating nothing', async () => {
    const options = uniqueOptions();

    await expect(seed({ ...options, tenant: 'count' })).rejects.toThrow(/reserved/);
    const rows = await owner.db.select().from(tenants).where(eq(tenants.name, 'count'));
    expect(rows).toHaveLength(0);
  });

  // odudu-admin is reserved for the built-in admin client every tenant is
  // provisioned with. Requesting it as a *new* tenant's client used to reach
  // resolveTenantId first: the tenant row committed on the owner connection,
  // then provisionAdminClient created the public odudu-admin client, then
  // assertMatchesExisting rejected the requested confidential client inside
  // the (rolled-back) provisioning transaction — leaving a tenant row with no
  // flow, admin client or signing key for a retry to find.
  it('refuses the reserved client id odudu-admin, creating no tenant', async () => {
    const options = uniqueOptions();
    const tenantName = options.tenant;

    await expect(seed({ ...options, clientId: ADMIN_CLIENT_ID })).rejects.toThrow(/reserved/);
    const rows = await owner.db.select().from(tenants).where(eq(tenants.name, tenantName));
    expect(rows).toHaveLength(0);
  });

  it('refuses a tenant name that is not a DNS label, naming the rule', async () => {
    const options = uniqueOptions();

    await expect(seed({ ...options, tenant: 'Acme' })).rejects.toThrow(TENANT_NAME_RULE);
    const rows = await owner.db.select().from(tenants).where(eq(tenants.name, 'Acme'));
    expect(rows).toHaveLength(0);
  });

  it('refuses a second run with a different client secret for the same client', async () => {
    const options = uniqueOptions();

    await seed(options);

    await expect(seed({ ...options, clientSecret: 'different' })).rejects.toThrow(
      /different client secret/,
    );
  });

  it('refuses a second run with different redirect URIs for the same client', async () => {
    const options = uniqueOptions();

    await seed(options);

    await expect(
      seed({ ...options, redirectUris: ['https://app.example/other-callback'] }),
    ).rejects.toThrow(/different redirect URIs/);
  });

  it('refuses a --user naming someone not seeded on an already-existing client, rather than silently doing nothing', async () => {
    const options = uniqueOptions();

    await seed(options);

    await expect(
      seed({ ...options, username: 'grace', password: 'correct-horse-battery' }),
    ).rejects.toThrow(/grace/);
  });

  // Every `email` claim a demo or an end-to-end run has ever seen was put
  // there by a test helper, because seed could not set one. A claim nothing
  // in the product can produce is a claim nothing exercises.
  it('stores the email it is given on the seeded user', async () => {
    const options = uniqueOptions();

    const result = await seed({ ...options, email: 'ada@example.com' });

    expect(await seededEmail(result.tenantId, 'ada')).toBe('ada@example.com');
  });

  it('leaves the seeded user without an email when none is given', async () => {
    const options = uniqueOptions();

    const result = await seed(options);

    expect(await seededEmail(result.tenantId, 'ada')).toBeNull();
  });

  it('refuses an address the email claim could not carry', async () => {
    const options = uniqueOptions();

    await expect(seed({ ...options, email: 'ada at example.com' })).rejects.toThrow(/email/);
  });

  it('refuses a second run with a different email for the same user', async () => {
    const options = uniqueOptions();

    await seed({ ...options, email: 'ada@example.com' });

    await expect(seed({ ...options, email: 'ada@other.example' })).rejects.toThrow(
      /different email/,
    );
  });

  it('defaults a confidential client to client_secret_basic', async () => {
    const options = uniqueOptions();

    const result = await seed(options);

    expect(await tokenEndpointAuthMethod(result.tenantId, result.clientId)).toBe(
      'client_secret_basic',
    );
  });

  it('seeds a confidential client with client_secret_post when requested', async () => {
    const options = uniqueOptions();

    const result = await seed({ ...options, tokenEndpointAuthMethod: 'client_secret_post' });

    expect(await tokenEndpointAuthMethod(result.tenantId, result.clientId)).toBe(
      'client_secret_post',
    );
  });

  it('refuses tokenEndpointAuthMethod given without a client secret', async () => {
    const options = uniqueOptions();
    const publicOptions: SeedOptions = {
      tenant: options.tenant,
      clientId: options.clientId,
      redirectUris: options.redirectUris,
      tokenEndpointAuthMethod: 'client_secret_post',
    };

    await expect(seed(publicOptions)).rejects.toThrow(/client secret/);
  });

  // Omitting the option is not "leave whatever is there alone": seed
  // asserts the whole desired state, and the option has a default, so an
  // omitted flag asserts that default. An operator who seeded
  // client_secret_post and re-runs the command without the flag is asking
  // for something different from what exists, and has to be told so in
  // terms they can act on.
  it('refuses a second run that omits the auth method for a client_secret_post client', async () => {
    const options = uniqueOptions();

    await seed({ ...options, tokenEndpointAuthMethod: 'client_secret_post' });

    await expect(seed(options)).rejects.toThrow(/token endpoint auth method/);
  });

  it('names the stored method, the asserted one, and where the asserted one came from', async () => {
    const options = uniqueOptions();

    await seed({ ...options, tokenEndpointAuthMethod: 'client_secret_post' });

    const error = await seed(options).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    if (!(error instanceof Error)) throw new Error('expected seed to reject');
    expect(error.message).toContain('client_secret_post');
    expect(error.message).toContain('client_secret_basic');
    expect(error.message).toContain('--token-endpoint-auth-method');
  });

  it('refuses a second run with a different token endpoint auth method for the same client', async () => {
    const options = uniqueOptions();

    await seed({ ...options, tokenEndpointAuthMethod: 'client_secret_basic' });

    await expect(
      seed({ ...options, tokenEndpointAuthMethod: 'client_secret_post' }),
    ).rejects.toThrow(/token endpoint auth method/);
  });
});

describe('seed: service-account subject', () => {
  it('links a confidential client to a service-account subject', async () => {
    const options = uniqueOptions();

    const result = await seed(options);

    expect(await serviceSubjectType(result.tenantId, result.clientId)).toBe('service');
  });

  it('creates a public client with no service-account subject', async () => {
    const options = uniqueOptions();
    const publicOptions: SeedOptions = {
      tenant: options.tenant,
      clientId: options.clientId,
      redirectUris: options.redirectUris,
      username: 'ada',
      password: 'correct-horse-battery',
    };

    const result = await seed(publicOptions);

    expect(await serviceSubjectType(result.tenantId, result.clientId)).toBeNull();
  });
});

async function actionTokenCount(tenantId: string): Promise<number> {
  const rows = await owner.db
    .select()
    .from(actionTokens)
    .where(eq(actionTokens.tenantId, tenantId));
  return rows.length;
}

describe('seed: --send-verification-email', () => {
  it('reports the seeded user’s subject id', async () => {
    const options = uniqueOptions();

    const result = await seed(options);

    expect(result.userSubjectId).toEqual(expect.any(String));
  });

  it('omits userSubjectId when no user was seeded', async () => {
    const options = uniqueOptions();
    const noUserOptions: SeedOptions = {
      tenant: options.tenant,
      clientId: options.clientId,
      redirectUris: options.redirectUris,
    };

    const result = await seed(noUserOptions);

    expect(result.userSubjectId).toBeUndefined();
  });

  // No ODUDU_SMTP_HOST is set anywhere in this file, so this exercises the
  // capturing adapter — the point here is that a real action_tokens row was
  // issued for the seeded user, not what happened to the rendered message.
  it('issues a real action token for the seeded user', async () => {
    const options = uniqueOptions();
    const withEmail: SeedOptions = { ...options, email: 'ada@example.com' };

    const result = await seed(withEmail);
    expect(await actionTokenCount(result.tenantId)).toBe(0);

    await seed({ ...withEmail, sendVerificationEmail: true });

    expect(await actionTokenCount(result.tenantId)).toBe(1);
  });

  it('accepts an explicit --issuer-base and still issues the token', async () => {
    const options = uniqueOptions();
    const withEmail: SeedOptions = { ...options, email: 'ada@example.com' };

    const result = await seed(withEmail);

    await seed({
      ...withEmail,
      sendVerificationEmail: true,
      issuerBase: 'https://idp.example.test',
    });

    expect(await actionTokenCount(result.tenantId)).toBe(1);
  });

  it('refuses sendVerificationEmail for a username never seeded with this client', async () => {
    const options = uniqueOptions();
    const noUserOptions: SeedOptions = {
      tenant: options.tenant,
      clientId: options.clientId,
      redirectUris: options.redirectUris,
    };

    await seed(noUserOptions);

    await expect(
      seed({
        ...noUserOptions,
        username: 'ghost',
        password: 'correct-horse-battery',
        email: 'ghost@example.com',
        sendVerificationEmail: true,
      }),
    ).rejects.toThrow(/was not seeded with it/);
  });
});

describe('seed tenant --set', () => {
  async function tenantSettings(tenantId: string) {
    const rows = await owner.db
      .select({
        otpRequired: tenants.otpRequired,
        registrationAllowed: tenants.registrationAllowed,
        passwordMaxAgeDays: tenants.passwordMaxAgeDays,
        displayName: tenants.displayName,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    const row = rows[0];
    if (row === undefined) throw new Error(`no tenant ${tenantId}`);
    return row;
  }

  it('applies settings to the tenant it creates, and reports which', async () => {
    const name = `set-${newId()}`;

    const result = await seed([
      'tenant',
      '--name',
      name,
      '--set',
      'otp_required=true',
      '--set',
      'password_max_age_days=90',
    ]);

    expect(result).toMatchObject({ command: 'tenant', created: true, tenant: name });
    // Echoed as they were given, not as the columns are spelled.
    expect(result).toMatchObject({ settings: ['otp_required', 'password_max_age_days'] });
    if (result.command !== 'tenant') throw new Error('expected the tenant command');
    expect(await tenantSettings(result.tenantId)).toMatchObject({
      otpRequired: true,
      passwordMaxAgeDays: 90,
    });
  });

  // Settings are configuration rather than identity, so a second call
  // changes them — unlike `seed client`, which refuses an existing client
  // rather than quietly widening a redirect allowlist.
  it('changes a setting on a tenant that already exists, leaving the rest alone', async () => {
    const name = `set-${newId()}`;
    const created = await seed(['tenant', '--name', name, '--set', 'registration_allowed=true']);
    if (created.command !== 'tenant') throw new Error('expected the tenant command');

    const again = await seed(['tenant', '--name', name, '--set', 'otp_required=true']);

    expect(again).toMatchObject({ created: false, tenantId: created.tenantId });
    expect(await tenantSettings(created.tenantId)).toMatchObject({
      registrationAllowed: true,
      otpRequired: true,
    });
  });

  it('omits the settings key entirely when no --set was given', async () => {
    const result = await seed(['tenant', '--name', `set-${newId()}`]);

    expect(result).not.toHaveProperty('settings');
  });

  it('refuses a name that is not a DNS label, naming the rule and creating nothing', async () => {
    await expect(seed(['tenant', '--name', 'Acme'])).rejects.toThrow(TENANT_NAME_RULE);
    const rows = await owner.db.select().from(tenants).where(eq(tenants.name, 'Acme'));
    expect(rows).toHaveLength(0);
  });

  it('refuses the reserved name count, the same as system', async () => {
    await expect(seed(['tenant', '--name', 'count'])).rejects.toThrow(/reserved/);
  });

  it('refuses an out-of-range value before creating the tenant, naming every problem', async () => {
    const name = `set-${newId()}`;

    await expect(
      seed([
        'tenant',
        '--name',
        name,
        '--set',
        'password_max_age_days=4000',
        '--set',
        'max_clients=-1',
      ]),
    ).rejects.toThrow(/password_max_age_days must be between 0 and 3650.*max_clients/su);

    expect(await owner.db.select().from(tenants).where(eq(tenants.name, name))).toHaveLength(0);
  });

  it('judges a value against the stored settings, and writes nothing it refuses', async () => {
    const name = `set-${newId()}`;
    const created = await seed(['tenant', '--name', name, '--set', 'sso_session_idle_seconds=600']);
    if (created.command !== 'tenant') throw new Error('expected the tenant command');

    await expect(
      seed([
        'tenant',
        '--name',
        name,
        '--set',
        'otp_required=true',
        '--set',
        'sso_session_max_seconds=300',
      ]),
    ).rejects.toThrow(/sso_session_idle_seconds must not exceed sso_session_max_seconds/u);

    expect(await tenantSettings(created.tenantId)).toMatchObject({ otpRequired: false });
  });

  it('judges a new tenant against the column defaults', async () => {
    await expect(
      seed(['tenant', '--name', `set-${newId()}`, '--set', 'sso_session_max_seconds=600']),
    ).rejects.toThrow(/sso_session_idle_seconds must not exceed sso_session_max_seconds/u);
  });

  it('cannot write a client cap the database refuses', async () => {
    const name = `set-${newId()}`;

    await expect(seed(['tenant', '--name', name, '--set', 'max_clients=-1'])).rejects.toThrow();
  });

  it('cannot write a registration policy the database refuses', async () => {
    const name = `set-${newId()}`;

    await expect(
      seed(['tenant', '--name', name, '--set', 'client_registration_policy=nonsense']),
    ).rejects.toThrow();
  });

  it('refuses a setting name it does not know, and names the ones it does', async () => {
    await expect(
      seed(['tenant', '--name', `set-${newId()}`, '--set', 'otp_requried=true']),
    ).rejects.toThrow(/unknown tenant setting "otp_requried".*otp_required/su);
  });

  it('refuses a value of the wrong shape', async () => {
    await expect(
      seed(['tenant', '--name', `set-${newId()}`, '--set', 'otp_required=yes']),
    ).rejects.toThrow(/expects a boolean/u);
    await expect(
      seed(['tenant', '--name', `set-${newId()}`, '--set', 'password_max_age_days=ninety']),
    ).rejects.toThrow(/expects an integer/u);
    await expect(
      seed(['tenant', '--name', `set-${newId()}`, '--set', 'otp_required']),
    ).rejects.toThrow(/expects name=value/u);
  });
});

describe('seed tenant provisions the admin client', () => {
  // Simulates a tenant seeded before this behaviour existed: provisioned
  // and keyed, the way `performSeed`/`runTenantCommand` leave a new tenant,
  // but without the admin client either of them now provisions alongside it.
  async function createTenantWithoutAdminClient(name: string): Promise<string> {
    const tenantId = newId();
    await tenantLookupRepository(owner.db).create({ id: tenantId, name });
    await withTenant(owner.db, tenantId, async (tx) => {
      await provisionTenant(tx, tenantId);
      const generated = await generateSigningKey('RS256', Buffer.alloc(32, 7));
      await signingKeyRepository(tx).create({
        id: newId(),
        tenantId,
        kid: generated.kid,
        alg: generated.alg,
        status: 'active',
        publicJwk: generated.publicJwk,
        privateJwkEncrypted: generated.privateJwkEncrypted,
      });
    });
    return tenantId;
  }

  async function adminClientRoles(tenantId: string): Promise<{ builtinAdmin: boolean } | null> {
    return withTenant(owner.db, tenantId, async (tx) => {
      const client = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
      if (client === null) return null;
      const admin = await roleRepository(tx).byName(TENANT_ADMIN, client.id);
      expect(admin).not.toBeNull();
      return { builtinAdmin: client.builtinAdmin };
    });
  }

  it('creates the built-in admin client via `seed tenant`, once on a second run', async () => {
    const name = `tenant-admin-${newId()}`;

    const first = await seed(['tenant', '--name', name]);
    if (first.command !== 'tenant') throw new Error('expected the tenant command');
    expect(await adminClientRoles(first.tenantId)).toMatchObject({ builtinAdmin: true });
    expect(await countAdminClients(first.tenantId)).toBe(1);

    const second = await seed(['tenant', '--name', name]);
    if (second.command !== 'tenant') throw new Error('expected the tenant command');
    expect(await countAdminClients(second.tenantId)).toBe(1);
  });

  it('creates the built-in admin client via `seed --tenant`, once on a second run', async () => {
    const options = uniqueOptions();

    const first = await seed(options);
    expect(await adminClientRoles(first.tenantId)).toMatchObject({ builtinAdmin: true });
    expect(await countAdminClients(first.tenantId)).toBe(1);

    const second = await seed(options);
    expect(second.tenantId).toBe(first.tenantId);
    expect(await countAdminClients(first.tenantId)).toBe(1);
  });

  it('gives a tenant seeded before this existed an admin client via `seed tenant`, once on a second run', async () => {
    const name = `tenant-preexisting-${newId()}`;
    const tenantId = await createTenantWithoutAdminClient(name);
    expect(await countAdminClients(tenantId)).toBe(0);

    const first = await seed(['tenant', '--name', name]);
    if (first.command !== 'tenant') throw new Error('expected the tenant command');
    expect(first.created).toBe(false);
    expect(await countAdminClients(tenantId)).toBe(1);

    const second = await seed(['tenant', '--name', name]);
    if (second.command !== 'tenant') throw new Error('expected the tenant command');
    expect(await countAdminClients(tenantId)).toBe(1);
  });

  it('gives a tenant seeded before this existed an admin client via `seed --tenant`, once on a second run', async () => {
    const options = uniqueOptions();
    const tenantId = await createTenantWithoutAdminClient(options.tenant);
    expect(await countAdminClients(tenantId)).toBe(0);

    const first = await seed(options);
    expect(first.tenantId).toBe(tenantId);
    expect(await countAdminClients(tenantId)).toBe(1);

    const second = await seed(options);
    expect(second.tenantId).toBe(tenantId);
    expect(await countAdminClients(tenantId)).toBe(1);
  });
});

describe('seed client --post-logout-redirect-uri', () => {
  it('registers the URIs RP-Initiated Logout matches against', async () => {
    const options = uniqueOptions();
    await seed(options);

    await seed([
      'client',
      '--tenant',
      options.tenant,
      '--client-id',
      'logout-spa',
      '--public',
      '--redirect-uri',
      'https://app.example/callback',
      '--post-logout-redirect-uri',
      'https://app.example/logged-out',
    ]);

    const tenantId = (
      await owner.db.select().from(tenants).where(eq(tenants.name, options.tenant))
    )[0]?.id;
    if (tenantId === undefined) throw new Error('expected the seeded tenant');
    const stored = await withTenant(owner.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(clients)
        .where(and(eq(clients.tenantId, tenantId), eq(clients.clientId, 'logout-spa')));
      const client = rows[0];
      if (client === undefined) throw new Error('expected the seeded client');
      return clientOidcConfigRepository(tx).byClientId(client.id);
    });
    expect(stored?.postLogoutRedirectUris).toEqual(['https://app.example/logged-out']);
  });

  it('refuses one that is not absolute', async () => {
    const options = uniqueOptions();
    await seed(options);

    await expect(
      seed([
        'client',
        '--tenant',
        options.tenant,
        '--client-id',
        'relative-spa',
        '--public',
        '--post-logout-redirect-uri',
        '/logged-out',
      ]),
    ).rejects.toThrow(/absolute/u);
  });
});

async function grantTypesOf(tenantName: string, oauthClientId: string): Promise<string[]> {
  const tenantId = (await owner.db.select().from(tenants).where(eq(tenants.name, tenantName)))[0]
    ?.id;
  if (tenantId === undefined) throw new Error(`expected tenant ${tenantName}`);
  return withTenant(owner.db, tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(clients)
      .where(and(eq(clients.tenantId, tenantId), eq(clients.clientId, oauthClientId)));
    const client = rows[0];
    if (client === undefined) throw new Error(`expected client ${oauthClientId}`);
    const config = await clientOidcConfigRepository(tx).byClientId(client.id);
    if (config === null) throw new Error(`no oidc config for client ${oauthClientId}`);
    return config.grantTypes;
  });
}

describe('seed client --grant-type', () => {
  it('registers only the grants named by --grant-type', async () => {
    const options = uniqueOptions();
    await seed(options);

    await seed([
      'client',
      '--tenant',
      options.tenant,
      '--client-id',
      'narrow',
      '--client-secret',
      'secret',
      '--redirect-uri',
      'https://app.example/cb',
      '--grant-type',
      'authorization_code',
    ]);

    expect(await grantTypesOf(options.tenant, 'narrow')).toEqual(['authorization_code']);
  });

  it('refuses a grant type this server does not implement', async () => {
    const options = uniqueOptions();
    await seed(options);

    await expect(
      seed([
        'client',
        '--tenant',
        options.tenant,
        '--client-id',
        'bogus',
        '--client-secret',
        'secret',
        '--redirect-uri',
        'https://app.example/cb',
        '--grant-type',
        'password',
      ]),
    ).rejects.toThrow(/grant-type/u);
  });

  it('still gives a public client two grants and no client_credentials', async () => {
    const options = uniqueOptions();
    await seed(options);

    await seed([
      'client',
      '--tenant',
      options.tenant,
      '--client-id',
      'pub',
      '--public',
      '--redirect-uri',
      'https://app.example/cb',
    ]);

    expect(await grantTypesOf(options.tenant, 'pub')).toEqual([
      'authorization_code',
      'refresh_token',
    ]);
  });

  it('still gives a confidential client all three grants when omitted', async () => {
    const options = uniqueOptions();
    await seed(options);

    await seed([
      'client',
      '--tenant',
      options.tenant,
      '--client-id',
      'wide',
      '--client-secret',
      'secret',
      '--redirect-uri',
      'https://app.example/cb',
    ]);

    expect(await grantTypesOf(options.tenant, 'wide')).toEqual([
      'authorization_code',
      'refresh_token',
      'client_credentials',
    ]);
  });
});

describe('seed registration-token', () => {
  it('prints a token, and nothing but the token', async () => {
    const options = uniqueOptions();
    await seed(options);

    const result = await seed([
      'registration-token',
      '--tenant',
      options.tenant,
      '--uses',
      '1',
      '--ttl',
      '600',
    ]);

    expect(result).toMatchObject({ command: 'registration-token', tenant: options.tenant });
    if (result.command !== 'registration-token') throw new Error('expected registration-token');
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });

  it('spends exactly once against a --uses 1 mint', async () => {
    const options = uniqueOptions();
    await seed(options);

    const result = await seed([
      'registration-token',
      '--tenant',
      options.tenant,
      '--uses',
      '1',
      '--ttl',
      '600',
    ]);
    if (result.command !== 'registration-token') throw new Error('expected registration-token');

    const tenantId = (
      await owner.db.select().from(tenants).where(eq(tenants.name, options.tenant))
    )[0]?.id;
    if (tenantId === undefined) throw new Error('expected the seeded tenant');

    const first = await withTenant(owner.db, tenantId, (tx) =>
      clientRegistrationTokenRepository(tx).spend(tenantId, result.token),
    );
    const second = await withTenant(owner.db, tenantId, (tx) =>
      clientRegistrationTokenRepository(tx).spend(tenantId, result.token),
    );

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('refuses a tenant that does not exist', async () => {
    await expect(
      seed(['registration-token', '--tenant', `no-such-${newId()}`, '--uses', '1', '--ttl', '600']),
    ).rejects.toThrow(/no tenant named/u);
  });
});

async function countAdminClients(tenantId: string): Promise<number> {
  const rows = await owner.db
    .select()
    .from(clients)
    .where(and(eq(clients.tenantId, tenantId), eq(clients.clientId, ADMIN_CLIENT_ID)));
  return rows.length;
}

describe('seed admin', () => {
  it('refuses a username that already administers', async () => {
    const username = `root-${newId()}`;
    await seedAdmin({ username });
    await expect(seedAdmin({ username })).rejects.toMatchObject({ code: 'seed_admin_exists' });
  });

  it('creates the subject with manage-tenants and a forced password change', async () => {
    const result = await seedAdmin({ username: `ada-${newId()}` });

    expect(result.password).toHaveLength(32);
    await withTenant(owner.db, result.tenantId, async (tx) => {
      const actions = await requiredActionRepository(tx).pendingFor(result.subjectId);
      expect(actions).toContain('update-password');
      const reach = await effectiveRoles(tx, result.subjectId);
      expect(reach.map((r) => r.name)).toContain('manage-tenants');
    });
  });

  it('gives the system tenant a signing key, so it can issue admin tokens', async () => {
    const result = await seedAdmin({ username: `kai-${newId()}` });

    await withTenant(owner.db, result.tenantId, async (tx) => {
      await expect(signingKeyRepository(tx).active()).resolves.toMatchObject({
        status: 'active',
      });
    });
  });

  it(
    'creates the system tenant when none exists, and a second run with a ' +
      'different username reuses it',
    async () => {
      const first = await seedAdmin({ username: `first-${newId()}` });
      expect(first.tenantId).toBe(SYSTEM_TENANT_ID);

      const tenantRow = (
        await owner.db.select().from(tenants).where(eq(tenants.name, SYSTEM_TENANT_NAME))
      )[0];
      expect(tenantRow?.id).toBe(SYSTEM_TENANT_ID);

      const second = await seedAdmin({ username: `second-${newId()}` });
      expect(second.tenantId).toBe(first.tenantId);
      expect(await countAdminClients(first.tenantId)).toBe(1);
    },
  );

  // The CLI dispatch path (`odudu seed admin --username …`), as opposed to
  // calling seedAdmin directly: the result main.ts logs as JSON carries no
  // password, since that is printed once, separately, by runAdminCommand.
  it('reports the admin command result with no password in it', async () => {
    const username = `via-cli-${newId()}`;

    const result = await seed(['admin', '--username', username]);

    expect(result).toMatchObject({ command: 'admin', username, tenantId: SYSTEM_TENANT_ID });
    expect(result).not.toHaveProperty('password');
  });
});
