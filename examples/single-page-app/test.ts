// Builds the app, serves it and tests it through a real browser: the sign-in,
// each check the app owes (state, nonce, PKCE, redirect address), replay,
// where the tokens are kept, CORS and sign-out. A refusal is told apart by the
// reason the app logs to the console, not only by what the page says.
// Needs a stack provisioned by ../_shared/provision.sh.
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { after, before, test } from 'node:test';
import {
  browse,
  rewriteRedirect,
  rewriteRequest,
  signIn,
  signInAndWaitForApp,
  type Page,
} from '../_shared/browser.ts';

const PORT = '8084';
const APP = `http://localhost:${PORT}`;
const ODUDU = process.env.ODUDU_BASE ?? 'http://localhost:3000';
const PASSWORD = 'a long and unremarkable passphrase';
const AUTHORIZE = '**/protocol/openid-connect/auth?*';
const AUTHENTICATE = '**/login-actions/authenticate';
const VITE = ['node_modules/vite/bin/vite.js'];
let server: ChildProcess;

const env = { ...process.env, VITE_ODUDU_BASE: ODUDU };

before(async () => {
  execFileSync(process.execPath, [...VITE, 'build'], { env, stdio: 'inherit' });
  server = spawn(process.execPath, [...VITE, 'preview', '--port', PORT, '--strictPort'], { env });
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await fetch(`${APP}/`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`${APP} never answered`);
});

after(() => {
  server.kill();
});

// What the page logs to its console, which is where it says why it refused.
function watchConsole(page: Page): string[] {
  const logged: string[] = [];
  page.on('console', (message) => logged.push(message.text()));
  return logged;
}

async function refused(page: Page): Promise<void> {
  await page.locator('text=Sign-in was refused').waitFor();
}

test('sends the browser to Odudu with state, nonce, PKCE and the registered redirect address', async () => {
  const sent: URL[] = [];
  await browse(async (page) => {
    await rewriteRequest(page, AUTHORIZE, (url) => sent.push(new URL(url)));
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.goto(`${APP}/`);
      await page.getByRole('button', { name: /sign in/i }).click();
      await page.locator('input[name=username]').waitFor();
    }
  });
  const [first, second] = sent;
  assert.ok(first !== undefined && second !== undefined);
  const params = first.searchParams;
  assert.equal(params.get('response_type'), 'code');
  assert.equal(params.get('client_id'), 'example-spa');
  assert.equal(params.get('redirect_uri'), `${APP}/callback`);
  assert.equal(params.get('code_challenge_method'), 'S256');
  assert.match(params.get('code_challenge') ?? '', /^[\w-]{43}$/u);
  assert.match(params.get('state') ?? '', /^[\w-]{20,}$/u);
  assert.match(params.get('nonce') ?? '', /^[\w-]{20,}$/u);
  assert.equal(params.get('client_secret'), null);
  for (const name of ['state', 'nonce', 'code_challenge']) {
    assert.notEqual(second.searchParams.get(name), params.get(name), name);
  }
});

test('signs a person in, shows who and when the token expires, keeps tokens out of storage and signs in again after a reload', async () => {
  await browse(async (page) => {
    await signInAndWaitForApp(page, APP, 'ada', PASSWORD, 'button');
    await page.locator('text=Signed in as ada').waitFor();
    const body = await page.innerText('body');
    const expiry = /expires (\d{4}-\d\d-\d\dT[\d:.]+Z)/u.exec(body)?.[1] ?? '';
    const until = Date.parse(expiry) - Date.now();
    assert.ok(until > 0 && until <= 24 * 3600 * 1000, `expiry ${expiry}`);

    const stored = await page.evaluate(async () =>
      JSON.stringify([
        { ...localStorage },
        { ...sessionStorage },
        document.cookie,
        await indexedDB.databases(),
      ]),
    );
    assert.doesNotMatch(stored, /eyJ/u, 'a token reached the browser');
    assert.equal(stored, '[{},{},"",[]]');

    // A reload drops the tokens; Odudu still holds the session, so signing in
    // again needs no password.
    await page.reload();
    assert.match(await page.innerText('body'), /signed out/iu);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.locator('text=Signed in as ada').waitFor();
  });
});

