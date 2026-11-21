// Runs the script against a stack provisioned by ../_shared/provision.sh. The
// script asks a person to sign in at a printed address; the test is that
// person, in a real browser. It then checks what the script printed, and that
// the client the script made is gone.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { createAdminClient, iterate } from '@odudu-io/admin-client';
import { createTokenSource } from '@odudu-io/oidc';
import { browse } from '../_shared/browser.ts';

const BASE = process.env.ODUDU_BASE ?? 'http://localhost:3000';
const ISSUER = `${BASE}/tenants/demo`;
const PASSWORD = 'a long and unremarkable passphrase';

const admin = createAdminClient({
  baseUrl: BASE,
  tenant: 'demo',
  token: createTokenSource(
    {
      issuer: ISSUER,
      clientId: 'example-admin',
      auth: { secret: 'example-admin-secret' },
      resource: 'urn:odudu:params:admin-api',
    },
    { allowInsecureRequests: true },
  ),
});
const DEADLINE_MS = 60_000;

async function signInAt(address: string): Promise<void> {
  await browse(async (page) => {
    await page.goto(address);
    await page.locator('input[name=username]').fill('ada');
    await page.locator('input[name=password]').fill(PASSWORD);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.locator('text=You can close this page').waitFor();
  });
}

// Runs the script, signs the person in when it prints the address, and returns
// what it printed once it has ended. The script is stopped however this ends,
// and a run that does not end in time fails with what it printed so far.
async function runScript(): Promise<string> {
  const script = spawn(process.execPath, ['admin.ts'], { env: process.env });
  let output = '';
  const address = new Promise<string>((resolve) => {
    script.stdout.on('data', (chunk) => {
      output += String(chunk);
      const found = /^Open (\S+) to sign in/mu.exec(output)?.[1];
      if (found !== undefined) resolve(found);
    });
  });
  script.stderr.on('data', (chunk) => (output += String(chunk)));
  const ended = new Promise<void>((resolve, reject) => {
    script.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`the script ended with ${String(code)}:\n${output}`));
    });
  });
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`the script did not end in time:\n${output}`)),
      DEADLINE_MS,
    );
  });
  try {
    await Promise.race([Promise.all([address.then(signInAt), ended]), deadline]);
    return output;
  } finally {
    clearTimeout(timer);
    script.kill();
  }
}

test(
  'creates a client, reads it back by listing, deletes it and reads the signed-in profile',
  { timeout: 90_000 },
  async () => {
    const output = await runScript();
    assert.match(output, /^created client example-admin-created$/mu);
    assert.match(output, /^listed \d+ clients, example-admin-created among them$/mu);
    assert.match(output, /^deleted client example-admin-created$/mu);
    assert.match(output, /^profile: ada$/mu);
  },
);

async function clientIds(): Promise<string[]> {
  const ids: string[] = [];
  for await (const client of iterate((page) =>
    admin.GET('/admin/tenants/{tenant}/clients', { params: { query: page } }),
  )) {
    ids.push(client.client_id);
  }
  return ids;
}

test(
  'removes a client an earlier run left behind, and leaves nothing behind itself',
  { timeout: 90_000 },
  async () => {
    await admin.POST('/admin/tenants/{tenant}/clients', {
      body: { client_id: 'example-admin-created', grant_types: ['client_credentials'] },
    });
    assert.ok((await clientIds()).includes('example-admin-created'));
    await runScript();
    const ids = await clientIds();
    assert.ok(ids.includes('example-admin'));
    assert.ok(!ids.includes('example-admin-created'));
  },
);
