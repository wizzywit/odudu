import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { listenOnLoopback } from '#/adapter/loopback-listener';
import type { LoopbackListener } from '#/service/ports';

const open: LoopbackListener[] = [];

async function listener(timeoutMs = 5_000, maxBadRequests = 20): Promise<LoopbackListener> {
  const made = await listenOnLoopback({ timeoutMs, state: 's1', maxBadRequests });
  open.push(made);
  return made;
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((l) => l.close()));
});

function get(
  url: string,
  options: { method?: string; host?: string } = {},
): Promise<{
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = request(
      {
        host: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: options.method ?? 'GET',
        headers: options.host === undefined ? {} : { host: options.host },
        agent: false,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body, headers: res.headers });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const outcome = (url: string) =>
  get(url).then(
    (r) => r.status,
    () => 'refused' as const,
  );

describe('the loopback listener of a sign-in', () => {
  it('listens on 127.0.0.1 at an ephemeral port and names the redirect URI at path /', async () => {
    const l = await listener();
    const url = new URL(l.redirectUri);
    expect(url.protocol).toBe('http:');
    expect(url.hostname).toBe('127.0.0.1');
    expect(Number(url.port)).toBeGreaterThan(0);
    expect(url.pathname).toBe('/');
    expect(url.search).toBe('');
  });

  it('hands over the query of the first request at / and answers with a fixed page', async () => {
    const l = await listener();
    const res = await get(`${l.redirectUri}?code=c1&state=s1&iss=i`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/u);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(String(res.headers['content-security-policy'])).toContain("default-src 'none'");
    const params = await l.callback;
    expect(params.get('code')).toBe('c1');
    expect(params.get('state')).toBe('s1');
  });

  it('never reflects what the request carried into the page', async () => {
    const l = await listener();
    const res = await get(
      `${l.redirectUri}?state=s1&x=%3Cscript%3Ealert(1)%3C/script%3E&error_description=EVIL`,
    );
    expect(res.body).not.toMatch(/script|EVIL/u);
  });

  it('accepts no second request: it is refused or answered 404', async () => {
    const l = await listener();
    await get(`${l.redirectUri}?code=c1&state=s1`);
    await l.callback;
    expect([404, 'refused']).toContain(await outcome(`${l.redirectUri}?code=c2&state=s1`));
  });

  it('answers 404 at any other path without spending the one request', async () => {
    const l = await listener();
    const base = l.redirectUri;
    expect((await get(`${base}callback?code=x&state=s`)).status).toBe(404);
    expect((await get(`${base}favicon.ico`)).status).toBe(404);
    expect((await get(`${base}?code=c1&state=s1`)).status).toBe(200);
    expect((await l.callback).get('code')).toBe('c1');
  });

  it('does not spend the request on one that carries no state, or is not a GET', async () => {
    const l = await listener();
    expect((await get(l.redirectUri)).status).toBe(400);
    expect((await get(`${l.redirectUri}?code=x&state=s`, { method: 'POST' })).status).toBe(405);
    expect((await get(`${l.redirectUri}?code=c1&state=s1`)).status).toBe(200);
    expect((await l.callback).get('code')).toBe('c1');
  });

  it('refuses a request whose Host is not the loopback address and port it listens on', async () => {
    const l = await listener();
    const res = await get(`${l.redirectUri}?code=x&state=s`, { host: 'evil.example' });
    expect(res.status).toBe(421);
    expect((await get(`${l.redirectUri}?code=c1&state=s1`)).status).toBe(200);
  });

  it('gives up after its timeout and stops listening', async () => {
    const l = await listener(30);
    await expect(l.callback).rejects.toMatchObject({ code: 'mcp_login_timeout' });
    expect(await outcome(`${l.redirectUri}?code=x&state=s`)).toBe('refused');
  });

  it('stops listening when closed, and closing twice is harmless', async () => {
    const l = await listener();
    const settled = l.callback.catch((error: unknown) => error);
    await l.close();
    await l.close();
    expect(await settled).toMatchObject({ code: 'mcp_login_cancelled' });
    expect(await outcome(`${l.redirectUri}?code=x&state=s`)).toBe('refused');
  });

  it('spends its one request only on the state it was given, and keeps waiting after a forged one', async () => {
    const l = await listener();
    const forged = await get(`${l.redirectUri}?code=evil&state=forged`);
    expect(forged.status).toBe(400);
    expect(forged.body).not.toMatch(/forged|evil/u);
    expect((await get(`${l.redirectUri}?code=evil&state=s1&state=s1`)).status).toBe(400);
    expect((await get(`${l.redirectUri}?code=c1&state=s1`)).status).toBe(200);
    expect((await l.callback).get('code')).toBe('c1');
  });

  it('gives up, saying why, after more bad requests than it tolerates, and stops listening', async () => {
    const l = await listener(5_000, 3);
    const failed = l.callback.catch((error: unknown) => error);
    for (let i = 0; i < 4; i += 1) await outcome(`${l.redirectUri}?state=forged${String(i)}`);
    expect(await failed).toMatchObject({ code: 'mcp_login_flooded' });
    expect(await outcome(`${l.redirectUri}?state=s1`)).toBe('refused');
  });
});
