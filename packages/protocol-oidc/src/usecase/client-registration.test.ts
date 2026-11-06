import { describe, expect, it } from 'vitest';
import {
  registerClient as register,
  type ClientRegistrationDeps,
  type RegistrationContext,
} from '#/usecase/client-registration';
import { pathAddress } from '@odudu/kernel';
import { type TenantLookup } from '#/repository/tenant-lookup';

const PASSWORD_RULES = {
  minLength: 15,
  requireDigit: false,
  requireUppercase: false,
  requireLowercase: false,
  requireSpecial: false,
};

const TENANT: TenantLookup = {
  id: 'r1',
  enabled: true,
  verifyEmail: false,
  ssoSessionMaxSeconds: 36_000,
  ssoSessionIdleSeconds: 1_800,
  rememberMeIdleSeconds: 604_800,
  rememberMeMaxSeconds: 2_592_000,
  rememberMeAllowed: false,
  loginWithEmail: false,
  registrationAllowed: false,
  resetPasswordAllowed: false,
  maxSessionsPerBrowser: 25,
  clientRegistrationPolicy: 'open',
  cimdEnabled: false,
  supportedLocales: ['en'],
  defaultLocale: null,
  passwordRules: PASSWORD_RULES,
};

const MCP_URL = 'https://idp.example/tenants/acme/mcp';
const CONTEXT: RegistrationContext = {
  origin: '203.0.113.9',
  address: pathAddress('https://idp.example', 'acme'),
};

// Every call below registers on this tenant's own address; only the
// `mcp` cases look at the context.
function registerClient(
  d: ClientRegistrationDeps,
  tenant: string,
  header: string | undefined,
  body: unknown,
) {
  return register(d, tenant, header, body, CONTEXT);
}

const MINIMAL_METADATA = { redirect_uris: ['https://rp.example/cb'] };

// A `withinTenant` that fails the test if it is ever called — used to prove
// an early refusal (404, 401) never opens a transaction, which is what
// tells `not_found` and `unauthorized` apart from a version that always
// opens one and only decides inside it. A version of `registerClient` that
// opened the transaction regardless and decided the outcome inside it
// would still return the right `kind`, but would fail every test below
// that uses this fake.
const explodingWithinTenant: ClientRegistrationDeps['withinTenant'] = () => {
  throw new Error('withinTenant must not be called for this outcome');
};

function deps(overrides: Partial<ClientRegistrationDeps> = {}): ClientRegistrationDeps {
  return {
    findTenant: () => Promise.resolve(TENANT),
    withinTenant: explodingWithinTenant,
    hashClientSecret: (secret) => Promise.resolve(`hashed:${secret}`),
    now: () => new Date('2026-09-18T00:00:00Z'),
    tlsClientAuthEnabled: false,
    mcpRegistrationLimiter: { check: () => ({ allowed: true, retryAfterSeconds: 0 }) },
    ...overrides,
  };
}

describe('registerClient — tenant resolution', () => {
  it('answers not_found for an unknown tenant without opening a transaction', async () => {
    const outcome = await registerClient(
      deps({ findTenant: () => Promise.resolve(null) }),
      'no-such-tenant',
      undefined,
      MINIMAL_METADATA,
    );
    expect(outcome).toEqual({ kind: 'not_found' });
  });

  it('answers not_found for a disabled tenant without opening a transaction', async () => {
    const outcome = await registerClient(
      deps({ findTenant: () => Promise.resolve({ ...TENANT, enabled: false }) }),
      'acme',
      undefined,
      MINIMAL_METADATA,
    );
    expect(outcome).toEqual({ kind: 'not_found' });
  });

  // Discriminates from a version that reads the policy only for discovery
  // and lets every tenant register: the fixture's tenant is enabled, and the
  // only thing that says "closed" is the policy column.
  it('answers not_found when the policy is disabled, even for an enabled tenant', async () => {
    const outcome = await registerClient(
      deps({
        findTenant: () => Promise.resolve({ ...TENANT, clientRegistrationPolicy: 'disabled' }),
      }),
      'acme',
      undefined,
      MINIMAL_METADATA,
    );
    expect(outcome).toEqual({ kind: 'not_found' });
  });
});

