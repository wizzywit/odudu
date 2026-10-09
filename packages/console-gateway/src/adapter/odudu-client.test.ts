import {
  generateClientKey,
  loadClientKey,
  registeredClientJwks,
  verifyJwtClaims,
  type ClientKey,
} from '@odudu/crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { oduduClient } from '#/adapter/odudu-client';
import { type Caller } from '#/service/odudu-port';

const BASE = new URL('https://idp.example.test');
const NOW = new Date('2026-10-09T08:00:00Z');
const FROM: Caller = { ip: '203.0.113.9', requestId: 'req-1' };
const TOKEN_ENDPOINT = 'https://idp.example.test/tenants/acme/protocol/openid-connect/token';

interface Seen {
  readonly url: string;
  readonly form: URLSearchParams;
}

let key: ClientKey;
let app: FastifyInstance | undefined;
let seen: Seen[] = [];

beforeAll(async () => {
  key = await loadClientKey(await generateClientKey());
});

afterEach(async () => {
  await app?.close();
  seen = [];
});

async function client(reply: { status: number; body: unknown } = { status: 200, body: {} }) {
  app = Fastify();
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_r, body, done) => {
      done(null, body);
    },
  );
  app.post('/*', (request, res) => {
    seen.push({ url: request.url, form: new URLSearchParams(String(request.body)) });
    return res.code(reply.status).send(reply.body);
  });
  await app.ready();
  return oduduClient(app, BASE, { key, now: () => NOW });
}

async function assertionOf(form: URLSearchParams): Promise<Record<string, unknown> | null> {
  expect(form.get('client_assertion_type')).toBe(
    'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
  );
  return verifyJwtClaims(form.get('client_assertion') ?? '', registeredClientJwks(key, []), {
    issuer: 'odudu-admin',
    audience: TOKEN_ENDPOINT,
    now: NOW,
  });
}

describe('oduduClient: client authentication', () => {
  it('signs an assertion on the code exchange, and sends no secret', async () => {
    const odudu = await client();
    await odudu.exchangeCode({
      tenant: 'acme',
      code: 'c',
      redirectUri: 'https://idp.example.test/console/auth/callback',
      verifier: 'v',
      from: FROM,
    });
    const [request] = seen;
    expect(request?.url).toBe('/tenants/acme/protocol/openid-connect/token');
    expect(request?.form.get('client_secret')).toBeNull();
    expect(await assertionOf(request?.form ?? new URLSearchParams())).toMatchObject({
      iss: 'odudu-admin',
      sub: 'odudu-admin',
      aud: TOKEN_ENDPOINT,
    });
  });

  it('signs an assertion on a refresh', async () => {
    const odudu = await client();
    await odudu.refresh('acme', 'r', FROM);
    const [request] = seen;
    expect(request?.form.get('grant_type')).toBe('refresh_token');
    expect(await assertionOf(request?.form ?? new URLSearchParams())).not.toBeNull();
  });

  it('signs an assertion on a revocation, naming the token endpoint as the audience', async () => {
    const odudu = await client();
    await odudu.revoke('acme', 'r', FROM);
    const [request] = seen;
    expect(request?.url).toBe('/tenants/acme/protocol/openid-connect/revoke');
    expect(await assertionOf(request?.form ?? new URLSearchParams())).not.toBeNull();
  });

  it('never signs the same assertion twice', async () => {
    const odudu = await client();
    await odudu.refresh('acme', 'r', FROM);
    await odudu.refresh('acme', 'r', FROM);
    const jtis = await Promise.all(
      seen.map(async (request) => (await assertionOf(request.form))?.jti),
    );
    expect(new Set(jtis).size).toBe(2);
  });

  it('names the tenant in the audience, so one tenant’s assertion is no use at another', async () => {
    const odudu = await client();
    await odudu.refresh('globex', 'r', FROM);
    const claims = await verifyJwtClaims(
      seen[0]?.form.get('client_assertion') ?? '',
      registeredClientJwks(key, []),
      {
        issuer: 'odudu-admin',
        audience: 'https://idp.example.test/tenants/globex/protocol/openid-connect/token',
        now: NOW,
      },
    );
    expect(claims).not.toBeNull();
  });
});
