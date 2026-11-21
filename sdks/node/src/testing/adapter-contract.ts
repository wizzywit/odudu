import { request } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createVerifier } from '#/use-cases/create-verifier';
import type { Verifier } from '#/types';
import {
  type FakeIssuer,
  type TestKey,
  mintToken,
  startFakeIssuer,
  testKey,
} from '#/testing/fake-issuer';

export interface RunningApp {
  origin: string;
  // What reached the framework's error path.
  errors: unknown[];
  // How many times the protected handler ran.
  handled: () => number;
  close: () => Promise<void>;
}

// An app with `GET /reports` (any valid token), `GET /reports-write` (the
// scope `reports:write`) and `GET /open` (no token), answering a verified
// request with `{ sub, scope }`, and a framework error path that answers 500
// `{ error: 'server_error' }`.
export type StartApp = (verifier: Verifier) => Promise<RunningApp>;

const NOW_MS = 1_900_000_000_000;

function rawGet(
  url: string,
  headers: Record<string, string | string[]>,
): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

export function describeAdapterContract(name: string, start: StartApp): void {
  describe(`${name} adapter`, () => {
    let issuer: FakeIssuer;
    let key: TestKey;
    let token: string;
    let app: RunningApp;

    const verifier = (clock = NOW_MS): Verifier =>
      createVerifier({
        issuers: [issuer.issuer],
        audience: 'https://api.example.test',
        clock: () => clock,
        allowInsecureIssuers: true,
      });
    const get = (path: string, headers: Record<string, string | string[]> = {}) =>
      rawGet(`${app.origin}${path}`, headers);
    const bearer = { authorization: '' };

    beforeAll(async () => {
      key = await testKey('test-key');
      issuer = await startFakeIssuer([key.jwk]);
      token = await mintToken(key, issuer.issuer, 'https://api.example.test', NOW_MS / 1000);
      bearer.authorization = `Bearer ${token}`;
      app = await start(verifier());
    });
    afterAll(async () => {
      await app.close();
      await issuer.close();
    });

    it('hands a valid token to the handler with auth populated', async () => {
      const res = await get('/reports', bearer);
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ sub: 'subject-1', scope: ['reports:read'] });
    });

    it('takes the scheme in any case', async () => {
      const res = await get('/reports', { authorization: `bEaReR ${token}` });
      expect(res.status).toBe(200);
    });

    it('answers 401 with a bare Bearer challenge when no credentials are sent', async () => {
      const res = await get('/reports');
      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toBe('Bearer');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['content-type']).toContain('application/json');
      expect(JSON.parse(res.body)).toMatchObject({ error: 'unauthorized' });
    });

    it('answers 401 with a bare challenge for another scheme', async () => {
      const res = await get('/reports', { authorization: 'Basic dXNlcjpwYXNz' });
      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toBe('Bearer');
    });

    it('answers 401 invalid_token with the challenge for an expired token', async () => {
      const late = await start(verifier(NOW_MS + 3_600_000));
      try {
        const res = await rawGet(`${late.origin}/reports`, bearer);
        expect(res.status).toBe(401);
        expect(res.headers['www-authenticate']).toBe(
          'Bearer error="invalid_token", error_description="The access token expired"',
        );
        expect(JSON.parse(res.body)).toEqual({
          error: 'invalid_token',
          error_description: 'The access token expired',
        });
        expect(late.handled()).toBe(0);
        expect(res.body).not.toContain(token);
      } finally {
        await late.close();
      }
    });

    it('answers 403 insufficient_scope when a route needs a scope the token lacks', async () => {
      const res = await get('/reports-write', bearer);
      expect(res.status).toBe(403);
      expect(res.headers['www-authenticate']).toContain('error="insufficient_scope"');
      expect(res.headers['www-authenticate']).toContain('scope="reports:write"');
      expect(JSON.parse(res.body)).toMatchObject({ error: 'insufficient_scope' });
      expect(res.body).not.toContain(token);
    });

    it('answers 503 with Retry-After when the keys cannot be read', async () => {
      issuer.jwksStatus = 500;
      const down = await start(verifier());
      try {
        const res = await rawGet(`${down.origin}/reports`, bearer);
        expect(res.status).toBe(503);
        expect(res.headers['retry-after']).toBe('10');
        expect(res.headers['www-authenticate']).toBeUndefined();
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.body).not.toContain(token);
        expect(res.body).not.toContain('127.0.0.1');
        expect(down.handled()).toBe(0);
      } finally {
        issuer.jwksStatus = 200;
        await down.close();
      }
    });

    it('never reads a token from the query string', async () => {
      const res = await get(`/reports?access_token=${token}`);
      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toBe('Bearer');
    });

    it('refuses more than one Authorization header with 400', async () => {
      const res = await get('/reports', { authorization: [`Bearer ${token}`, `Bearer ${token}`] });
      expect(res.status).toBe(400);
      expect(res.headers['www-authenticate']).toBe('Bearer error="invalid_request"');
      expect(res.body).not.toContain(token);
    });

    for (const value of ['Bearer', 'Bearer ', 'Bearer a b', 'Bearer  a', 'Bearer a,b']) {
      it(`refuses the malformed value ${JSON.stringify(value)} with 400`, async () => {
        const res = await get('/reports', { authorization: value });
        expect(res.status).toBe(400);
        expect(res.headers['www-authenticate']).toBe('Bearer error="invalid_request"');
      });
    }

    it('leaves a route without the middleware open', async () => {
      expect((await get('/open')).status).toBe(200);
    });

    it('passes any other error to the framework and shows none of it', async () => {
      const broken = await start(() => Promise.reject(new Error('secret detail')));
      try {
        const res = await rawGet(`${broken.origin}/reports`, bearer);
        expect(res.status).toBe(500);
        expect(res.body).not.toContain('secret detail');
        expect(res.body).not.toContain(token);
        expect(broken.errors).toHaveLength(1);
        expect(broken.errors[0]).toMatchObject({ message: 'secret detail' });
      } finally {
        await broken.close();
      }
    });
  });
}
