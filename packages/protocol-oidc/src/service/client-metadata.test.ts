import { describe, expect, it } from 'vitest';
import { parseClientMetadata } from '#/service/client-metadata';

const ok = (over: Record<string, unknown> = {}): unknown => ({
  redirect_uris: ['https://rp.example/cb'],
  grant_types: ['authorization_code'],
  token_endpoint_auth_method: 'client_secret_basic',
  client_name: 'Example RP',
  ...over,
});

it('accepts a minimal registration', () => {
  const outcome = parseClientMetadata(ok());
  expect(outcome.kind).toBe('ok');
});

it.each([
  ['http to a public host', 'http://rp.example/cb'],
  ['a fragment', 'https://rp.example/cb#x'],
  ['a relative URI', '/cb'],
])('refuses a redirect_uri with %s', (_name, uri) => {
  const outcome = parseClientMetadata(ok({ redirect_uris: [uri] }));
  expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_redirect_uri' });
});

it.each(['http://127.0.0.1:8080/cb', 'http://[::1]:8080/cb', 'com.example.app:/cb'])(
  'accepts %s',
  (uri) => {
    expect(parseClientMetadata(ok({ redirect_uris: [uri] })).kind).toBe('ok');
  },
);

// RFC 7591 §5's third bullet is "a non-HTTP application-specific URL", not
// any scheme a client can name — these three would previously pass the
// non-http branch's "carries a scheme-specific part" check unmodified.
describe('[RFC7591-5-01] a non-HTTP redirect_uri scheme is application-specific', () => {
  it.each(['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd'])(
    'refuses the dangerous scheme %s',
    (uri) => {
      const outcome = parseClientMetadata(ok({ redirect_uris: [uri] }));
      expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_redirect_uri' });
    },
  );

  it('accepts a reverse-DNS custom scheme', () => {
    expect(parseClientMetadata(ok({ redirect_uris: ['com.example.app:/cb'] })).kind).toBe('ok');
  });
});

it.each(['http://rp.example/jwks.json', 'https://user:pw@rp.example/j'])(
  'refuses the jwks_uri %s',
  (uri) => {
    const outcome = parseClientMetadata(ok({ jwks_uri: uri }));
    expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_client_metadata' });
  },
);

it('accepts a well-formed jwks_uri without dereferencing it', () => {
  // No lookup, no socket: parseClientMetadata checks shape alone
  // (assertFetchableUrl), so a host that cannot resolve still parses ok.
  // The registration endpoint built on top of this never dereferences
  // jwks_uri either — see docs/NEXT.md and
  // packages/protocol-oidc/tests/client-registration.int.test.ts's own
  // proof of that at the endpoint level.
  expect(parseClientMetadata(ok({ jwks_uri: 'https://nonexistent.invalid/jwks.json' })).kind).toBe(
    'ok',
  );
});

it('refuses a client that states its keys twice', () => {
  const outcome = parseClientMetadata(ok({ jwks: { keys: [] }, jwks_uri: 'https://rp.example/j' }));
  expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_client_metadata' });
});

it('refuses a client_id the client proposed for itself', () => {
  const outcome = parseClientMetadata(ok({ client_id: 'i-picked-this' }));
  expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_client_metadata' });
});

it('refuses a grant type this server does not implement', () => {
  const outcome = parseClientMetadata(ok({ grant_types: ['implicit'] }));
  expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_client_metadata' });
});

// `client_credentials` alone has no interactive flow, which is the one case
// the existing CHECK on client_oidc_config permits with no redirect_uri.
it('accepts client_credentials alone with no redirect_uris', () => {
  expect(
    parseClientMetadata({
      grant_types: ['client_credentials'],
      token_endpoint_auth_method: 'client_secret_basic',
    }).kind,
  ).toBe('ok');
});

describe('[RFC6749-3.1.2-01] the redirection endpoint URI is an absolute URI', () => {
  it('refuses a relative redirect_uri', () => {
    const outcome = parseClientMetadata(ok({ redirect_uris: ['/cb'] }));
    expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_redirect_uri' });
  });
});

describe('[RFC6749-3.1.2-02] the redirection endpoint URI does not include a fragment component', () => {
  it('refuses a redirect_uri carrying a fragment', () => {
    const outcome = parseClientMetadata(ok({ redirect_uris: ['https://rp.example/cb#x'] }));
    expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_redirect_uri' });
  });
});

// The same code path (client_oidc_config_redirect_uris_present's exact-array
// check in parseClientMetadata) discharges three MUST rows the spec states
// from three different angles — a public client's own obligation (§3.1.2.2),
// the server's obligation once a client cannot be authenticated (§10.2), and
// public clients again (§10.6) — so all three tests below assert the same
// refusal.
describe('[RFC6749-3.1.2.2-01] the authorization server requires public clients to register their redirection endpoint', () => {
  it('refuses a public client with no redirect_uris', () => {
    const outcome = parseClientMetadata(
      ok({ token_endpoint_auth_method: 'none', redirect_uris: [] }),
    );
    expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_redirect_uri' });
  });
});

