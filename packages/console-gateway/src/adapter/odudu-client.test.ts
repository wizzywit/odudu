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
  readonly host: string | undefined;
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
    seen.push({
      url: request.url,
      host: request.headers.host,
      form: new URLSearchParams(String(request.body)),
    });
    return res.code(reply.status).send(reply.body);
  });
  await app.ready();
  return oduduClient(app, BASE, { key, now: () => NOW }, (tenant) =>
    Promise.resolve(
      tenant === 'moved'
        ? { origin: 'https://login.moved.example', prefix: '' }
        : { origin: BASE.origin, prefix: `/tenants/${tenant}` },
    ),
  );
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

  it('reaches a tenant with a canonical domain at the root of that host, naming it as audience', async () => {
    const odudu = await client();
    await odudu.exchangeCode({
      tenant: 'moved',
      code: 'c',
      redirectUri: 'https://idp.example.test/console/auth/callback',
      verifier: 'v',
      from: FROM,
    });
    await odudu.refresh('moved', 'r', FROM);
    await odudu.revoke('moved', 'r', FROM);
    expect(seen.map((request) => [request.host, request.url])).toEqual([
      ['login.moved.example', '/protocol/openid-connect/token'],
      ['login.moved.example', '/protocol/openid-connect/token'],
      ['login.moved.example', '/protocol/openid-connect/revoke'],
    ]);
    const claims = await verifyJwtClaims(
      seen[0]?.form.get('client_assertion') ?? '',
      registeredClientJwks(key, []),
      {
        issuer: 'odudu-admin',
        audience: 'https://login.moved.example/protocol/openid-connect/token',
        now: NOW,
      },
    );
    expect(claims).not.toBeNull();
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

describe('forwardStream', () => {
  const CHUNK_MS = 50;
  const CHUNKS = 8;

  // An admin API whose route writes a chunk every CHUNK_MS and notes whether its
  // own response was closed before it finished.
  async function slowUpstream() {
    const state = { written: 0, closedEarly: false, finished: false };
    app = Fastify();
    app.post('/admin/stream', (_request, reply) => {
      reply.raw.once('close', () => {
        if (!reply.raw.writableFinished) state.closedEarly = true;
      });
      reply.hijack();
      reply.raw.writeHead(200, { 'content-type': 'text/event-stream' });
      const tick = () => {
        if (state.closedEarly || reply.raw.destroyed) return;
        if (state.written === CHUNKS) {
          state.finished = true;
          reply.raw.end();
          return;
        }
        reply.raw.write(`data: chunk${String(state.written)}\n\n`);
        state.written += 1;
        setTimeout(tick, CHUNK_MS);
      };
      tick();
    });
    await app.ready();
    const port = oduduClient(app, BASE, { key, now: () => NOW }, () =>
      Promise.reject(new Error('no tenant address')),
    );
    return { port, state };
  }

  const CALL = {
    method: 'POST',
    path: '/admin/stream',
    headers: {},
    body: undefined,
    from: FROM,
  } as const;

  it('hands the first chunk over while the upstream is still writing', async () => {
    const { port, state } = await slowUpstream();
    const res = await port.forwardStream(CALL, new AbortController().signal);
    expect(res.status).toBe(200);
    const chunks: string[] = [];
    for await (const chunk of res.body) {
      chunks.push(String(chunk));
      if (chunks.length === 1) expect(state.finished).toBe(false);
    }
    expect(chunks.join('')).toContain('chunk7');
    expect(state.finished).toBe(true);
  });

  it('stops the upstream handler when the response is destroyed', async () => {
    const { port, state } = await slowUpstream();
    const gone = new AbortController();
    const res = await port.forwardStream(CALL, gone.signal);
    await new Promise((resolve) => res.body.once('data', resolve));

    gone.abort();
    res.destroy();
    await new Promise((resolve) => setTimeout(resolve, CHUNK_MS * 3));
    expect(state.closedEarly).toBe(true);
    const written = state.written;
    await new Promise((resolve) => setTimeout(resolve, CHUNK_MS * 3));
    expect(state.written).toBe(written);
    expect(state.finished).toBe(false);
  });
});