describe('registerClient — the token policy', () => {
  it('answers unauthorized with no Authorization header, before touching the database', async () => {
    const outcome = await registerClient(
      deps({ findTenant: () => Promise.resolve({ ...TENANT, clientRegistrationPolicy: 'token' }) }),
      'acme',
      undefined,
      MINIMAL_METADATA,
    );
    expect(outcome).toEqual({ kind: 'unauthorized' });
  });

  // Discriminates from a check that only looks at whether the header key is
  // present: a header carrying a different scheme is not a bearer token
  // either, and must be refused the same way as no header at all.
  it('answers unauthorized for a non-Bearer Authorization header', async () => {
    const outcome = await registerClient(
      deps({ findTenant: () => Promise.resolve({ ...TENANT, clientRegistrationPolicy: 'token' }) }),
      'acme',
      'Basic dXNlcjpwYXNz',
      MINIMAL_METADATA,
    );
    expect(outcome).toEqual({ kind: 'unauthorized' });
  });

  it('opens a transaction once a bearer token is presented', async () => {
    let tenantIdSeen: string | undefined;
    const outcome = await registerClient(
      deps({
        findTenant: () => Promise.resolve({ ...TENANT, clientRegistrationPolicy: 'token' }),
        withinTenant: <T>(tenantId: string) => {
          tenantIdSeen = tenantId;
          return Promise.resolve({ kind: 'invalid_token' }) as unknown as Promise<T>;
        },
      }),
      'acme',
      'Bearer some-token',
      MINIMAL_METADATA,
    );
    expect(tenantIdSeen).toBe('r1');
    expect(outcome).toEqual({ kind: 'invalid_token' });
  });
});

describe('registerClient — metadata validation', () => {
  // Discriminates from a version that validates metadata inside the
  // transaction: an invalid body must never reach withinTenant, the same
  // property the tenant-resolution tests establish for 404 and 401.
  it('answers invalid_metadata before opening a transaction', async () => {
    const outcome = await registerClient(deps(), 'acme', undefined, {
      redirect_uris: ['not a url'],
    });
    expect(outcome.kind).toBe('invalid_metadata');
    if (outcome.kind === 'invalid_metadata') {
      expect(outcome.error).toBe('invalid_redirect_uri');
      expect(outcome.description).toContain('not a url');
    }
  });

  // The one field parseClientMetadata always refuses regardless of tenant
  // policy: proves this usecase does not re-open the door client-metadata.ts
  // already closed.
  it('refuses a client-proposed client_id', async () => {
    const outcome = await registerClient(deps(), 'acme', undefined, {
      ...MINIMAL_METADATA,
      client_id: 'i-picked-this',
    });
    expect(outcome.kind).toBe('invalid_metadata');
    if (outcome.kind === 'invalid_metadata') {
      expect(outcome.error).toBe('invalid_client_metadata');
      expect(outcome.description).toContain('client_id');
    }
  });

  // docs/archive/specs/2026-09-18-p3a-clients-registration-consent-design.md:596-598:
  // a deployment with ODUDU_TRUST_PROXY off must refuse a tls_client_auth
  // registration outright, the registration half of the same decision
  // /token's own trustProxy gate is the authentication half of.
  it('refuses tls_client_auth registration when this deployment cannot honour it', async () => {
    const outcome = await registerClient(deps({ tlsClientAuthEnabled: false }), 'acme', undefined, {
      grant_types: ['client_credentials'],
      token_endpoint_auth_method: 'tls_client_auth',
      tls_client_auth_subject_dn: 'CN=client-a,O=Example',
    });
    expect(outcome.kind).toBe('invalid_metadata');
    if (outcome.kind === 'invalid_metadata') {
      expect(outcome.error).toBe('invalid_client_metadata');
      expect(outcome.description).toContain('tls_client_auth');
    }
  });
});