describe('[RFC6749-10.2-01] when the client cannot be authenticated, the authorization server requires registration of its redirection URI', () => {
  it('refuses a client registering as token_endpoint_auth_method none with no redirect_uris', () => {
    const outcome = parseClientMetadata(
      ok({ token_endpoint_auth_method: 'none', redirect_uris: [] }),
    );
    expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_redirect_uri' });
  });
});

describe('[RFC6749-10.6-01] the authorization server requires public clients to register their redirection URIs', () => {
  it('refuses a public client with no redirect_uris', () => {
    const outcome = parseClientMetadata(
      ok({ token_endpoint_auth_method: 'none', redirect_uris: [] }),
    );
    expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_redirect_uri' });
  });
});

describe('[RFC6749-10.1-01] the authorization server does not issue client passwords or credentials to native or user-agent-based clients for authentication', () => {
  // "Native or user-agent-based" is not a fact the server can observe —
  // RFC 6749 §2.1 leaves client type to be declared at registration, which
  // is exactly what token_endpoint_auth_method does here: a client that
  // declares itself unable to keep a secret (`none`) is never handed one,
  // regardless of what it is asking to register for.
  it('issues no secretHash-bearing client for token_endpoint_auth_method none', () => {
    const outcome = parseClientMetadata(ok({ token_endpoint_auth_method: 'none' }));
    expect(outcome.kind).toBe('ok');
    // parseClientMetadata itself never generates a secret — this asserts
    // the metadata this server treats as "a public client" is exactly the
    // 'none' method, which is what packages/protocol-oidc/src/usecase/
    // client-registration.ts's clientType() switches on to decide whether
    // to generate one at all.
    if (outcome.kind === 'ok') {
      expect(outcome.metadata.tokenEndpointAuthMethod).toBe('none');
    }
  });
});

describe('[OIDC-BACKCHANNEL-2.2-03] the back-channel logout URI scheme policy', () => {
  it('refuses a back-channel logout URI that is not https', () => {
    const outcome = parseClientMetadata(ok({ backchannel_logout_uri: 'http://rp.example/bc' }));
    expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_client_metadata' });
  });
});

describe('[OIDC-BACKCHANNEL-2.2-01] the back-channel logout URI is absolute', () => {
  it('refuses a relative back-channel logout URI', () => {
    const outcome = parseClientMetadata(ok({ backchannel_logout_uri: '/bc' }));
    expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_client_metadata' });
  });
});

describe('[OIDC-BACKCHANNEL-2.2-02] the back-channel logout URI carries no fragment', () => {
  it('refuses a back-channel logout URI with a fragment', () => {
    const outcome = parseClientMetadata(ok({ backchannel_logout_uri: 'https://rp.example/bc#x' }));
    expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_client_metadata' });
  });
});

it('accepts a well-formed back-channel logout URI', () => {
  const outcome = parseClientMetadata(ok({ backchannel_logout_uri: 'https://rp.example/bc' }));
  expect(outcome.kind).toBe('ok');
});

// frontchannel_logout_uri is rendered into an iframe (P3b), which is exactly
// the sink isValidLogoutUri exists to keep a javascript: or bare-http value
// out of — the same policy the back-channel twin already has above.
describe('[OIDC-FRONTCHANNEL-2-01] the front-channel logout URI scheme policy', () => {
  it('refuses a front-channel logout URI that is not https', () => {
    const outcome = parseClientMetadata(ok({ frontchannel_logout_uri: 'http://rp.example/fc' }));
    expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_client_metadata' });
  });

  it('refuses a javascript: front-channel logout URI', () => {
    const outcome = parseClientMetadata(ok({ frontchannel_logout_uri: 'javascript:alert(1)' }));
    expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_client_metadata' });
  });
});

describe('[OIDC-FRONTCHANNEL-2-02] the front-channel logout URI is absolute', () => {
  it('refuses a relative front-channel logout URI', () => {
    const outcome = parseClientMetadata(ok({ frontchannel_logout_uri: '/fc' }));
    expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_client_metadata' });
  });
});

describe('[OIDC-FRONTCHANNEL-2-03] the front-channel logout URI carries no fragment', () => {
  it('refuses a front-channel logout URI with a fragment', () => {
    const outcome = parseClientMetadata(ok({ frontchannel_logout_uri: 'https://rp.example/fc#x' }));
    expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_client_metadata' });
  });
});

it('accepts a well-formed front-channel logout URI', () => {
  const outcome = parseClientMetadata(ok({ frontchannel_logout_uri: 'https://rp.example/fc' }));
  expect(outcome.kind).toBe('ok');
});
