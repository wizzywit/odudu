// Gives the service account a key of the test's own, runs the client against a
// stack provisioned by ../_shared/provision.sh and checks what it printed.
// The key is made here, kept in memory and handed to the client in its
// environment; only its public half is registered with Odudu.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { before, test } from 'node:test';
import { createAdminClient, iterate } from '@odudu-io/admin-client';
import { createTokenSource } from '@odudu-io/oidc';

const BASE = process.env.ODUDU_BASE ?? 'http://localhost:3000';
let key = '';

before(async () => {
  // The line to keep goes to standard output, the key set to register to standard error.
  const made = spawnSync('npx', ['odudu-mcp', '--keygen'], { encoding: 'utf8' });
  key = /^ODUDU_MCP_KEY=(\S+)$/mu.exec(made.stdout)?.[1] ?? '';
  const jwks: unknown = JSON.parse(/\{.*\}/u.exec(made.stderr)?.[0] ?? 'null');
  assert.ok(key !== '' && jwks !== null, 'odudu-mcp --keygen printed no key');

  const admin = createAdminClient({
    baseUrl: BASE,
    tenant: 'demo',
    token: createTokenSource(
      {
        issuer: `${BASE}/tenants/demo`,
        clientId: 'example-admin',
        auth: { secret: 'example-admin-secret' },
        resource: 'urn:odudu:params:admin-api',
      },
      { allowInsecureRequests: true },
    ),
  });
  for await (const client of iterate((page) =>
    admin.GET('/admin/tenants/{tenant}/clients', { params: { query: page } }),
  )) {
    if (client.client_id !== 'example-mcp') continue;
    await admin.PATCH('/admin/tenants/{tenant}/clients/{id}', {
      params: { path: { id: client.id } },
      body: { token_endpoint_auth_method: 'private_key_jwt', jwks },
    });
    return;
  }
  throw new Error('the client example-mcp is not provisioned');
});

function runClient(env: Record<string, string>) {
  return spawnSync(process.execPath, ['client.ts'], {
    env: { ...process.env, ODUDU_MCP_KEY: '', ...env },
    encoding: 'utf8',
  });
}

test('lists the tools and calls list_clients as the service account', () => {
  const run = runClient({ ODUDU_MCP_KEY: key });
  assert.equal(run.status, 0, run.stderr);
  const tools = /^tools: (.*)$/mu.exec(run.stdout)?.[1]?.split(' ') ?? [];
  assert.ok(tools.includes('list_clients'));
  const clients = /^list_clients: (.*)$/mu.exec(run.stdout)?.[1] ?? '';
  for (const clientId of ['example-mcp', 'example-web', 'odudu-admin']) {
    assert.match(clients, new RegExp(`"client_id":"${clientId}"`, 'u'));
  }
});

test('stops with one line when it has no key', () => {
  const run = runClient({});
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /ODUDU_MCP_KEY/u);
});
