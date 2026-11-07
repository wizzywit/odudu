// The MCP TypeScript SDK's own client against a tenant's endpoint, which the
// Inspector cannot show: the 401 challenge and the metadata read by hand, the
// SDK's OAuth (it follows the challenge's scope), the wire refusal of a write
// tool by a read token, each protocol era's negotiated revision, and what an
// older 2025-06-18 request is answered. signin.mjs is the person at the browser.
// usage: node sdk.mjs <tenant-url> <username> <password>
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { signIn } from './signin.mjs';

const [tenantUrl, username, password] = process.argv.slice(2);
const { origin } = new URL(tenantUrl);
const tenantPath = new URL(tenantUrl).pathname;
const mcpUrl = `${tenantUrl}/mcp`;
const EXPECT_READ_TOOLS = Number(process.env.EXPECT_READ_TOOLS);
const results = [];

function fail(message) {
  console.error(`sdk: ${message}`);
  process.exit(1);
}
function check(condition, message) {
  if (!condition) fail(message);
}

// 1. The 401 challenge and the documents it points at, read as a client would.
const unauthenticated = await fetch(mcpUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
});
check(unauthenticated.status === 401, `no token: ${unauthenticated.status}, not 401`);
const challenge = unauthenticated.headers.get('www-authenticate') ?? '';
const metadataUrl = /^Bearer resource_metadata="([^"]+)", scope="mcp:read"$/u.exec(challenge)?.[1];
check(metadataUrl !== undefined, `the challenge has the wrong form: ${challenge}`);
check(
  metadataUrl === `${origin}/.well-known/oauth-protected-resource${tenantPath}/mcp`,
  `the challenge points at ${metadataUrl}`,
);
const resource = await (await fetch(metadataUrl)).json();
check(resource.resource === mcpUrl, `the protected resource is ${resource.resource}`);
check(
  resource.authorization_servers?.[0] === tenantUrl,
  'the first authorization server is not the tenant',
);
check(
  resource.bearer_methods_supported?.includes('header') === true,
  'the header method is not offered',
);
const server = await (
  await fetch(`${origin}/.well-known/oauth-authorization-server${tenantPath}`)
).json();
check(server.issuer === tenantUrl, `the AS metadata issuer is ${server.issuer}`);
check(
  server.code_challenge_methods_supported?.join() === 'S256',
  'PKCE methods are not S256 alone',
);
check(typeof server.registration_endpoint === 'string', 'no registration_endpoint');
check(
  server.token_endpoint_auth_methods_supported?.includes('none') === true,
  'no public client method',
);
results.push(`challenge: 401 ${challenge}`);
const get = await fetch(mcpUrl);
check(get.status === 405 && get.headers.get('allow') === 'POST', `GET answered ${get.status}`);

// 2. The SDK's OAuth: it registers itself (DCR under the mcp policy), builds
// the authorization URL, and the person approves. Tokens are kept in memory.
let clientInformation;
let tokens;
let verifier;
let authorizationUrl;
let discovery;
const provider = {
  redirectUrl: 'http://127.0.0.1:6277/callback',
  clientMetadata: {
    client_name: 'sdk conformance client',
    redirect_uris: ['http://127.0.0.1:6277/callback'],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  },
  clientInformation: () => clientInformation,
  saveClientInformation: (info) => {
    clientInformation = info;
  },
  tokens: () => tokens,
  saveTokens: (saved) => {
    tokens = saved;
  },
  redirectToAuthorization: (url) => {
    authorizationUrl = url;
  },
  saveCodeVerifier: (value) => {
    verifier = value;
  },
  codeVerifier: () => verifier,
  saveDiscoveryState: (state) => {
    discovery = state;
  },
  discoveryState: () => discovery,
};

function transportFor(extra = {}) {
  return new StreamableHTTPClientTransport(new URL(mcpUrl), { authProvider: provider, ...extra });
}

async function authorize() {
  const transport = transportFor();
  const probe = new Client({ name: 'sdk-oauth', version: '1' });
  try {
    await probe.connect(transport);
    fail('the SDK connected without a token');
  } catch (error) {
    check(authorizationUrl !== undefined, `the SDK did not reach the sign-in: ${error}`);
  }
  const sent = authorizationUrl.searchParams;
  check(sent.get('code_challenge_method') === 'S256', 'no PKCE S256');
  check(sent.get('resource') === mcpUrl, `resource was ${sent.get('resource')}`);
  check(
    sent.get('scope')?.split(' ').includes('mcp:read') === true,
    `scope was ${sent.get('scope')}`,
  );
  const location = await signIn(authorizationUrl.href, username, password, ['mcp:read']);
  const callback = new URL(location);
  check(callback.searchParams.get('iss') === tenantUrl, 'the redirect carried no matching iss');
  await transport.finishAuth(callback.searchParams);
  check(typeof tokens?.access_token === 'string', 'the token exchange saved no access token');
  check(typeof clientInformation?.client_id === 'string', 'no client was registered');
  results.push(
    `oauth: registered ${clientInformation.client_id}, scope "${sent.get('scope')}", token ${tokens.token_type}`,
  );
}
await authorize();

