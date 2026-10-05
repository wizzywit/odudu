import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { type Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { psql, seed } from './stack.ts';

// A relying party on an origin of its own, which the console never is.
// Chromium holds the redirect a form submission follows to the page's
// form-action, so this is the one place a refused redirect shows.

const TENANT = `rp-${randomBytes(4).toString('hex')}`;
const VERIFIER = randomBytes(32).toString('base64url');
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');

let server: Server;
let redirectUri: string;

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function base32(secret: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.replace(/=+$/u, '')) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

// RFC 6238 with the server's parameters: SHA-1, 30-second steps, 6 digits.
function totp(secret: string): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const mac = createHmac('sha1', base32(secret)).update(counter).digest();
  const offset = (mac.at(-1) ?? 0) & 0xf;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, '0');
}

function user(username: string, password: string): void {
  seed(['user', '--tenant', TENANT, '--username', username, `--password=${password}`]);
}

async function startAt(page: Page): Promise<void> {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: 'rp',
    redirect_uri: redirectUri,
    scope: 'openid',
    state: 'kept',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  await page.goto(`/tenants/${TENANT}/protocol/openid-connect/auth?${query.toString()}`);
}

async function signInWith(page: Page, username: string, password: string): Promise<void> {
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

async function expectAtClient(page: Page): Promise<void> {
  await page.waitForURL((url) => url.href.startsWith(redirectUri));
  const landed = new URL(page.url());
  expect(landed.searchParams.get('code')).toBeTruthy();
  expect(landed.searchParams.get('state')).toBe('kept');
  await expect(page.getByRole('heading', { level: 1, name: 'Callback' })).toBeVisible();
}

test.beforeAll(async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Callback</title><h1>Callback</h1>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  redirectUri = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/callback`;
  seed(['tenant', '--name', TENANT]);
  seed([
    'client',
    '--tenant',
    TENANT,
    '--client-id',
    'rp',
    '--public',
    '--redirect-uri',
    redirectUri,
  ]);
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

test('a sign-in lands on a client served from another origin', async ({ page }) => {
  const password = randomBytes(18).toString('base64url');
  user('ada', password);
  await startAt(page);
  await signInWith(page, 'ada', password);
  await expectAtClient(page);
});

test('enrolling an authenticator takes one password and one code, then lands on the client', async ({
  page,
}) => {
  const password = randomBytes(18).toString('base64url');
  user('grace', password);
  psql(
    `insert into user_required_actions (tenant_id, subject_id, action) ` +
      `select t.id, u.subject_id, 'configure-totp' from users u join tenants t ` +
      `on t.id = u.tenant_id where t.name = ${sqlText(TENANT)} and u.username = 'grace'`,
  );
  await startAt(page);
  await signInWith(page, 'grace', password);

  await expect(
    page.getByRole('heading', { level: 1, name: 'Set up your authenticator' }),
  ).toBeVisible();
  const secret = await page.locator('input[name="secret"]').inputValue();
  await page.getByLabel('Code from your app').fill(totp(secret));
  await page.getByRole('button', { name: 'Confirm' }).click();

  await expect(
    page.getByRole('heading', { level: 1, name: 'Save your recovery codes' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'I have saved these codes' }).click();
  await expectAtClient(page);
});