test('refuses a callback whose state is not the one it issued, though the code is valid', async () => {
  await browse(async (page) => {
    const logged = watchConsole(page);
    await rewriteRedirect(page, AUTHENTICATE, (url) => url.searchParams.set('state', 'forged'));
    await signIn(page, APP, 'ben', PASSWORD, 'button');
    await refused(page);
    const reason = logged.join('\n');
    assert.match(reason, /state/u);
    assert.doesNotMatch(reason, /nonce|invalid_grant/u);
  });
});

test('refuses an answer that names another issuer', async () => {
  await browse(async (page) => {
    const logged = watchConsole(page);
    await rewriteRedirect(page, AUTHENTICATE, (url) =>
      url.searchParams.set('iss', 'https://another-issuer.example'),
    );
    await signIn(page, APP, 'ben', PASSWORD, 'button');
    await refused(page);
    const reason = logged.join('\n');
    assert.match(reason, /unexpected "iss" \(issuer\) response parameter/u);
    assert.doesNotMatch(reason, /state|nonce|invalid_grant/u);
  });
});

// The library also fails closed when no nonce is expected, with wording that
// names the nonce too, so only the sign-in test shows the check itself removed.
test('refuses an ID token minted for another sign-in, by its nonce', async () => {
  await browse(async (page) => {
    const logged = watchConsole(page);
    await rewriteRequest(page, AUTHORIZE, (url) => url.searchParams.set('nonce', 'another'));
    await signIn(page, APP, 'ben', PASSWORD, 'button');
    await refused(page);
    assert.match(logged.join('\n'), /nonce/u);
  });
});

test('refuses a code that was bound to a different PKCE proof', async () => {
  await browse(async (page) => {
    const logged = watchConsole(page);
    await rewriteRequest(page, AUTHORIZE, (url) =>
      url.searchParams.set('code_challenge', 'x'.repeat(43)),
    );
    await signIn(page, APP, 'ben', PASSWORD, 'button');
    await refused(page);
    const reason = logged.join('\n');
    assert.match(reason, /invalid_grant/u);
    assert.doesNotMatch(reason, /state|nonce/u);
  });
});

test('refuses the same callback twice, because the values it needs are gone', async () => {
  const callbacks: string[] = [];
  await browse(async (page) => {
    const logged = watchConsole(page);
    await rewriteRedirect(page, AUTHENTICATE, undefined, (url) => callbacks.push(url));
    await signInAndWaitForApp(page, APP, 'ada', PASSWORD, 'button');
    await page.locator('text=Signed in as ada').waitFor();
    const [callback] = callbacks;
    assert.ok(callback !== undefined && callback.startsWith(`${APP}/callback?code=`));
    await page.goto(callback);
    await refused(page);
    assert.match(logged.join('\n'), /No sign-in is under way/u);
  });
});

test('refuses a callback with no sign-in under way', async () => {
  await browse(async (page) => {
    const logged = watchConsole(page);
    await page.goto(`${APP}/callback?code=forged&state=x`);
    await refused(page);
    assert.match(logged.join('\n'), /No sign-in is under way/u);
  });
});

test("lets the app's origin call Odudu from a browser, and no other origin", async () => {
  const preflight = (origin: string) =>
    fetch(`${ODUDU}/tenants/demo/protocol/openid-connect/token`, {
      method: 'OPTIONS',
      headers: { origin, 'access-control-request-method': 'POST' },
    });
  const allowed = await preflight(APP);
  assert.equal(allowed.headers.get('access-control-allow-origin'), APP);
  const other = await preflight('http://localhost:9');
  assert.equal(other.headers.get('access-control-allow-origin'), null);
});

test('signs out of the app and of Odudu, so the next sign-in asks again', async () => {
  await browse(async (page) => {
    await signInAndWaitForApp(page, APP, 'ada', PASSWORD, 'button');
    await page.locator('text=Signed in as ada').waitFor();
    await page.getByRole('button', { name: /sign out/i }).click();
    await page.getByRole('heading', { name: /^sign out\?$/iu }).waitFor();
    await page.getByRole('button', { name: /^sign out$/iu }).click();
    await page.locator('text=You are signed out').waitFor();
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.locator('input[name=username]').fill('ada');
  });
});
