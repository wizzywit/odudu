// Builds and starts the app, then signs a person in with plain requests: the
// handlers' login and callback, a protected page rendered by a server
// component, the session read, and the sign-out. Cookies are carried by hand
// because the session cookie is `Secure` and the app runs over http.
// Needs a stack provisioned by ../_shared/provision.sh.
import assert from 'node:assert/strict';
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { after, before, test } from 'node:test';

const PORT = '8085';
const APP = `http://localhost:${PORT}`;
const BASE = process.env.ODUDU_BASE ?? 'http://localhost:3000';
const TENANT = process.env.TENANT ?? 'demo';
const PASSWORD = 'a long and unremarkable passphrase';
const NEXT = ['node_modules/next/dist/bin/next'];
let app: ChildProcess;

async function waitFor(url: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`${url} never answered`);
}

before(async () => {
  const env = { ...process.env, ODUDU_BASE: BASE, TENANT };
  execFileSync(process.execPath, [...NEXT, 'build'], { env, stdio: 'inherit' });
  app = spawn(process.execPath, [...NEXT, 'start', '--port', PORT], { env, stdio: 'inherit' });
  await waitFor(`${APP}/`);
});

after(() => {
  app.kill();
});

const get = (url: string, headers: Record<string, string> = {}, init: RequestInit = {}) =>
  fetch(url, { redirect: 'manual', headers, ...init });

function cookieOf(response: Response, name: string): string {
  const line = response.headers.getSetCookie().find((entry) => entry.startsWith(`${name}=`));
  assert.ok(line, `no ${name} cookie`);
  return line.split(';')[0] ?? '';
}

function stateOf(html: string): string {
  return /<p id="state">(.*?)<\/p>/u.exec(html)?.[1]?.replaceAll('<!-- -->', '') ?? '';
}

// Runs the sign-in from the app's login route and returns the browser's cookies.
async function signIn(returnTo: string): Promise<{ cookie: string; callback: Response }> {
  const login = await get(`${APP}/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  assert.equal(login.status, 302);
  const sent = new URL(login.headers.get('location') ?? '');
  const held = login.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0])
    .join('; ');
  const form = await get(sent.href);
  const authSession = /name="auth_session_id" value="([^"]+)"/u.exec(await form.text())?.[1] ?? '';
  const answer = await get(
    `${sent.origin}/tenants/${TENANT}/login-actions/authenticate`,
    {
      cookie: form.headers.getSetCookie()[0]?.split(';')[0] ?? '',
      'content-type': 'application/x-www-form-urlencoded',
      origin: sent.origin,
    },
    {
      method: 'POST',
      body: new URLSearchParams({
        auth_session_id: authSession,
        username: 'ada',
        password: PASSWORD,
      }),
    },
  );
  const callback = await get(answer.headers.get('location') ?? '', { cookie: held });
  return { cookie: cookieOf(callback, '__Host-odudu'), callback };
}

test('signs a person in, shows them to a server component and sends them where they were going', async () => {
  const { cookie, callback } = await signIn('/dashboard?tab=2');
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('location'), '/dashboard?tab=2');

  const dashboard = await get(`${APP}/dashboard`, { cookie });
  assert.equal(dashboard.status, 200);
  assert.match(stateOf(await dashboard.text()), /^Hello, \S+\.$/u);

  const session = await get(`${APP}/api/auth/session`, { cookie, 'x-odudu-bff': '1' });
  const body = await session.text();
  assert.equal(session.status, 200);
  assert.equal(JSON.parse(body).authenticated, true);
  assert.doesNotMatch(body, /eyJ[\w-]+\.[\w-]+\./u);

  const out = await get(
    `${APP}/api/auth/logout`,
    { cookie, 'x-odudu-bff': '1', origin: APP },
    { method: 'POST' },
  );
  assert.equal(out.status, 200);
  const after = await get(`${APP}/dashboard`, { cookie });
  assert.match(stateOf(await after.text()), /^No session\.$/u);
});

test('sends a request for a protected page without a session to sign in', async () => {
  const response = await get(`${APP}/dashboard`);
  assert.equal(response.status, 307);
  assert.equal(response.headers.get('location'), '/api/auth/login?returnTo=%2Fdashboard');
});

test('does not send the person to a returnTo on another site', async () => {
  const { callback } = await signIn('https://evil.example/');
  assert.equal(callback.headers.get('location'), '/');
});
