import { loadClientKey, verifyJwtAgainstJwkSet } from '@odudu/crypto';
import { ADMIN_API_AUDIENCE } from '@odudu/domain-tenant';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runMcp, SESSION } from '#/testing/mcp-session';

// What the token endpoint holds a private_key_jwt to, read from the server's
// own source so a change there fails this test rather than a service account.
const ASSERTION_SOURCE = readFileSync(
  new URL('../../../../packages/protocol-oidc/src/service/client-assertion.ts', import.meta.url),
  'utf8',
);
const constant = (name: string): number =>
  Number(new RegExp(`export const ${name} = (\\d+);`, 'u').exec(ASSERTION_SOURCE)?.[1]);
const MAX_LIFETIME = constant('MAX_ASSERTION_LIFETIME_SECONDS');
const LEEWAY = constant('ASSERTION_LEEWAY_SECONDS');

const BASE = 'https://id.example.com';
const ISSUER = `${BASE}/tenants/acme`;
const TOKEN_ENDPOINT = `${ISSUER}/protocol/openid-connect/token`;
const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

function capturing(): { assertions: string[]; fetch: typeof fetch } {
  const assertions: string[] = [];
  const reply = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  const stub: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/.well-known/oauth-authorization-server/tenants/acme')) {
      return Promise.resolve(
        reply({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`,
          token_endpoint: TOKEN_ENDPOINT,
          code_challenge_methods_supported: ['S256'],
        }),
      );
    }
    if (url === TOKEN_ENDPOINT) {
      const form = new URLSearchParams(typeof init?.body === 'string' ? init.body : '');
      assertions.push(form.get('client_assertion') ?? '');
      return Promise.resolve(
        reply({
          access_token: `${part({ alg: 'none' })}.${part({ iss: ISSUER, aud: [ADMIN_API_AUDIENCE], scope: 'mcp:read' })}.`,
          token_type: 'Bearer',
          expires_in: 300,
        }),
      );
    }
    return Promise.resolve(
      reply({
        subjectId: 's1',
        issuerTenantId: 't1',
        issuerTenantName: 'acme',
        capabilities: [],
        crossTenant: false,
        assistant_available: false,
      }),
    );
  };
  return { assertions, fetch: stub };
}

describe('the assertion the standalone command signs, held to the token endpoint', () => {
  it('is accepted by the server for a key the command itself generated', async () => {
    const generated = await runMcp(['--keygen']);
    const text = generated.stdout.trim().slice('ODUDU_MCP_KEY='.length);
    const registered = JSON.parse(generated.stderr.join('\n')) as { keys: unknown };
    const key = await loadClientKey(text);
    expect(registered.keys).toEqual([key.publicJwk]);

    const seen = capturing();
    const r = await runMcp(['--base-url', BASE, '--tenant', 'acme', '--client-id', 'svc'], {
      env: { ODUDU_MCP_KEY: text },
      input: SESSION,
      fetch: seen.fetch,
    });
    expect(r.code).toBe(0);
    const assertion = seen.assertions[0] ?? '';
    const [header, payload] = assertion
      .split('.')
      .slice(0, 2)
      .map(
        (segment) =>
          JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>,
      );
    expect(header).toEqual({ alg: 'ES256', kid: key.kid });
    expect(payload).toMatchObject({ iss: 'svc', sub: 'svc', aud: TOKEN_ENDPOINT });
    expect(typeof payload?.jti).toBe('string');
    const now = Date.now() / 1000;
    expect(Number(payload?.exp) - now).toBeLessThanOrEqual(MAX_LIFETIME);
    expect(Number(payload?.exp) + LEEWAY).toBeGreaterThan(now);
    expect(
      await verifyJwtAgainstJwkSet(
        assertion,
        { keys: [key.publicJwk] },
        {
          issuer: 'svc',
          audience: [TOKEN_ENDPOINT],
          now: new Date(),
          clockToleranceSeconds: LEEWAY,
        },
      ),
    ).toBe(true);
  });
});
