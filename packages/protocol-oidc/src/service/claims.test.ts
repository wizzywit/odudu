import { describe, expect, it } from 'vitest';
import { standardClaimMappers, type ClaimContext } from '#/service/claims';

const subjectId = 'subject-1';

function ctx(user: ClaimContext['user']): ClaimContext {
  return { subjectId, user, roles: [], groups: [], bindings: new Map() };
}

// Builds a context straight from profile-field overrides, for tests that
// only care about one mapper's inputs and outputs.
function ctxWith(overrides: Partial<NonNullable<ClaimContext['user']>>): ClaimContext {
  return ctx(testUser(overrides));
}

// Fills every OIDC Core §5.1 profile field with null so a fixture only
// needs to state what the mapper under test actually reads.
function testUser(
  overrides: Partial<NonNullable<ClaimContext['user']>>,
): NonNullable<ClaimContext['user']> {
  return {
    subjectId,
    tenantId: 'tenant-1',
    username: 'alice',
    email: null,
    emailVerified: false,
    name: null,
    givenName: null,
    familyName: null,
    middleName: null,
    nickname: null,
    preferredUsername: null,
    profile: null,
    picture: null,
    website: null,
    gender: null,
    birthdate: null,
    zoneinfo: null,
    locale: null,
    phoneNumber: null,
    phoneNumberVerified: false,
    profileUpdatedAt: null,
    addressFormatted: null,
    addressStreet: null,
    addressLocality: null,
    addressRegion: null,
    addressPostalCode: null,
    addressCountry: null,
    ...overrides,
  };
}

const roleGroupCtx: ClaimContext = {
  subjectId: 'sub-1',
  user: null,
  roles: [
    { roleId: 'r2', name: 'reader', clientKey: 'reports-api' },
    { roleId: 'r1', name: 'admin', clientKey: null },
    { roleId: 'r3', name: 'admin', clientKey: null },
  ],
  groups: ['/engineering/platform', '/engineering'],
  bindings: new Map(),
};

describe('the standard OIDC claim mappers', () => {
  it('runs only mappers whose scopes were granted', async () => {
    const registry = standardClaimMappers();

    const claims = await registry.assemble(['openid'], ctx(null));

    expect(claims).toHaveProperty('sub');
    expect(claims).not.toHaveProperty('email');
  });

  it('runs the email mapper when the email scope is granted', async () => {
    const registry = standardClaimMappers();
    const user = testUser({ email: 'alice@example.com', emailVerified: true });

    expect(await registry.assemble(['openid', 'email'], ctx(user))).toHaveProperty('email');
  });

  it('rejects a duplicate mapper name rather than silently replacing it', () => {
    const registry = standardClaimMappers();

    expect(() =>
      registry.register({
        name: 'sub',
        scopes: ['openid'],
        claims: ['sub'],
        map: () => Promise.resolve({}),
      }),
    ).toThrow(/already registered/);
  });

  it('lets a later mapper add claims without dropping an earlier one', async () => {
    const registry = standardClaimMappers();
    const user = testUser({ email: 'alice@example.com', emailVerified: true });

    const claims = await registry.assemble(['openid', 'profile', 'email'], ctx(user));

    expect(Object.keys(claims).sort()).toEqual([
      'email',
      'email_verified',
      'name',
      'preferred_username',
      'sub',
    ]);
  });

  it('omits email and email_verified when the user has no email on file', async () => {
    const registry = standardClaimMappers();
    const user = testUser({});

    const claims = await registry.assemble(['openid', 'email'], ctx(user));

    expect(claims).not.toHaveProperty('email');
    expect(claims).not.toHaveProperty('email_verified');
  });

  it('omits every user-derived claim when there is no user row for the subject', async () => {
    const registry = standardClaimMappers();

    const claims = await registry.assemble(['openid', 'profile', 'email'], ctx(null));

    expect(claims).toEqual({ sub: subjectId });
  });

  it('advertises exactly the claim names the standard mappers can produce', () => {
    const registry = standardClaimMappers();

    expect([...registry.claimNames()].sort()).toEqual([
      'address',
      'birthdate',
      'email',
      'email_verified',
      'family_name',
      'gender',
      'given_name',
      'groups',
      'locale',
      'middle_name',
      'name',
      'nickname',
      'phone_number',
      'phone_number_verified',
      'picture',
      'preferred_username',
      'profile',
      'roles',
      'sub',
      'updated_at',
      'website',
      'zoneinfo',
    ]);
  });
});

