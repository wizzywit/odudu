// Runs the client against a stack provisioned by ../_shared/provision.sh, with
// the API example running beside it, and checks what the client printed.
import assert from 'node:assert/strict';
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { createTokenSource } from '@odudu-io/oidc';

const API_PORT = '8082';
let api: ChildProcess;

before(async () => {
  api = spawn(process.execPath, ['server.ts'], {
    cwd: new URL('../api/', import.meta.url),
    env: { ...process.env, PORT: API_PORT },
    stdio: 'inherit',
  });
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await fetch(`http://localhost:${API_PORT}/`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error('the API never answered');
});

after(() => {
  api.kill();
});

test('gets a token as itself and calls the API with it', () => {
  const output = execFileSync(process.execPath, ['client.ts'], {
    env: { ...process.env, API_URL: `http://localhost:${API_PORT}` },
    encoding: 'utf8',
  });
  assert.match(output, /API answered 200/u);
  assert.match(output, /example-m2m/u);
});

test('is refused with the wrong secret', () => {
  assert.throws(
    () =>
      execFileSync(process.execPath, ['client.ts'], {
        env: { ...process.env, CLIENT_SECRET: 'not-the-secret' },
        stdio: 'pipe',
      }),
    /invalid_client/u,
  );
});

test('asks for a token once, and again only when the one it holds is about to expire', async () => {
  const base = process.env.ODUDU_BASE ?? 'http://localhost:3000';
  let requests = 0;
  let clock = Date.now();
  const source = createTokenSource(
    {
      issuer: `${base}/tenants/demo`,
      clientId: 'example-m2m',
      auth: { secret: 'example-m2m-secret' },
      scope: 'reports:read',
    },
    {
      allowInsecureRequests: true,
      // The SDK reads the tenant's metadata through the same fetch; only token requests count.
      fetch: (input, init) => {
        if (String(input).endsWith('/token')) requests += 1;
        return fetch(input, init);
      },
      now: () => clock,
    },
  );
  const first = await source();
  assert.equal(await source(), first);
  assert.equal(requests, 1);
  // The token lives 300 seconds and is renewed 30 seconds early.
  clock += 269_000;
  assert.equal(await source(), first);
  assert.equal(requests, 1);
  clock += 2_000;
  assert.notEqual(await source(), first);
  assert.equal(requests, 2);
});

test('makes one token request when two calls arrive together', async () => {
  const base = process.env.ODUDU_BASE ?? 'http://localhost:3000';
  let requests = 0;
  const source = createTokenSource(
    {
      issuer: `${base}/tenants/demo`,
      clientId: 'example-m2m',
      auth: { secret: 'example-m2m-secret' },
      scope: 'reports:read',
    },
    {
      allowInsecureRequests: true,
      // The SDK reads the tenant's metadata through the same fetch; only token requests count.
      fetch: (input, init) => {
        if (String(input).endsWith('/token')) requests += 1;
        return fetch(input, init);
      },
    },
  );
  const [first, second] = await Promise.all([source(), source()]);
  assert.equal(first, second);
  assert.equal(requests, 1);
});
