import { describe, expect, it } from 'vitest';
import { acceptTokenSet, tokenSetFrom } from '#/service/token-set';
import { jwtOf } from '#/testing/jwt';

const ISSUER = 'https://id.example.com/tenants/acme';
const NOW = new Date('2026-11-06T10:00:00Z');
const ADMIN = 'urn:odudu:params:admin-api';

function response(token: string, extra: Record<string, unknown> = {}) {
  return {
    access_token: token,
    token_type: 'Bearer',
    expires_in: 300,
    scope: 'mcp:read',
    ...extra,
  };
}

describe('a token endpoint answer, read', () => {
  it('becomes a token set with an expiry instant, scopes and an optional refresh token', () => {
    const set = tokenSetFrom(response('t', { refresh_token: 'r' }), NOW);
    expect(set).toEqual({
      accessToken: 't',
      expiresAt: new Date('2026-11-06T10:05:00Z'),
      refreshToken: 'r',
      scope: ['mcp:read'],
    });
  });

  it('expires with the token itself when its exp is sooner than expires_in says', () => {
    const early = jwtOf({
      iss: ISSUER,
      aud: [ADMIN],
      scope: 'mcp:read',
      exp: NOW.getTime() / 1000 + 60,
    });
    expect(tokenSetFrom(response(early), NOW).expiresAt).toEqual(new Date('2026-11-06T10:01:00Z'));
    const late = jwtOf({
      iss: ISSUER,
      aud: [ADMIN],
      scope: 'mcp:read',
      exp: NOW.getTime() / 1000 + 9999,
    });
    expect(tokenSetFrom(response(late), NOW).expiresAt).toEqual(new Date('2026-11-06T10:05:00Z'));
  });

  it('never trusts an expires_in beyond an hour', () => {
    expect(tokenSetFrom(response('t', { expires_in: 86_400 }), NOW).expiresAt).toEqual(
      new Date('2026-11-06T11:00:00Z'),
    );
  });

  it('takes a bearer token type in any case and refuses another', () => {
    expect(tokenSetFrom(response('t', { token_type: 'bearer' }), NOW).accessToken).toBe('t');
    expect(() => tokenSetFrom(response('t', { token_type: 'DPoP' }), NOW)).toThrow(/bearer/iu);
  });

  it.each([null, 'x', [], {}, { access_token: '' }, { access_token: 't', token_type: 'Bearer' }])(
    'refuses %j',
    (body) => {
      expect(() => tokenSetFrom(body, NOW)).toThrow();
    },
  );

  it('refuses an expires_in that is not a positive number', () => {
    expect(() => tokenSetFrom(response('t', { expires_in: 0 }), NOW)).toThrow();
    expect(() => tokenSetFrom(response('t', { expires_in: '300' }), NOW)).toThrow();
  });
});

describe('whether a token may be used against this tenant', () => {
  const ok = jwtOf({ iss: ISSUER, aud: [ADMIN, ISSUER], scope: 'mcp:read' });

  it('accepts a token of the tenant issuer, for the admin API, with the scope asked for', () => {
    const set = tokenSetFrom(response(ok), NOW);
    expect(() => {
      acceptTokenSet(set, { issuer: ISSUER, audience: ADMIN, scope: 'mcp:read' });
    }).not.toThrow();
  });

  it('refuses a token of another issuer', () => {
    const set = tokenSetFrom(
      response(jwtOf({ iss: 'https://evil.example/tenants/acme', aud: [ADMIN] })),
      NOW,
    );
    expect(() => {
      acceptTokenSet(set, { issuer: ISSUER, audience: ADMIN, scope: 'mcp:read' });
    }).toThrow(/issuer/u);
  });

  it('refuses a token for another audience, or one that is not a JWT', () => {
    const wrong = tokenSetFrom(response(jwtOf({ iss: ISSUER, aud: ['urn:other'] })), NOW);
    expect(() => {
      acceptTokenSet(wrong, { issuer: ISSUER, audience: ADMIN, scope: 'mcp:read' });
    }).toThrow(/audience/u);
    expect(() => {
      acceptTokenSet(tokenSetFrom(response('opaque'), NOW), {
        issuer: ISSUER,
        audience: ADMIN,
        scope: 'mcp:read',
      });
    }).toThrow(/issuer/u);
  });

  it('refuses a token without the scope asked for, and a read-only one that carries mcp:write', () => {
    const none = tokenSetFrom(
      response(jwtOf({ iss: ISSUER, aud: [ADMIN], scope: 'openid' }), { scope: 'openid' }),
      NOW,
    );
    expect(() => {
      acceptTokenSet(none, { issuer: ISSUER, audience: ADMIN, scope: 'mcp:read' });
    }).toThrow(/scope/u);
    const wider = tokenSetFrom(
      response(jwtOf({ iss: ISSUER, aud: [ADMIN], scope: 'mcp:read mcp:write' })),
      NOW,
    );
    expect(() => {
      acceptTokenSet(wider, { issuer: ISSUER, audience: ADMIN, scope: 'mcp:read' });
    }).toThrow(/mcp:write/u);
  });

  it('refuses a token whose own scope claim lacks the scope, whatever the endpoint said it granted', () => {
    const set = tokenSetFrom(
      response(jwtOf({ iss: ISSUER, aud: [ADMIN], scope: 'openid' }), { scope: 'mcp:read' }),
      NOW,
    );
    expect(() => {
      acceptTokenSet(set, { issuer: ISSUER, audience: ADMIN, scope: 'mcp:read' });
    }).toThrow(/scope mcp:read/u);
    const write = tokenSetFrom(
      response(jwtOf({ iss: ISSUER, aud: [ADMIN], scope: 'mcp:read' }), {
        scope: 'mcp:read mcp:write',
      }),
      NOW,
    );
    expect(() => {
      acceptTokenSet(write, { issuer: ISSUER, audience: ADMIN, scope: 'mcp:write' });
    }).toThrow(/scope mcp:write/u);
  });

  it('does not put the token in a message', () => {
    const set = tokenSetFrom(response('opaque-SECRET'), NOW);
    expect(() => {
      acceptTokenSet(set, { issuer: ISSUER, audience: ADMIN, scope: 'mcp:read' });
    }).not.toThrow(/SECRET/u);
  });
});
