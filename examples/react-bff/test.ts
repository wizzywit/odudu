// Builds the page, starts the server and tests them through a real browser:
// signed out at first, the sign-in at Odudu's own page, the claims on screen,
// no token in what the page can read, and the sign-out.
// Needs a stack provisioned by ../_shared/provision.sh.
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { after, before, test } from 'node:test';
import { browse, signInAndWaitForApp } from '../_shared/browser.ts';

const PORT = '8083';
const APP = `http://localhost:${PORT}`;
const PASSWORD = 'a long and unremarkable passphrase';
const VITE = ['node_modules/vite/bin/vite.js'];
let server: ChildProcess;

before(async () => {
  execFileSync(process.execPath, [...VITE, 'build'], { stdio: 'inherit' });
  server = spawn(process.execPath, ['server.ts'], { env: { ...process.env, PORT } });
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

test('starts signed out, and the session route says so without a cookie', async () => {
  const session = await fetch(`${APP}/bff/session`, { headers: { 'x-odudu-bff': '1' } });
  assert.deepEqual(await session.json(), { authenticated: false });
  await browse(async (page) => {
    await page.goto(`${APP}/`);
    await page.locator('text=You are signed out').waitFor();
  });
});

test('signs a person in, shows their claims and holds no token the page can read', async () => {
  await browse(async (page) => {
    await signInAndWaitForApp(page, APP, 'ada', PASSWORD, 'button');
    await page.locator('text=Signed in as ada').waitFor();
    assert.match(await page.innerText('body'), /"preferred_username": "ada"/u);

    const session = await page.evaluate(async () => {
      const response = await fetch('/bff/session', { headers: { 'x-odudu-bff': '1' } });
      return response.text();
    });
    assert.equal(JSON.parse(session).authenticated, true);
    assert.doesNotMatch(session, /eyJ[\w-]+\.[\w-]+\./u);

    const stored = await page.evaluate(async () =>
      JSON.stringify([
        { ...localStorage },
        { ...sessionStorage },
        document.cookie,
        await indexedDB.databases(),
      ]),
    );
    assert.equal(stored, '[{},{},"",[]]');
  });
});

test('signs out of the app and of Odudu', async () => {
  await browse(async (page) => {
    await signInAndWaitForApp(page, APP, 'ben', PASSWORD, 'button');
    await page.locator('text=Signed in as ben').waitFor();
    await page.getByRole('button', { name: /sign out/i }).click();
    await page.getByRole('heading', { name: /^sign out\?$/iu }).waitFor();
    await page.getByRole('button', { name: /^sign out$/iu }).click();
    await page.locator('text=You are signed out').waitFor();
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.locator('input[name=username]').fill('ben');
  });
});
