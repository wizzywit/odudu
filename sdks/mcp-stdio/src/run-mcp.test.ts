import { createPublicKey, verify } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createCredentialStore } from '#/adapter/credential-store';
import type { McpIo } from '#/services/mcp-io';
import { generateClientKey, loadClientKey } from '#/services/client-key';
import { ADMIN_API_AUDIENCE } from '#/services/scopes';
import { runMcp } from '#/run-mcp';

const BASE = 'https://id.example.com';
const ISSUER = `${BASE}/tenants/acme`;
const TOKEN_ENDPOINT = `${ISSUER}/protocol/openid-connect/token`;

const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const accessToken = (scope: string) =>
  `${part({ alg: 'none' })}.${part({ iss: ISSUER, aud: [ADMIN_API_AUDIENCE, ISSUER], scope })}.`;

function authority() {
  const forms: Record<string, string>[] = [];
  const reply = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  const stub: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === `${BASE}/.well-known/oauth-authorization-server/tenants/acme`) {
      return Promise.resolve(
        reply({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`,
          token_endpoint: TOKEN_ENDPOINT,
          authorization_response_iss_parameter_supported: true,
          code_challenge_methods_supported: ['S256'],
        }),
      );
    }
    if (url === TOKEN_ENDPOINT) {
      const form = Object.fromEntries(
        new URLSearchParams(typeof init?.body === 'string' ? init.body : ''),
      );
      forms.push(form);
      return Promise.resolve(
        reply({
          access_token: accessToken(form.scope ?? 'mcp:read'),
          token_type: 'Bearer',
          expires_in: 300,
        }),
      );
    }
    if (url === `${BASE}/admin/tenants/acme/whoami`) {
      return Promise.resolve(
        reply({
          subjectId: 's1',
          issuerTenantId: 't1',
          issuerTenantName: 'acme',
          capabilities: [],
          crossTenant: false,
          assistant_available: false,
        }),
      );
    }
    return Promise.resolve(new Response('nope', { status: 404 }));
  };
  return { forms, fetch: stub };
}

const SESSION = [
  {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 't', version: '1' },
    },
  },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'whoami', arguments: {} } },
];

interface Run {
  code: number;
  stdout: string;
  stderr: string[];
}

async function run(
  argv: string[],
  options: {
    env?: Record<string, string>;
    input?: unknown[];
    fetch?: typeof fetch;
    configDir?: string;
    command?: string;
  } = {},
): Promise<Run> {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let out = '';
  stdout.setEncoding('utf8').on('data', (chunk: string) => (out += chunk));
  const stderr: string[] = [];
  const configDir =
    options.configDir ?? join(await mkdtemp(join(tmpdir(), 'odudu-config-')), 'odudu', 'mcp');
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  const io: McpIo = {
    stdin,
    stdout,
    stderr: (line) => stderr.push(line),
    env: options.env ?? {},
    platform: 'linux',
    configDir,
    run: () => Promise.resolve({ kind: 'missing' }),
    fetch: options.fetch ?? authority().fetch,
    now: () => new Date(),
    entropy: (bytes) => Uint8Array.from({ length: bytes }, (_, i) => (i * 7 + 3) % 251),
    ...(options.command === undefined ? {} : { command: options.command }),
  };
  const done = runMcp(io, argv);
  const input = options.input ?? [];
  for (const message of input) stdin.write(`${JSON.stringify(message)}\n`);
  const wanted = input.filter((m) => typeof m === 'object' && m !== null && 'id' in m).length;
  for (let i = 0; i < 400 && out.split('\n').filter(Boolean).length < wanted; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  stdin.end();
  return { code: await done, stdout: out, stderr };
}

const KEY_ARGS = ['--base-url', BASE, '--tenant', 'acme', '--client-id', 'svc'];

describe('the odudu-mcp command: what it needs to start', () => {
  it.each([
    [['--tenant', 'acme'], /--base-url/u],
    [['--base-url', BASE], /--tenant/u],
    [
      ['--base-url', BASE, '--tenant', 'acme', '--read-only', '--allow-writes'],
      /--read-only.*--allow-writes/u,
    ],
    [['--base-url', BASE, '--tenant', 'acme', '--nonsense'], /--nonsense/u],
    [['--base-url', BASE, '--tenant', 'acme', 'extra'], /unexpected argument "extra"/u],
    [['--base-url', 'http://id.example.com', '--tenant', 'acme'], /https/u],
  ])(
    'refuses %j with one line on standard error and nothing on standard output',
    async (argv, message) => {
      const r = await run(argv);
      expect(r.code).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).toHaveLength(1);
      expect(r.stderr[0]).toMatch(message);
    },
  );

  it('names what to set when a client id has no key, and the other way round, showing no value', async () => {
    const noKey = await run(KEY_ARGS);
    expect(noKey.stderr[0]).toContain('ODUDU_MCP_KEY');
    expect(noKey.stderr[0]).toContain('--key-file');
    const key = generateClientKey();
    const noId = await run(['--base-url', BASE, '--tenant', 'acme'], {
      env: { ODUDU_MCP_KEY: key },
    });
    expect(noId.code).toBe(1);
    expect(noId.stderr[0]).toContain('ODUDU_MCP_CLIENT_ID');
    expect(noId.stderr[0]).not.toContain(key);
  });

  it('refuses a key that is not a key, without printing it', async () => {
    const r = await run(KEY_ARGS, { env: { ODUDU_MCP_KEY: 'SECRET-not-a-key' } });
    expect(r.code).toBe(1);
    expect(r.stderr).toHaveLength(1);
    expect(r.stderr[0]).not.toContain('SECRET');
  });

  it('names the command the caller runs, in its failure line and in what it tells you to type', async () => {
    const bad = { env: { ODUDU_MCP_KEY: 'not-a-key' } };
    const server = await run(KEY_ARGS, { ...bad, command: 'odudu mcp' });
    expect(server.stderr[0]).toMatch(/^odudu mcp: .*odudu mcp --keygen/u);
    const bin = await run(KEY_ARGS, { ...bad, command: 'odudu-mcp' });
    expect(bin.stderr[0]).toMatch(/^odudu-mcp: .*odudu-mcp --keygen/u);
    expect(bin.stderr[0]).not.toContain('odudu mcp');
    expect((await run(KEY_ARGS, bad)).stderr[0]).toMatch(/^odudu mcp: /u);
  });

  it('refuses a key in both the environment and a file, and a file others can read', async () => {
    const key = generateClientKey();
    const dir = await mkdtemp(join(tmpdir(), 'odudu-key-'));
    const file = join(dir, 'k');
    await writeFile(file, key, { mode: 0o600 });
    const both = await run([...KEY_ARGS, '--key-file', file], { env: { ODUDU_MCP_KEY: key } });
    expect(both.stderr[0]).toMatch(/only one/u);
    await chmod(file, 0o644);
    const open = await run([...KEY_ARGS, '--key-file', file]);
    expect(open.code).toBe(1);
    expect(open.stderr).toHaveLength(1);
    expect(open.stderr[0]).toContain(file);
    expect(open.stderr[0]).toMatch(/group or others/u);
    expect(open.stderr[0]).not.toContain(key);
  });
});

describe('the odudu-mcp command with a service account key', () => {
  it('signs in with a private_key_jwt for the token endpoint, and serves the tools', async () => {
    const key = generateClientKey();
    const a = authority();
    const r = await run(KEY_ARGS, { env: { ODUDU_MCP_KEY: key }, input: SESSION, fetch: a.fetch });
    expect(r.code).toBe(0);
    expect(r.stderr).toEqual([]);
    const lines = r.stdout.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(r.stdout).toContain('"subjectId":"s1"');
    for (const line of lines) expect((JSON.parse(line) as { jsonrpc: string }).jsonrpc).toBe('2.0');
    expect(a.forms).toHaveLength(1);
    const form = a.forms[0] ?? {};
    expect(form).toMatchObject({
      grant_type: 'client_credentials',
      client_id: 'svc',
      scope: 'mcp:read',
      resource: ADMIN_API_AUDIENCE,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    });
    const [header, payload, signature] = (form.client_assertion ?? '').split('.');
    const claims = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString()) as Record<
      string,
      unknown
    >;
    const loaded = loadClientKey(key);
    expect(JSON.parse(Buffer.from(header ?? '', 'base64url').toString())).toEqual({
      alg: 'ES256',
      kid: loaded.kid,
    });
    expect(claims).toMatchObject({ iss: 'svc', sub: 'svc', aud: TOKEN_ENDPOINT });
    expect(Number(claims.exp) - Number(claims.iat)).toBeLessThanOrEqual(300);
    expect(typeof claims.jti).toBe('string');
    const signed = verify(
      'sha256',
      Buffer.from(`${header ?? ''}.${payload ?? ''}`),
      { key: createPublicKey({ key: loaded.publicJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature ?? '', 'base64url'),
    );
    expect(signed).toBe(true);
  });
});

describe('the odudu-mcp command --keygen and --logout', () => {
  it('prints a key line for the environment and the public key set to register, never the private key', async () => {
    const r = await run(['--keygen']);
    expect(r.code).toBe(0);
    const line = r.stdout.trim();
    expect(line.split('\n')).toHaveLength(1);
    expect(line).toMatch(/^ODUDU_MCP_KEY=[A-Za-z0-9+/=]+$/u);
    const key = loadClientKey(line.slice('ODUDU_MCP_KEY='.length));
    const registered = JSON.parse(r.stderr.join('\n')) as { keys: Record<string, unknown>[] };
    expect(registered.keys).toEqual([key.publicJwk]);
    expect(registered.keys[0]).not.toHaveProperty('d');
  });

  it('forgets the stored sign-in without calling the network, and prints nothing on standard output', async () => {
    const configDir = join(await mkdtemp(join(tmpdir(), 'odudu-config-')), 'odudu', 'mcp');
    await mkdir(configDir, { recursive: true, mode: 0o700 });
    await createCredentialStore({
      account: ISSUER,
      directory: configDir,
      platform: 'linux',
      run: () => Promise.resolve({ kind: 'missing' }),
      warn: () => undefined,
    }).put('rt-acme');
    const r = await run(['--base-url', BASE, '--tenant', 'acme', '--logout'], {
      configDir,
      fetch: () => Promise.reject(new Error('no network')),
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toEqual([`odudu mcp: signed out of ${ISSUER}`]);
    expect(await readdir(configDir)).toHaveLength(0);
  });

  it('says it was run as odudu-mcp when the caller says so', async () => {
    const configDir = join(await mkdtemp(join(tmpdir(), 'odudu-config-')), 'odudu', 'mcp');
    await mkdir(configDir, { recursive: true, mode: 0o700 });
    await createCredentialStore({
      account: ISSUER,
      directory: configDir,
      platform: 'linux',
      run: () => Promise.resolve({ kind: 'missing' }),
      warn: () => undefined,
    }).put('rt-acme');
    const r = await run(['--base-url', BASE, '--tenant', 'acme', '--logout'], {
      configDir,
      fetch: () => Promise.reject(new Error('no network')),
      command: 'odudu-mcp',
    });
    expect(r.stderr).toEqual([`odudu-mcp: signed out of ${ISSUER}`]);
  });
});
