import { describe, expect, it } from 'vitest';
import { createOauthClient } from '#/adapter/oauth-client';
import { stdioTarget } from '#/service/stdio-target';
import { jwtOf } from '#/testing/jwt';

const target = stdioTarget('https://id.example.com', 'acme');
const ISSUER = target.issuer;
const NOW = new Date('2026-11-06T10:00:00Z');
const ADMIN = 'urn:odudu:params:admin-api';

const metadata = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`,
  token_endpoint: `${ISSUER}/protocol/openid-connect/token`,
  authorization_response_iss_parameter_supported: true,
  code_challenge_methods_supported: ['S256'],
};
const server = {
  issuer: ISSUER,
  authorizationEndpoint: metadata.authorization_endpoint,
  tokenEndpoint: metadata.token_endpoint,
  issuerAdvertised: true,
};
const tokenBody = (extra: Record<string, unknown> = {}) => ({
  access_token: jwtOf({ iss: ISSUER, aud: [ADMIN], scope: 'mcp:read' }),
  token_type: 'Bearer',
  expires_in: 300,
  ...extra,
});

const reply = (body: unknown, status = 200, type = 'application/json') =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': type },
  });

function client(answer: () => Response) {
  const sent: { url: string; init: RequestInit }[] = [];
  const stub: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    sent.push({ url, init: init ?? {} });
    return Promise.resolve(answer());
  };
  return {
    sent,
    oauth: createOauthClient(target, { fetch: stub, now: () => NOW, publicClientId: 'odudu-mcp' }),
  };
}

function form(init: RequestInit): Record<string, string> {
  if (typeof init.body !== 'string') throw new Error('the body is not a string');
  return Object.fromEntries(new URLSearchParams(init.body));
}

describe('discovery', () => {
  it('reads the RFC 8414 document of the tenant and checks its issuer', async () => {
    const { sent, oauth } = client(() => reply(metadata));
    expect(await oauth.discover()).toEqual(server);
    expect(sent[0]?.url).toBe(target.metadataUrl);
    expect(sent[0]?.init.redirect).toBe('manual');
  });

  it('refuses a document of another issuer, a redirect, an error status and a body that is not JSON', async () => {
    await expect(
      client(() =>
        reply({ ...metadata, issuer: 'https://evil.example/tenants/acme' }),
      ).oauth.discover(),
    ).rejects.toThrow(/issuer/u);
    await expect(
      client(
        () => new Response(null, { status: 302, headers: { location: 'https://evil.example' } }),
      ).oauth.discover(),
    ).rejects.toThrow(/redirect/u);
    await expect(client(() => reply('nope', 500)).oauth.discover()).rejects.toThrow(/500/u);
    await expect(
      client(() => reply('<html>', 200, 'text/html')).oauth.discover(),
    ).rejects.toThrow();
  });
});

describe('discovery at a tenants own domain', () => {
  const domain = stdioTarget('https://id.example.com', 'acme', 'https://login.acme.org');
  const domainDoc = {
    issuer: 'https://login.acme.org',
    authorization_endpoint: 'https://login.acme.org/protocol/openid-connect/auth',
    token_endpoint: 'https://login.acme.org/protocol/openid-connect/token',
    code_challenge_methods_supported: ['S256'],
  };

  function at(answers: Record<string, () => Response>) {
    const asked: string[] = [];
    const stub: typeof fetch = (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      asked.push(url);
      return Promise.resolve(answers[url]?.() ?? new Response('nope', { status: 404 }));
    };
    return {
      asked,
      oauth: createOauthClient(domain, {
        fetch: stub,
        now: () => NOW,
        publicClientId: 'odudu-mcp',
      }),
    };
  }

  it('asks the domain it was told of, and takes its issuer, and never the path form', async () => {
    const r = at({
      'https://login.acme.org/.well-known/oauth-authorization-server': () => reply(domainDoc),
    });
    expect((await r.oauth.discover()).issuer).toBe('https://login.acme.org');
    expect(r.asked).toEqual(['https://login.acme.org/.well-known/oauth-authorization-server']);
  });

  it('refuses a domain document of another host, and says what to do when neither form is there', async () => {
    const other = at({
      'https://login.acme.org/.well-known/oauth-authorization-server': () =>
        reply({ ...domainDoc, issuer: 'https://other.example' }),
    });
    await expect(other.oauth.discover()).rejects.toThrow(/issuer/u);
    await expect(at({}).oauth.discover()).rejects.toThrow(/domain of its own.*--tenant-address/u);
  });
});

describe('the token endpoint', () => {
  it('[MCP-AUTH-RES-02] redeems a code as the public client, with the verifier and the redirect URI', async () => {
    const { sent, oauth } = client(() => reply(tokenBody({ refresh_token: 'r1' })));
    const set = await oauth.redeemCode(server, {
      code: 'c1',
      verifier: 'v1',
      redirectUri: 'http://127.0.0.1:5555/',
      resource: ADMIN,
    });
    expect(set.refreshToken).toBe('r1');
    expect(set.expiresAt).toEqual(new Date('2026-11-06T10:05:00Z'));
    expect(sent[0]?.url).toBe(server.tokenEndpoint);
    expect(sent[0]?.init.method).toBe('POST');
    expect(sent[0]?.init.headers).toEqual({
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    });
    expect(form(sent[0]?.init ?? {})).toEqual({
      grant_type: 'authorization_code',
      code: 'c1',
      code_verifier: 'v1',
      redirect_uri: 'http://127.0.0.1:5555/',
      client_id: 'odudu-mcp',
      resource: ADMIN,
    });
  });

  it('refreshes with the refresh token and the scope it asked for', async () => {
    const { sent, oauth } = client(() => reply(tokenBody()));
    await oauth.refresh(server, { refreshToken: 'r1', scope: 'mcp:read', resource: ADMIN });
    expect(form(sent[0]?.init ?? {})).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'r1',
      client_id: 'odudu-mcp',
      scope: 'mcp:read',
      resource: ADMIN,
    });
  });

  it('authenticates a service with its signed assertion', async () => {
    const { sent, oauth } = client(() => reply(tokenBody()));
    await oauth.clientCredentials(server, {
      clientId: 'svc',
      assertion: 'signed.jwt.here',
      scope: 'mcp:read',
      resource: ADMIN,
    });
    expect(form(sent[0]?.init ?? {})).toEqual({
      grant_type: 'client_credentials',
      client_id: 'svc',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: 'signed.jwt.here',
      scope: 'mcp:read',
      resource: ADMIN,
    });
    expect(JSON.stringify(sent[0]?.init.headers)).not.toMatch(/authorization/iu);
  });

  it('names a refusal by its registered code, and never by its description', async () => {
    const { oauth } = client(() =>
      reply({ error: 'invalid_scope', error_description: 'LEAK secret-description' }, 400),
    );
    const error = await oauth
      .clientCredentials(server, {
        clientId: 'svc',
        assertion: 'a.b.c',
        scope: 'mcp:read',
        resource: ADMIN,
      })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'mcp_token_endpoint' });
    const message = (error as Error).message;
    expect(message).toContain('invalid_scope');
    expect(message).not.toMatch(/LEAK|secret-description|a\.b\.c/u);
  });

  it('reports an ended grant by its own code, and an unknown error as unrecognised', async () => {
    const ended = client(() => reply({ error: 'invalid_grant' }, 400)).oauth.refresh(server, {
      refreshToken: 'r1',
      scope: 'mcp:read',
      resource: ADMIN,
    });
    await expect(ended).rejects.toMatchObject({ code: 'mcp_grant_ended' });
    const odd = client(() => reply({ error: '<b>x</b>' }, 400)).oauth.refresh(server, {
      refreshToken: 'r1',
      scope: 'mcp:read',
      resource: ADMIN,
    });
    await expect(odd).rejects.toThrow(/unrecognised/u);
  });

  it('refuses a success that is not a token response, and a redirect', async () => {
    await expect(
      client(() => reply({ hello: 'world' })).oauth.redeemCode(server, {
        code: 'c',
        verifier: 'v',
        redirectUri: 'http://127.0.0.1:1/',
        resource: ADMIN,
      }),
    ).rejects.toThrow(/token response/u);
    await expect(
      client(
        () => new Response(null, { status: 307, headers: { location: 'https://evil.example' } }),
      ).oauth.refresh(server, { refreshToken: 'r', scope: 'mcp:read', resource: ADMIN }),
    ).rejects.toThrow(/redirect/u);
  });
});

describe('a response whose body cannot be read', () => {
  const broken = () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error('SECRET connection reset'));
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );

  it('is an unreachable server, so the acquisition cooldown applies, from discovery and from the token endpoint', async () => {
    const { oauth } = client(broken);
    await expect(oauth.discover()).rejects.toMatchObject({
      name: 'StdioError',
      code: 'mcp_unreachable',
    });
    await expect(
      oauth.refresh(server, { refreshToken: 'r', scope: 'mcp:read', resource: ADMIN }),
    ).rejects.toMatchObject({ name: 'StdioError', code: 'mcp_unreachable' });
  });
});
