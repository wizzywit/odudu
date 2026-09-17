import { actionTokens } from '@odudu/account';
import { signingKeys } from '@odudu/crypto';
import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
} from '@odudu/db';
import { subjects, users } from '@odudu/domain-identity';
import { clients, clientScopeRepository, REALM_DEFAULT_SCOPE_NAMES } from '@odudu/domain-realm';
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

// Every helper below scopes by realmId: this container's owner is a
// superuser and so escapes RLS even under FORCE, and each test seeds its own
// realm, so an unscoped count would
// pick up every realm this file has already seeded rather than just the
// one under test.
async function countClients(realmId: string): Promise<number> {
  const rows = await owner.db.select().from(clients).where(eq(clients.realmId, realmId));
  return rows.length;
}

async function countSigningKeys(realmId: string): Promise<number> {
  const rows = await owner.db.select().from(signingKeys).where(eq(signingKeys.realmId, realmId));
  return rows.length;
}

async function clientType(realmId: string, clientId: string): Promise<string> {
  const rows = await owner.db
    .select({ type: clients.type })
    .from(clients)
    .where(and(eq(clients.realmId, realmId), eq(clients.clientId, clientId)));
  const row = rows[0];
  if (row === undefined) throw new Error(`no client ${clientId} in realm ${realmId}`);
  return row.type;
}

async function tokenEndpointAuthMethod(realmId: string, oauthClientId: string): Promise<string> {
  return withRealm(owner.db, realmId, async (tx) => {
    const clientRows = await tx
      .select()
      .from(clients)
      .where(and(eq(clients.realmId, realmId), eq(clients.clientId, oauthClientId)));
    const clientRow = clientRows[0];
    if (clientRow === undefined) throw new Error(`no client ${oauthClientId} in realm ${realmId}`);
    const config = await clientOidcConfigRepository(tx).byClientId(clientRow.id);
    if (config === null) throw new Error(`no oidc config for client ${oauthClientId}`);
    return config.tokenEndpointAuthMethod;
  });
}

async function serviceSubjectType(realmId: string, clientId: string): Promise<string | null> {
  const clientRows = await owner.db
    .select({ serviceSubjectId: clients.serviceSubjectId })
    .from(clients)
    .where(and(eq(clients.realmId, realmId), eq(clients.clientId, clientId)));
  const clientRow = clientRows[0];
  if (clientRow === undefined) throw new Error(`no client ${clientId} in realm ${realmId}`);
  if (clientRow.serviceSubjectId === null) return null;

  const subjectRows = await owner.db
    .select({ type: subjects.type })
    .from(subjects)
    .where(eq(subjects.id, clientRow.serviceSubjectId));
  const subjectRow = subjectRows[0];
  if (subjectRow === undefined) throw new Error(`no subject ${clientRow.serviceSubjectId}`);
  return subjectRow.type;
}

async function seededEmail(realmId: string, username: string): Promise<string | null> {
  const rows = await owner.db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.realmId, realmId), eq(users.username, username)));
  const row = rows[0];
  if (row === undefined) throw new Error(`no user ${username} in realm ${realmId}`);
  return row.email;
}

async function assignedScopes(realmId: string, oauthClientId: string): Promise<string[]> {
  return withRealm(owner.db, realmId, async (tx) => {
    const clientRows = await tx
      .select()
      .from(clients)
      .where(and(eq(clients.realmId, realmId), eq(clients.clientId, oauthClientId)));
    const clientRow = clientRows[0];
    if (clientRow === undefined) throw new Error(`no client ${oauthClientId} in realm ${realmId}`);
    const scopes = await clientScopeRepository(tx).forClient(clientRow.id);
    return scopes.map((scope) => scope.name).sort();
  });
}

function uniqueOptions(): SeedOptions {
  const suffix = newId();
  return {
    realm: `acme-${suffix}`,
    clientId: 'web-app',
    clientSecret: 's3cret',
    redirectUris: ['https://app.example/callback'],
    username: 'ada',
    password: 'correct-horse-battery',
  };
}

