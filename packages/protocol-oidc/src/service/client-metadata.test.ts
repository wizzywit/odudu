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
// non-http branch's "carries a scheme-specific part" check unmodified. The
// reverse-DNS closure itself is Odudu's own decision, not a MUST the RFC
// states in these words — see ADR 0032 — hence the `ODUDU-` id rather than
// one this file's `pnpm trace` would try to resolve against an RFC 7591
// clause table this repository does not carry.
describe('[ODUDU-CLIENT-META-REDIRECT-SCHEME-01] a non-HTTP redirect_uri scheme is application-specific', () => {
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

// frontchannel_logout_uri is rendered into an iframe (P3b) — the sink
// isValidLogoutUri exists to keep a javascript: or bare-http value out of,
// the same policy the back-channel twin already has above. Ids trace
// against docs/protocols/oidc-frontchannel.md.
describe('[OIDC-FRONTCHANNEL-2-SCHEME-01] the front-channel logout URI scheme policy', () => {
  it('refuses a front-channel logout URI that is not https', () => {
    const outcome = parseClientMetadata(ok({ frontchannel_logout_uri: 'http://rp.example/fc' }));
    expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_client_metadata' });
  });

  it('refuses a javascript: front-channel logout URI', () => {
    const outcome = parseClientMetadata(ok({ frontchannel_logout_uri: 'javascript:alert(1)' }));
    expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_client_metadata' });
  });
});

describe('[OIDC-FRONTCHANNEL-2-ABSOLUTE-01] the front-channel logout URI is absolute', () => {
  it('refuses a relative front-channel logout URI', () => {
    const outcome = parseClientMetadata(ok({ frontchannel_logout_uri: '/fc' }));
    expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_client_metadata' });
  });
});

describe('[OIDC-FRONTCHANNEL-2-FRAGMENT-01] the front-channel logout URI carries no fragment', () => {
  it('refuses a front-channel logout URI with a fragment', () => {
    const outcome = parseClientMetadata(ok({ frontchannel_logout_uri: 'https://rp.example/fc#x' }));
    expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_client_metadata' });
  });
});

it('accepts a well-formed front-channel logout URI', () => {
  const outcome = parseClientMetadata(ok({ frontchannel_logout_uri: 'https://rp.example/fc' }));
  expect(outcome.kind).toBe('ok');
});

describe('[OIDC-FRONTCHANNEL-2-SESSION-REQUIRED-01] frontchannel_logout_session_required is registerable', () => {
  it('accepts frontchannel_logout_session_required and defaults it to false', () => {
    const outcome = parseClientMetadata(ok({ frontchannel_logout_session_required: true }));
    expect(outcome.kind).toBe('ok');
    if (outcome.kind === 'ok') {
      expect(outcome.metadata.frontchannelLogoutSessionRequired).toBe(true);
    }

    const omitted = parseClientMetadata(ok());
    expect(omitted.kind).toBe('ok');
    if (omitted.kind === 'ok') {
      expect(omitted.metadata.frontchannelLogoutSessionRequired).toBe(false);
    }
  });

  it('refuses a non-boolean frontchannel_logout_session_required', () => {
    const outcome = parseClientMetadata(ok({ frontchannel_logout_session_required: 'yes' }));
    expect(outcome.kind).toBe('invalid');
  });
});

// Front-Channel Logout 1.0 §2: the domain, port and scheme of the
// front-channel logout URI must match a registered redirect URI's — a
// second, unauthenticated inbound surface is only as trustworthy as the
// origin the client already proved it controls at registration.
describe('[OIDC-FRONTCHANNEL-2-ORIGIN-01] the front-channel logout URI origin matches a registered redirect URI', () => {
  it('refuses a front-channel logout URI whose host does not match any redirect_uri', () => {
    const outcome = parseClientMetadata(
      ok({
        redirect_uris: ['https://rp.example/cb'],
        frontchannel_logout_uri: 'https://evil.example/fc',
      }),
    );
    expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_client_metadata' });
  });

  it('refuses a front-channel logout URI on a different port than every redirect_uri', () => {
    const outcome = parseClientMetadata(
      ok({
        redirect_uris: ['https://rp.example:8443/cb'],
        frontchannel_logout_uri: 'https://rp.example/fc',
      }),
    );
    expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_client_metadata' });
  });

  it('accepts a front-channel logout URI matching the default https port explicitly', () => {
    const outcome = parseClientMetadata(
      ok({
        redirect_uris: ['https://rp.example/cb'],
        frontchannel_logout_uri: 'https://rp.example:443/fc',
      }),
    );
    expect(outcome.kind).toBe('ok');
  });

  it('accepts a front-channel logout URI matching one of several redirect_uris', () => {
    const outcome = parseClientMetadata(
      ok({
        redirect_uris: ['https://other.example/cb', 'https://rp.example/cb'],
        frontchannel_logout_uri: 'https://rp.example/fc',
      }),
    );
    expect(outcome.kind).toBe('ok');
  });
});

// client_oidc_config_tls_client_auth_needs_subject_dn (migration
// 0055_client_tls_client_auth_subject_dn.sql): nothing downstream can
// compare a proxy-supplied certificate subject against a client that
// registered tls_client_auth without one.
describe('[RFC8705-2.1.2-01] a tls_client_auth registration requires its subject DN', () => {
  it('refuses tls_client_auth with no tls_client_auth_subject_dn', () => {
    const outcome = parseClientMetadata(
      ok({ grant_types: ['client_credentials'], token_endpoint_auth_method: 'tls_client_auth' }),
    );
    expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_client_metadata' });
  });

  it('refuses tls_client_auth with a blank tls_client_auth_subject_dn', () => {
    const outcome = parseClientMetadata(
      ok({
        grant_types: ['client_credentials'],
        token_endpoint_auth_method: 'tls_client_auth',
        tls_client_auth_subject_dn: '   ',
      }),
    );
    expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_client_metadata' });
  });

  it('accepts tls_client_auth with a subject DN and stores it trimmed', () => {
    const outcome = parseClientMetadata(
      ok({
        grant_types: ['client_credentials'],
        token_endpoint_auth_method: 'tls_client_auth',
        tls_client_auth_subject_dn: '  CN=client-a,O=Example  ',
      }),
    );
    expect(outcome.kind).toBe('ok');
    if (outcome.kind === 'ok') {
      expect(outcome.metadata.tlsClientAuthSubjectDn).toBe('CN=client-a,O=Example');
    }
  });

  it('leaves tlsClientAuthSubjectDn null for every other method', () => {
    const outcome = parseClientMetadata(ok());
    expect(outcome.kind).toBe('ok');
    if (outcome.kind === 'ok') {
      expect(outcome.metadata.tlsClientAuthSubjectDn).toBeNull();
    }
  });
});