// 3. Each era, tools, a read, a refused write.
const eras = [
  ['2025 initialize, no sessions', 'legacy'],
  ['2026-07-28 server/discover', { pin: '2026-07-28' }],
  ['auto-negotiated', 'auto'],
];
for (const [label, mode] of eras) {
  const client = new Client({ name: 'sdk-era', version: '1' }, { versionNegotiation: { mode } });
  await client.connect(transportFor());
  const version = client.getNegotiatedProtocolVersion();
  const era = client.getProtocolEra();
  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name);
  check(
    names.length === EXPECT_READ_TOOLS,
    `${label}: ${names.length} tools, not ${EXPECT_READ_TOOLS}`,
  );
  check(
    !names.some((name) => /^(create|update|set|clear)_/u.test(name)),
    `${label}: a write tool was listed`,
  );

  const who = await client.callTool({ name: 'whoami', arguments: {} });
  check(
    who.isError !== true && typeof who.structuredContent?.data?.subjectId === 'string',
    `${label}: whoami failed`,
  );
  const clients = await client.callTool({ name: 'list_clients', arguments: {} });
  check(clients.isError !== true, `${label}: list_clients failed`);
  const ours = clients.structuredContent?.data?.find(
    (row) => row.client_id === clientInformation.client_id,
  );
  check(ours !== undefined, `${label}: list_clients does not list the registered client`);

  // The write is by name, with arguments the tool accepts, so only the
  // token's scope can be what refuses it.
  const written = await client.callTool({
    name: 'update_client_metadata',
    arguments: { id: ours.id, if_match: `"${'0'.repeat(64)}"`, name: 'renamed by a read token' },
  });
  const refused =
    written.structuredContent?.error ?? JSON.parse(written.content?.[0]?.text ?? '{}').error;
  check(
    written.isError === true &&
      refused?.type === 'mcp:insufficient_scope' &&
      refused?.status === 403,
    `${label}: a read token's write call was answered ${JSON.stringify(written).slice(0, 200)}`,
  );
  const after = (await client.callTool({ name: 'get_client', arguments: { id: ours.id } }))
    .structuredContent?.data;
  check(after?.name === ours.name, `${label}: the client's name changed to ${after?.name}`);
  const refusal = `${refused.type}, ${refused.status}`;
  results.push(
    `${label}: negotiated ${version} (${era}), ${names.length} tools, whoami and list_clients ok, write refused (${refusal})`,
  );
  await client.close();
}

// 4. What an older revision is answered. The SDK's own client only names
// 2025-11-25 and 2026-07-28, so 2025-06-18 is sent by hand.
async function raw(version, body, extraHeaders = {}) {
  const response = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${tokens.access_token}`,
      'mcp-protocol-version': version,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    text: (await response.text()).replace(/^event: message\ndata: /u, '').trim(),
  };
}
for (const version of ['2025-06-18', '2025-03-26']) {
  const answer = await raw(version, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: version,
      capabilities: {},
      clientInfo: { name: 'raw', version: '1' },
    },
  });
  const negotiated = /"protocolVersion":"([^"]+)"/u.exec(answer.text)?.[1];
  results.push(
    `initialize asking for ${version}: HTTP ${answer.status}, ${negotiated === undefined ? answer.text.slice(0, 160) : `server answered ${negotiated}`}`,
  );
  // An older revision is served as the one asked for.
  check(answer.status === 200, `${version}: initialize answered HTTP ${answer.status}`);
  check(negotiated === version, `${version}: the server answered ${negotiated} to it`);
  const listed = await raw(version, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  check(listed.status === 200, `${version}: tools/list answered HTTP ${listed.status}`);
  let tools;
  try {
    tools = JSON.parse(listed.text).result?.tools;
  } catch {
    tools = undefined;
  }
  check(
    Array.isArray(tools) && tools.length === EXPECT_READ_TOOLS,
    `${version}: tools/list gave ${Array.isArray(tools) ? tools.length : listed.text.slice(0, 160)} tools, not ${EXPECT_READ_TOOLS}`,
  );
  results.push(
    `tools/list under mcp-protocol-version ${version}: HTTP ${listed.status}, ${tools.length} tools`,
  );
}

console.log(results.join('\n'));
