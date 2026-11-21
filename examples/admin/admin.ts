// Two clients of Odudu in one script. The admin client acts as a service: it
// makes a client, finds it in the tenant's list and deletes it. The me client
// acts as a person: they sign in at a loopback address, the way a command-line
// tool does (RFC 8252), and the script reads their own profile with the token.
// `allowInsecureRequests` lets the SDKs talk to an http issuer; never set it in
// production.
import { createServer, type Server } from 'node:http';
import { createAdminClient, iterate } from '@odudu-io/admin-client';
import { createMeClient } from '@odudu-io/me-client';
import { beginSignIn, completeSignIn, createTokenSource } from '@odudu-io/oidc';

const BASE = process.env.ODUDU_BASE ?? 'http://localhost:3000';
const TENANT = process.env.TENANT ?? 'demo';
const ISSUER = `${BASE}/tenants/${TENANT}`;
const deps = { allowInsecureRequests: true };

// The service signs in as itself. The admin API is its own audience, and what
// the service may do there is the admin capabilities its account holds.
const admin = createAdminClient({
  baseUrl: BASE,
  tenant: TENANT,
  token: createTokenSource(
    {
      issuer: ISSUER,
      clientId: 'example-admin',
      // A published value for the local example stack; never reuse it anywhere real.
      auth: { secret: process.env.CLIENT_SECRET ?? 'example-admin-secret' },
      resource: 'urn:odudu:params:admin-api',
    },
    deps,
  ),
});

// A run that was stopped before its last step may have left its client behind.
for await (const client of iterate((page) =>
  admin.GET('/admin/tenants/{tenant}/clients', { params: { query: page } }),
)) {
  if (client.client_id === 'example-admin-created') {
    await admin.DELETE('/admin/tenants/{tenant}/clients/{id}', {
      params: { path: { id: client.id } },
    });
  }
}

const created = await admin.POST('/admin/tenants/{tenant}/clients', {
  body: {
    client_id: 'example-admin-created',
    name: 'Made by the admin example',
    grant_types: ['client_credentials'],
  },
});
try {
  console.log(`created client ${created.data.client_id}`);
  let count = 0;
  let found = false;
  for await (const client of iterate((page) =>
    admin.GET('/admin/tenants/{tenant}/clients', { params: { query: page } }),
  )) {
    count += 1;
    found ||= client.id === created.data.id;
  }
  if (!found) throw new Error('the new client is not in the list');
  console.log(`listed ${count} clients, ${created.data.client_id} among them`);
} finally {
  await admin.DELETE('/admin/tenants/{tenant}/clients/{id}', {
    params: { path: { id: created.data.id } },
  });
  console.log(`deleted client ${created.data.client_id}`);
}

// The person signs in at the address the script prints, and Odudu sends their
// browser back to a listener that lives for this one sign-in. It answers only
// the callback path, so a browser's request for an icon does not use it up.
const REDIRECT = 'http://127.0.0.1:8086/callback';
const WAIT_MS = 120_000;

function waitForCallback(): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  let listener: Server | undefined;
  return new Promise<string>((resolve, reject) => {
    listener = createServer((request, response) => {
      const url = new URL(request.url ?? '/', REDIRECT);
      if (url.pathname !== new URL(REDIRECT).pathname) {
        response.writeHead(404).end();
        return;
      }
      response.end('Signed in. You can close this page.');
      resolve(url.href);
    });
    listener.on('error', (error) => {
      reject(new Error(`cannot listen on ${REDIRECT}: ${error.message}`));
    });
    timer = setTimeout(() => {
      reject(new Error(`nobody signed in within ${String(WAIT_MS / 1000)} seconds`));
    }, WAIT_MS);
    listener.listen(8086, '127.0.0.1');
  }).finally(() => {
    clearTimeout(timer);
    listener?.close();
  });
}

try {
  const { url, pending } = await beginSignIn(
    {
      issuer: ISSUER,
      clientId: 'example-admin-cli',
      redirectUri: REDIRECT,
      scope: 'openid',
      meAccess: 'read',
    },
    deps,
  );
  console.log(`Open ${url} to sign in.`);
  const tokens = await completeSignIn(await waitForCallback(), pending, {}, deps);
  // The access token for the me API is filed under the me audience.
  const meToken = tokens.byAudience[`${ISSUER}/me`]?.accessToken;
  if (meToken === undefined) throw new Error('no token for the me API came back');

  const me = createMeClient({ baseUrl: BASE, tenant: TENANT, token: meToken });
  const profile = await me.GET('/tenants/{tenant}/me/profile');
  console.log(`profile: ${profile.data.username}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
