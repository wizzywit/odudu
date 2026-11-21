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

// Runs the script, signs the person in when it prints the address, and
// returns what it printed once it has ended.
function runScript(): Promise<string> {
  return new Promise((resolve, reject) => {
    const script = spawn(process.execPath, ['admin.ts'], { env: process.env });
    let output = '';
    let signedIn = false;
    script.stderr.on('data', (chunk) => (output += String(chunk)));
    script.stdout.on('data', (chunk) => {
      output += String(chunk);
      const address = /^Open (\S+) to sign in/mu.exec(output)?.[1];
      if (address === undefined || signedIn) return;
      signedIn = true;
      browse(async (page) => {
        await page.goto(address);
        await page.locator('input[name=username]').fill('ada');
        await page.locator('input[name=password]').fill(PASSWORD);
        await page.getByRole('button', { name: /^sign in$/i }).click();
        await page.locator('text=You can close this page').waitFor();
      }).catch(reject);
    });
    script.on('close', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`the script ended with ${String(code)}:\n${output}`));
    });
  });
}

test('creates a client, reads it back by listing, deletes it and reads the signed-in profile', async () => {
  const output = await runScript();
  assert.match(output, /^created client example-admin-created$/mu);
  assert.match(output, /^listed \d+ clients, example-admin-created among them$/mu);
  assert.match(output, /^deleted client example-admin-created$/mu);
  assert.match(output, /^profile: ada$/mu);
});

test('leaves nothing behind, so the script can run again', async () => {
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
  const ids: string[] = [];
  for await (const client of iterate((page) =>
    admin.GET('/admin/tenants/{tenant}/clients', { params: { query: page } }),
  )) {
    ids.push(client.client_id);
  }
  assert.ok(ids.includes('example-admin'));
  assert.ok(!ids.includes('example-admin-created'));
});