describe('registerClient — a presented token in the open policy', () => {
  // Proves the open policy still opens a transaction and hands the tenant
  // id through when a token is presented — the actual spend/anonymous
  // decision runs inside that transaction against the real repository, and
  // is covered by the integration suite, which is the only place a
  // realistic `tx` exists to exercise it against.
  it('opens a transaction for the presented token rather than registering anonymously inline', async () => {
    let called = false;
    const outcome = await registerClient(
      deps({
        withinTenant: <T>(tenantId: string) => {
          called = true;
          expect(tenantId).toBe('r1');
          return Promise.resolve({ kind: 'invalid_token' }) as unknown as Promise<T>;
        },
      }),
      'acme',
      'Bearer some-token',
      MINIMAL_METADATA,
    );
    expect(called).toBe(true);
    expect(outcome).toEqual({ kind: 'invalid_token' });
  });
});

describe('registerClient — the mcp policy', () => {
  const mcpTenant = () => Promise.resolve({ ...TENANT, clientRegistrationPolicy: 'mcp' as const });
  const PUBLIC = { redirect_uris: ['https://rp.example/cb'], token_endpoint_auth_method: 'none' };

  async function refused(body: Record<string, unknown>) {
    const outcome = await registerClient(deps({ findTenant: mcpTenant }), 'acme', undefined, {
      ...PUBLIC,
      ...body,
    });
    if (outcome.kind !== 'invalid_metadata') throw new Error(`expected a refusal: ${outcome.kind}`);
    return outcome;
  }

  it('refuses a client that would hold a secret, before a transaction opens', async () => {
    const outcome = await refused({ token_endpoint_auth_method: 'client_secret_basic' });
    expect(outcome.description).toContain('token_endpoint_auth_method');
  });

  it('refuses a plain-http redirect to a host that is not loopback', async () => {
    const outcome = await refused({ redirect_uris: ['http://rp.example/cb'] });
    expect(outcome.error).toBe('invalid_redirect_uri');
  });

  it('refuses a scope of which nothing may be held', async () => {
    expect((await refused({ scope: 'mcp:write' })).description).toContain('mcp:write');
  });

  it('refuses an audience other than the tenant MCP URL', async () => {
    const outcome = await refused({ audience: ['https://api.example'] });
    expect(outcome.description).toContain(MCP_URL);
  });

  it('refuses once the origin has spent its budget, and says when to retry', async () => {
    const seen: string[] = [];
    const outcome = await registerClient(
      deps({
        findTenant: mcpTenant,
        mcpRegistrationLimiter: {
          check: (tenantId, origin) => {
            seen.push(`${tenantId}:${origin}`);
            return { allowed: false, retryAfterSeconds: 17, scope: 'tenant' as const };
          },
        },
      }),
      'acme',
      undefined,
      PUBLIC,
    );
    expect(outcome).toEqual({ kind: 'rate_limited', retryAfterSeconds: 17, scope: 'tenant' });
    expect(seen).toEqual(['r1:203.0.113.9']);
  });

  it('stays closed where no limiter is wired', async () => {
    const outcome = await registerClient(
      deps({ findTenant: mcpTenant, mcpRegistrationLimiter: undefined }),
      'acme',
      undefined,
      PUBLIC,
    );
    expect(outcome).toEqual({ kind: 'not_found' });
  });

  it('spends no budget on a tenant whose policy is not mcp', async () => {
    let asked = false;
    await registerClient(
      deps({
        mcpRegistrationLimiter: {
          check: () => {
            asked = true;
            return { allowed: true, retryAfterSeconds: 0 };
          },
        },
      }),
      'acme',
      undefined,
      { redirect_uris: ['com.example.app:/cb'], grant_types: ['bogus'] },
    );
    expect(asked).toBe(false);
  });
});