describe('profile mapper', () => {
  it('emits section 5.4 profile claims from stored attributes', async () => {
    const claims = await standardClaimMappers().assemble(
      ['openid', 'profile'],
      ctxWith({
        name: 'Ada Lovelace',
        givenName: 'Ada',
        familyName: 'Lovelace',
        nickname: 'Ada',
        locale: 'en-GB',
        zoneinfo: 'Europe/London',
      }),
    );
    expect(claims).toMatchObject({
      name: 'Ada Lovelace',
      given_name: 'Ada',
      family_name: 'Lovelace',
      nickname: 'Ada',
      locale: 'en-GB',
      zoneinfo: 'Europe/London',
    });
  });

  it('falls back to the username when no display name is stored', async () => {
    const claims = await standardClaimMappers().assemble(
      ['openid', 'profile'],
      ctxWith({ name: null, username: 'ada' }),
    );
    expect(claims.name).toBe('ada');
  });

  it('falls back to the username for preferred_username too', async () => {
    const claims = await standardClaimMappers().assemble(
      ['openid', 'profile'],
      ctxWith({ preferredUsername: null, username: 'ada' }),
    );
    expect(claims.preferred_username).toBe('ada');
  });

  it('omits a claim with nothing behind it rather than emitting null', async () => {
    const claims = await standardClaimMappers().assemble(
      ['openid', 'profile'],
      ctxWith({ name: 'Ada', givenName: null }),
    );
    expect(claims).not.toHaveProperty('given_name');
  });

  it('emits updated_at as seconds since the epoch', async () => {
    const claims = await standardClaimMappers().assemble(
      ['openid', 'profile'],
      ctxWith({ profileUpdatedAt: new Date('2026-01-01T00:00:00Z') }),
    );
    expect(claims.updated_at).toBe(1_767_225_600);
  });

  it('omits updated_at when the profile has never been updated', async () => {
    const claims = await standardClaimMappers().assemble(
      ['openid', 'profile'],
      ctxWith({ profileUpdatedAt: null }),
    );
    expect(claims).not.toHaveProperty('updated_at');
  });
});

describe('[OIDC-CORE-5.1.1-01] address mapper', () => {
  it('emits address as one JSON object, per section 5.1.1', async () => {
    const claims = await standardClaimMappers().assemble(
      ['openid', 'address'],
      ctxWith({ addressLocality: 'London', addressCountry: 'GB' }),
    );
    expect(claims.address).toEqual({ locality: 'London', country: 'GB' });
  });

  it('omits address entirely when no component is stored', async () => {
    const claims = await standardClaimMappers().assemble(['openid', 'address'], ctxWith({}));
    expect(claims).not.toHaveProperty('address');
  });

  it('returns formatted and individual fields together when both are stored', async () => {
    const claims = await standardClaimMappers().assemble(
      ['openid', 'address'],
      ctxWith({ addressFormatted: '221B Baker Street, London', addressLocality: 'London' }),
    );
    expect(claims.address).toEqual({
      formatted: '221B Baker Street, London',
      locality: 'London',
    });
  });
});

describe('[OIDC-CORE-5.4-02] phone mapper', () => {
  it('emits phone_number and phone_number_verified together', async () => {
    const claims = await standardClaimMappers().assemble(
      ['openid', 'phone'],
      ctxWith({ phoneNumber: '+1-201-555-0123', phoneNumberVerified: true }),
    );
    expect(claims).toMatchObject({
      phone_number: '+1-201-555-0123',
      phone_number_verified: true,
    });
  });

  it('omits both phone claims together when no number is stored', async () => {
    const claims = await standardClaimMappers().assemble(
      ['openid', 'phone'],
      ctxWith({ phoneNumber: null }),
    );
    expect(claims).not.toHaveProperty('phone_number');
    expect(claims).not.toHaveProperty('phone_number_verified');
  });
});

describe('roles claim', () => {
  it('emits tenant roles bare and client roles qualified', async () => {
    const claims = await standardClaimMappers().assemble(['openid', 'roles'], roleGroupCtx);
    expect(claims.roles).toEqual(['admin', 'reports-api:reader']);
  });

  it('sorts and de-duplicates, so a token is reproducible', async () => {
    const claims = await standardClaimMappers().assemble(['openid', 'roles'], roleGroupCtx);
    expect(claims.roles).toEqual([...new Set(claims.roles as string[])].sort());
  });

  it('emits nothing when the roles scope was not granted', async () => {
    const claims = await standardClaimMappers().assemble(['openid'], roleGroupCtx);
    expect(claims).not.toHaveProperty('roles');
  });

  it('omits the claim entirely rather than emitting an empty array', async () => {
    const claims = await standardClaimMappers().assemble(['openid', 'roles'], {
      ...roleGroupCtx,
      roles: [],
    });
    expect(claims).not.toHaveProperty('roles');
  });

  it('never emits entitlements', async () => {
    const claims = await standardClaimMappers().assemble(
      ['openid', 'roles', 'groups'],
      roleGroupCtx,
    );
    expect(claims).not.toHaveProperty('entitlements');
  });
});

describe('groups claim', () => {
  it('emits sorted paths as an array of strings', async () => {
    const claims = await standardClaimMappers().assemble(['openid', 'groups'], roleGroupCtx);
    expect(claims.groups).toEqual(['/engineering', '/engineering/platform']);
  });
});
