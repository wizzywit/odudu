import { addressIssuer, meAudienceOfIssuer, pathAddress } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { admitMeRead, admitMeWrite, type AdmitMeDeps } from '#/usecase/admit-me';

const ADDRESS = pathAddress('https://idp.example', 'acme');
const ISSUER = addressIssuer(ADDRESS);
const NOW = new Date('2026-11-11T10:00:00Z');
const LIFESPANS = {
  ssoSessionIdleSeconds: 1800,
  ssoSessionMaxSeconds: 36_000,
  rememberMeIdleSeconds: 604_800,
  rememberMeMaxSeconds: 2_592_000,
};

function jwtWith(iss: string): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'ES256' })}.${part({ iss })}.sig`;
}

function claims(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: ISSUER,
    aud: [meAudienceOfIssuer(ISSUER)],
    sub: 'subject-1',
    client_id: 'app',
    sid: 'session-1',
    scope: 'openid me:read',
    ...over,
  };
}

function deps(
  payload: Record<string, unknown> | null,
  tenant: { enabled: boolean } | null = { enabled: true },
): AdmitMeDeps {
  return {
    acceptedIssuers: () => Promise.resolve([ISSUER]),
    verifyAccessToken: () => Promise.resolve(payload),
    findTenant: () =>
      Promise.resolve(
        tenant === null
          ? null
          : {
              id: 'tenant-1',
              ...tenant,
              lifespans: LIFESPANS,
              freshnessSeconds: 300,
              usernameEditable: false,
            },
      ),
    logger: { warn: () => undefined },
  };
}

const input = (authorization: string | undefined = `Bearer ${jwtWith(ISSUER)}`) => ({
  authorizationHeader: authorization,
  tenantName: 'acme',
  address: ADDRESS,
  now: NOW,
});

describe('admitMeRead', () => {
  it('admits a token holding me:read as its own subject', async () => {
    const outcome = await admitMeRead(deps(claims()), input());
    expect(outcome).toEqual({
      kind: 'admitted',
      caller: {
        tenantId: 'tenant-1',
        subjectId: 'subject-1',
        sessionId: 'session-1',
        lifespans: LIFESPANS,
        clientId: 'app',
        issuer: ISSUER,
        freshnessSeconds: 300,
        usernameEditable: false,
      },
    });
  });

  it('admits a token marked for an agent: reads are open to one', async () => {
    const outcome = await admitMeRead(
      deps(claims({ act: { sub: 'agent-1', client_id: 'agent' } })),
      input(),
    );
    expect(outcome.kind).toBe('admitted');
  });

  it('answers an unknown tenant and a disabled one alike', async () => {
    expect(await admitMeRead(deps(claims(), null), input())).toEqual({ kind: 'not_found' });
    expect(await admitMeRead(deps(claims(), { enabled: false }), input())).toEqual({
      kind: 'not_found',
    });
  });

  it('challenges a request with no credentials without naming an error', async () => {
    expect(
      await admitMeRead(deps(claims()), { ...input(), authorizationHeader: undefined }),
    ).toEqual({
      kind: 'unauthenticated',
      challenge: 'Bearer',
    });
  });

  it('refuses a token that does not verify as invalid_token', async () => {
    expect(await admitMeRead(deps(null), input())).toEqual({
      kind: 'unauthenticated',
      challenge: 'Bearer error="invalid_token"',
    });
  });

  it('refuses a token without me:read and names the scope it needs', async () => {
    expect(await admitMeRead(deps(claims({ scope: 'openid me:write' })), input())).toEqual({
      kind: 'insufficient_scope',
      challenge: 'Bearer error="insufficient_scope", scope="me:read"',
    });
  });
});

describe('admitMeWrite', () => {
  const writer = (over: Record<string, unknown> = {}) =>
    claims({ scope: 'openid me:read me:write', ...over });

  it('admits a token holding me:write as its own subject, naming the client and issuer', async () => {
    expect(await admitMeWrite(deps(writer()), input())).toEqual({
      kind: 'admitted',
      caller: {
        tenantId: 'tenant-1',
        subjectId: 'subject-1',
        sessionId: 'session-1',
        lifespans: LIFESPANS,
        clientId: 'app',
        issuer: ISSUER,
        freshnessSeconds: 300,
        usernameEditable: false,
      },
    });
  });

  it('refuses a token with me:read alone and names me:write', async () => {
    expect(await admitMeWrite(deps(claims()), input())).toEqual({
      kind: 'insufficient_scope',
      challenge: 'Bearer error="insufficient_scope", scope="me:write"',
    });
  });

  it('refuses a token marked for an agent, however it is scoped', async () => {
    const agent = writer({ act: { sub: 'agent-1', client_id: 'agent' } });
    expect(await admitMeWrite(deps(agent), input())).toEqual({ kind: 'agent_not_permitted' });
  });

  it('answers an unknown tenant, a missing token and a bad one as a read does', async () => {
    expect(await admitMeWrite(deps(writer(), null), input())).toEqual({ kind: 'not_found' });
    expect(
      await admitMeWrite(deps(writer()), { ...input(), authorizationHeader: undefined }),
    ).toEqual({ kind: 'unauthenticated', challenge: 'Bearer' });
    expect(await admitMeWrite(deps(null), input())).toEqual({
      kind: 'unauthenticated',
      challenge: 'Bearer error="invalid_token"',
    });
  });
});