describe('seed', () => {
  it('creates a realm, a client, a user and a signing key', async () => {
    const options = uniqueOptions();

    const result = await seed(options);

    expect(result).toMatchObject({ created: true, realm: options.realm, clientId: 'web-app' });
    expect(await countSigningKeys(result.realmId)).toBe(1);
  });

  // /authorize refuses a scope the client is not assigned, so a seeded
  // client that got none would refuse `openid` on its very first request.
  it('assigns the realm vocabulary to the client it creates', async () => {
    const options = uniqueOptions();

    const result = await seed(options);

    expect(await assignedScopes(result.realmId, result.clientId)).toEqual(
      [...REALM_DEFAULT_SCOPE_NAMES].sort(),
    );
  });

  it('is idempotent: running twice does not duplicate or fail', async () => {
    const options = uniqueOptions();

    const first = await seed(options);
    await expect(seed(options)).resolves.toMatchObject({ created: false });
    expect(await countClients(first.realmId)).toBe(1);
    expect(await countSigningKeys(first.realmId)).toBe(1);
  });

  it('creates a public client when no secret is given', async () => {
    const options = uniqueOptions();
    const publicOptions: SeedOptions = {
      realm: options.realm,
      clientId: options.clientId,
      redirectUris: options.redirectUris,
      username: 'ada',
      password: 'correct-horse-battery',
    };

    const result = await seed(publicOptions);

    expect(await clientType(result.realmId, result.clientId)).toBe('public');
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

    expect(await seededEmail(result.realmId, 'ada')).toBe('ada@example.com');
  });

  it('leaves the seeded user without an email when none is given', async () => {
    const options = uniqueOptions();

    const result = await seed(options);

    expect(await seededEmail(result.realmId, 'ada')).toBeNull();
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

    expect(await tokenEndpointAuthMethod(result.realmId, result.clientId)).toBe(
      'client_secret_basic',
    );
  });

  it('seeds a confidential client with client_secret_post when requested', async () => {
    const options = uniqueOptions();

    const result = await seed({ ...options, tokenEndpointAuthMethod: 'client_secret_post' });

    expect(await tokenEndpointAuthMethod(result.realmId, result.clientId)).toBe(
      'client_secret_post',
    );
  });

  it('refuses tokenEndpointAuthMethod given without a client secret', async () => {
    const options = uniqueOptions();
    const publicOptions: SeedOptions = {
      realm: options.realm,
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

    expect(await serviceSubjectType(result.realmId, result.clientId)).toBe('service');
  });

  it('creates a public client with no service-account subject', async () => {
    const options = uniqueOptions();
    const publicOptions: SeedOptions = {
      realm: options.realm,
      clientId: options.clientId,
      redirectUris: options.redirectUris,
      username: 'ada',
      password: 'correct-horse-battery',
    };

    const result = await seed(publicOptions);

    expect(await serviceSubjectType(result.realmId, result.clientId)).toBeNull();
  });
});

async function actionTokenCount(realmId: string): Promise<number> {
  const rows = await owner.db.select().from(actionTokens).where(eq(actionTokens.realmId, realmId));
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
      realm: options.realm,
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
    expect(await actionTokenCount(result.realmId)).toBe(0);

    await seed({ ...withEmail, sendVerificationEmail: true });

    expect(await actionTokenCount(result.realmId)).toBe(1);
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

    expect(await actionTokenCount(result.realmId)).toBe(1);
  });

  it('refuses sendVerificationEmail for a username never seeded with this client', async () => {
    const options = uniqueOptions();
    const noUserOptions: SeedOptions = {
      realm: options.realm,
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

describe('seed realm --set', () => {
  async function realmSettings(realmId: string) {
    const rows = await owner.db
      .select({
        otpRequired: realms.otpRequired,
        registrationAllowed: realms.registrationAllowed,
        passwordMaxAgeDays: realms.passwordMaxAgeDays,
        displayName: realms.displayName,
      })
      .from(realms)
      .where(eq(realms.id, realmId));
    const row = rows[0];
    if (row === undefined) throw new Error(`no realm ${realmId}`);
    return row;
  }

  it('applies settings to the realm it creates, and reports which', async () => {
    const name = `set-${newId()}`;

    const result = await seed([
      'realm',
      '--name',
      name,
      '--set',
      'otp_required=true',
      '--set',
      'password_max_age_days=90',
    ]);

    expect(result).toMatchObject({ command: 'realm', created: true, realm: name });
    // Echoed as they were given, not as the columns are spelled.
    expect(result).toMatchObject({ settings: ['otp_required', 'password_max_age_days'] });
    if (result.command !== 'realm') throw new Error('expected the realm command');
    expect(await realmSettings(result.realmId)).toMatchObject({
      otpRequired: true,
      passwordMaxAgeDays: 90,
    });
  });

  // Settings are configuration rather than identity, so a second call
  // changes them — unlike `seed client`, which refuses an existing client
  // rather than quietly widening a redirect allowlist.
  it('changes a setting on a realm that already exists, leaving the rest alone', async () => {
    const name = `set-${newId()}`;
    const created = await seed(['realm', '--name', name, '--set', 'registration_allowed=true']);
    if (created.command !== 'realm') throw new Error('expected the realm command');

    const again = await seed(['realm', '--name', name, '--set', 'otp_required=true']);

    expect(again).toMatchObject({ created: false, realmId: created.realmId });
    expect(await realmSettings(created.realmId)).toMatchObject({
      registrationAllowed: true,
      otpRequired: true,
    });
  });

  it('omits the settings key entirely when no --set was given', async () => {
    const result = await seed(['realm', '--name', `set-${newId()}`]);

    expect(result).not.toHaveProperty('settings');
  });

  // The ranges live in CHECK constraints (migrations 0028, 0035, 0041), and
  // this is what proves the CLI has no way past them.
  it('cannot write a value the database refuses', async () => {
    const name = `set-${newId()}`;

    await expect(
      seed(['realm', '--name', name, '--set', 'password_max_age_days=4000']),
    ).rejects.toThrow();

    const rows = await owner.db.select().from(realms).where(eq(realms.name, name));
    // The realm itself was created before the setting was applied, so the
    // refusal leaves it at the column default rather than at 4000.
    expect(rows[0]?.passwordMaxAgeDays).toBe(0);
  });

  it('refuses a setting name it does not know, and names the ones it does', async () => {
    await expect(
      seed(['realm', '--name', `set-${newId()}`, '--set', 'otp_requried=true']),
    ).rejects.toThrow(/unknown realm setting "otp_requried".*otp_required/su);
  });

  it('refuses a value of the wrong shape', async () => {
    await expect(
      seed(['realm', '--name', `set-${newId()}`, '--set', 'otp_required=yes']),
    ).rejects.toThrow(/expects a boolean/u);
    await expect(
      seed(['realm', '--name', `set-${newId()}`, '--set', 'password_max_age_days=ninety']),
    ).rejects.toThrow(/expects an integer/u);
    await expect(
      seed(['realm', '--name', `set-${newId()}`, '--set', 'otp_required']),
    ).rejects.toThrow(/expects name=value/u);
  });
});

describe('seed client --post-logout-redirect-uri', () => {
  it('registers the URIs RP-Initiated Logout matches against', async () => {
    const options = uniqueOptions();
    await seed(options);

    await seed([
      'client',
      '--realm',
      options.realm,
      '--client-id',
      'logout-spa',
      '--public',
      '--redirect-uri',
      'https://app.example/callback',
      '--post-logout-redirect-uri',
      'https://app.example/logged-out',
    ]);

    const realmId = (await owner.db.select().from(realms).where(eq(realms.name, options.realm)))[0]
      ?.id;
    if (realmId === undefined) throw new Error('expected the seeded realm');
    const stored = await withRealm(owner.db, realmId, async (tx) => {
      const rows = await tx
        .select()
        .from(clients)
        .where(and(eq(clients.realmId, realmId), eq(clients.clientId, 'logout-spa')));
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
        '--realm',
        options.realm,
        '--client-id',
        'relative-spa',
        '--public',
        '--post-logout-redirect-uri',
        '/logged-out',
      ]),
    ).rejects.toThrow(/absolute/u);
  });
});
