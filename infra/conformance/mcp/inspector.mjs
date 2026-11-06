// The MCP Inspector's own CLI against a tenant's endpoint: it discovers the
// sign-in, registers itself, runs the authorization code flow with PKCE and
// the `resource` parameter, then lists and calls tools in each protocol era.
// The Inspector prints the authorization URL instead of opening a browser
// when it cannot; signin.mjs is the person who follows it.
// usage: node inspector.mjs <inspector-bin> <work-dir> <tenant-url> <username> <password>
import { spawn } from 'node:child_process';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { signIn } from './signin.mjs';

const [bin, work, tenantUrl, username, password] = process.argv.slice(2);
const CALLBACK = 'http://127.0.0.1:6276/oauth/callback';
const mcpUrl = `${tenantUrl}/mcp`;

await mkdir(join(work, 'fakebin'), { recursive: true });
for (const name of ['open', 'xdg-open']) {
  const file = join(work, 'fakebin', name);
  await writeFile(file, '#!/bin/sh\nexit 0\n');
  await chmod(file, 0o755);
}
const config = join(work, 'inspector-config.json');
await writeFile(
  config,
  JSON.stringify({
    mcpServers: {
      odudu: { type: 'streamable-http', url: mcpUrl },
    },
  }),
);

const env = {
  ...process.env,
  HOME: join(work, 'home'),
  PATH: `${join(work, 'fakebin')}:${process.env.PATH}`,
  MCP_AUTO_OPEN_ENABLED: 'true',
  MCP_INSPECTOR_SECRET_STORE: 'file',
  NO_COLOR: '1',
};
await mkdir(env.HOME, { recursive: true });

// Runs the CLI; `onStderr` may react to what it prints while it waits.
function inspect(args, onStderr) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        bin,
        '--cli',
        '--config',
        config,
        '--server',
        'odudu',
        '--callback-url',
        CALLBACK,
        '--format',
        'json',
        ...args,
      ],
      { env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      onStderr?.(stderr);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function fail(message, run) {
  console.error(`inspector: ${message}`);
  if (run) console.error(`exit ${run.code}\n${run.stdout}\n${run.stderr}`);
  process.exit(1);
}

function parsed(run, what) {
  if (run.code !== 0) fail(`${what} exited ${run.code}`, run);
  try {
    const { result } = JSON.parse(run.stdout);
    if (result !== undefined) return result;
  } catch {
    // reported below
  }
  return fail(`${what} printed no result`, run);
}

// First connect: no stored token, so the CLI starts its own OAuth flow.
let approving;
let authorizeUrl;
const first = await inspect(['--protocol-era', 'modern', '--method', 'tools/list'], (stderr) => {
  const found = /Please navigate to: (\S+)/u.exec(stderr);
  if (found === null || approving !== undefined) return;
  authorizeUrl = found[1];
  approving = signIn(authorizeUrl, username, password, ['mcp:read']).then(async (location) => {
    const callback = await fetch(location, { redirect: 'manual' });
    if (callback.status !== 200)
      throw new Error(`the Inspector's callback answered ${callback.status}`);
  });
  approving.catch((error) => fail(error.message));
});
if (authorizeUrl === undefined) fail('the Inspector never asked to sign in', first);
await approving;
const authorize = new URL(authorizeUrl);
const sent = authorize.searchParams;
if (sent.get('code_challenge_method') !== 'S256') fail('the Inspector did not use PKCE S256');
if (sent.get('resource') !== mcpUrl) fail(`the Inspector's resource was ${sent.get('resource')}`);
if (sent.get('redirect_uri') !== CALLBACK) fail('the Inspector used another redirect_uri');
if (sent.get('scope')?.split(' ').includes('mcp:read') !== true)
  fail('the Inspector did not ask for mcp:read');
const listed = parsed(first, 'the first tools/list').tools;
const names = listed.map((tool) => tool.name);

const results = [];
function record(era, what) {
  results.push(`inspector ${era}: ${what}`);
}

const EXPECT_READ_TOOLS = Number(process.env.EXPECT_READ_TOOLS);
if (names.length !== EXPECT_READ_TOOLS)
  fail(`tools/list gave ${names.length} tools, not ${EXPECT_READ_TOOLS}`);
if (names.includes('update_client_metadata')) fail('a read token was offered a write tool');
record('modern', `signed in (scope ${sent.get('scope')}), tools/list ${names.length} tools`);

for (const era of ['modern', 'legacy', 'auto']) {
  const stored = ['--stored-auth-only', '--protocol-era', era];
  const list = parsed(await inspect([...stored, '--method', 'tools/list']), `${era} tools/list`);
  if (list.tools.length !== EXPECT_READ_TOOLS)
    fail(`${era} tools/list gave ${list.tools.length} tools`);

  const who = parsed(
    await inspect([...stored, '--method', 'tools/call', '--tool-name', 'whoami']),
    `${era} whoami`,
  );
  if (who.isError === true)
    fail(`${era} whoami is an error`, { code: 0, stdout: JSON.stringify(who), stderr: '' });
  const data = who.structuredContent?.data;
  if (typeof data?.subjectId !== 'string' || data.crossTenant !== false)
    fail(`${era} whoami: ${JSON.stringify(who)}`);

  const clients = parsed(
    await inspect([...stored, '--method', 'tools/call', '--tool-name', 'list_clients']),
    `${era} list_clients`,
  );
  if (clients.isError === true)
    fail(`${era} list_clients is an error`, {
      code: 0,
      stdout: JSON.stringify(clients),
      stderr: '',
    });
  record(era, `tools/list ${list.tools.length}, whoami ${data.subjectId}, list_clients ok`);
}

// A write tool is not in a read token's list, and the Inspector checks the
// list before calling, so it refuses by name on its own side.
const write = await inspect([
  '--stored-auth-only',
  '--protocol-era',
  'modern',
  '--method',
  'tools/call',
  '--tool-name',
  'update_client_metadata',
  '--tool-arg',
  'client_id=x',
]);
if (write.code === 0) fail('the Inspector called a write tool with a read token', write);
record(
  'modern',
  `update_client_metadata refused by the client's own list check (exit ${write.code})`,
);

console.log(results.join('\n'));
