import { actionTokens } from '@odudu/account';
import { signingKeys } from '@odudu/crypto';
import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { subjects, users } from '@odudu/domain-identity';
import {
  clientRegistrationTokenRepository,
  clients,
  clientScopeRepository,
  TENANT_DEFAULT_SCOPE_NAMES,
} from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { clientOidcConfigRepository } from '@odudu/protocol-oidc';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed, type SeedOptions } from '#/cli/seed';

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
    expect(await countClients(first.tenantId)).toBe(1);
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

  // The ranges live in CHECK constraints (migrations 0028, 0035, 0041), and
  // this is what proves the CLI has no way past them.
  it('cannot write a value the database refuses', async () => {
    const name = `set-${newId()}`;

    await expect(
      seed(['tenant', '--name', name, '--set', 'password_max_age_days=4000']),
    ).rejects.toThrow();

    const rows = await owner.db.select().from(tenants).where(eq(tenants.name, name));
    // The tenant itself was created before the setting was applied, so the
    // refusal leaves it at the column default rather than at 4000.
    expect(rows[0]?.passwordMaxAgeDays).toBe(0);
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
