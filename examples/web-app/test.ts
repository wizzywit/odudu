// Starts the app and tests it through a real browser: the sign-in, each check
// the app owes (state, nonce, PKCE, redirect address), replay and logout. A
// refusal is told apart by the reason the app logs, not only by its status.
// Needs a stack provisioned by ../_shared/provision.sh.
import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { browse, rewriteRedirect, signIn, signInAndWaitForApp } from '../_shared/browser.ts';

const PORT = '8081';
const APP = `http://localhost:${PORT}`;
const PASSWORD = 'a long and unremarkable passphrase';
// The app's /login redirects to Odudu's authorize address; Odudu's sign-in form
// posts to this address and is redirected to the app's callback.
const LOGIN = '**/login';
const AUTHENTICATE = '**/login-actions/authenticate';
let app: ChildProcess;
let output = '';

async function waitFor(url: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
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
  app = spawn(process.execPath, ['app.ts'], { env: { ...process.env, PORT } });
  app.stdout?.on('data', (chunk) => (output += String(chunk)));
  app.stderr?.on('data', (chunk) => (output += String(chunk)));
  await waitFor(`${APP}/`);
});

after(() => {
  app.kill();
});

// What a failed sign-in logged since the mark was taken.
async function refusalAfter(run: () => Promise<void>): Promise<string> {
  const mark = output.length;
  await run();
  return output.slice(mark);
}

test('sends the browser to Odudu with state, nonce, PKCE and the registered redirect address', async () => {
  const start = await fetch(`${APP}/login`, { redirect: 'manual' });
  const sent = new URL(start.headers.get('location') ?? '');
  assert.equal(sent.searchParams.get('response_type'), 'code');
  assert.equal(sent.searchParams.get('client_id'), 'example-web');
  assert.equal(sent.searchParams.get('redirect_uri'), `${APP}/callback`);
  assert.equal(sent.searchParams.get('code_challenge_method'), 'S256');
  assert.match(sent.searchParams.get('code_challenge') ?? '', /^[\w-]{43}$/u);
  assert.match(sent.searchParams.get('state') ?? '', /^[\w-]{20,}$/u);
  assert.match(sent.searchParams.get('nonce') ?? '', /^[\w-]{20,}$/u);
  const again = new URL(
    (await fetch(`${APP}/login`, { redirect: 'manual' })).headers.get('location') ?? '',
  );
  assert.notEqual(again.searchParams.get('state'), sent.searchParams.get('state'));
  assert.notEqual(again.searchParams.get('nonce'), sent.searchParams.get('nonce'));
  assert.notEqual(
    again.searchParams.get('code_challenge'),
    sent.searchParams.get('code_challenge'),
  );
});

test('signs a person in and shows who they are', async () => {
  await browse(async (page) => {
    await signInAndWaitForApp(page, APP, 'ada', PASSWORD);
    assert.match(await page.innerText('body'), /Signed in as ada/u);
  });
});

test('refuses a callback whose state is not the one it issued, though the code is valid', async () => {
  const reason = await refusalAfter(() =>
    browse(async (page) => {
      await rewriteRedirect(page, AUTHENTICATE, (url) => url.searchParams.set('state', 'forged'));
      await signIn(page, APP, 'ben', PASSWORD);
      await page.locator('text=Sign-in was refused').waitFor();
    }),
  );
  assert.match(reason, /state/u);
  assert.doesNotMatch(reason, /nonce|invalid_grant/u);
});

// The library also fails closed when no nonce is expected, with wording that
// names the nonce too, so only the sign-in test shows the check itself removed.
test('refuses an ID token minted for another sign-in, by its nonce', async () => {
  const reason = await refusalAfter(() =>
    browse(async (page) => {
      await rewriteRedirect(page, LOGIN, (url) => url.searchParams.set('nonce', 'another-sign-in'));
      await signIn(page, APP, 'ben', PASSWORD);
      await page.locator('text=Sign-in was refused').waitFor();
    }),
  );
  assert.match(reason, /nonce/u);
});

test('refuses a code that was bound to a different PKCE proof', async () => {
  const reason = await refusalAfter(() =>
    browse(async (page) => {
      await rewriteRedirect(page, LOGIN, (url) =>
        url.searchParams.set('code_challenge', 'x'.repeat(43)),
      );
      await signIn(page, APP, 'ben', PASSWORD);
      await page.locator('text=Sign-in was refused').waitFor();
    }),
  );
  assert.match(reason, /invalid_grant|PKCE|code_verifier/iu);
  assert.doesNotMatch(reason, /state|nonce/u);
});

test('refuses a callback with no sign-in under way', async () => {
  const callback = await fetch(`${APP}/callback?code=forged&state=x`);
  assert.equal(callback.status, 400);
  assert.match(await callback.text(), /No sign-in is under way/u);
});

test('refuses the same callback twice', async () => {
  const seen: { url: string; cookie: string }[] = [];
  await browse(async (page) => {
    await rewriteRedirect(page, AUTHENTICATE, undefined, (url, cookie) =>
      seen.push({ url, cookie }),
    );
    await signInAndWaitForApp(page, APP, 'ada', PASSWORD);
  });
  assert.equal(seen.length, 1);
  const first = seen[0];
  assert.ok(first !== undefined && first.cookie.startsWith('sid='));
  const replay = await fetch(first.url, { headers: { cookie: first.cookie } });
  assert.equal(replay.status, 400);
  assert.match(await replay.text(), /No sign-in is under way/u);
});

test('signs out of the app and of Odudu, so the next sign-in asks again', async () => {
  await browse(async (page) => {
    await signInAndWaitForApp(page, APP, 'ada', PASSWORD);
    await page.getByRole('button', { name: /sign out/i }).click();
    await page.getByRole('heading', { name: /^sign out\?$/iu }).waitFor();
    await page.getByRole('button', { name: /^sign out$/iu }).click();
    await page.waitForURL(`${APP}/`, { timeout: 15_000 });
    assert.match(await page.innerText('body'), /signed out/iu);
    await page.getByRole('link', { name: /sign in/i }).click();
    await page.locator('input[name=username]').fill('ada');
  });
});
