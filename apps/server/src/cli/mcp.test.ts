import { generateClientKey, loadClientKey, verifyJwtAgainstJwkSet } from '@odudu/crypto';
import { MCP_CLIENT_ID, ADMIN_API_AUDIENCE } from '@odudu/domain-tenant';
import { TOOLS, type RunTool } from '@odudu/mcp';
import { chmod, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { McpIo } from '#/cli/mcp';
import {
  byId,
  INITIALIZE,
  INITIALIZED,
  privateConfigDirectory,
  runMcp,
  SESSION,
  toolNames,
  type Run,
} from '#/testing/mcp-session';

const BASE = 'https://id.example.com';
const ISSUER = `${BASE}/tenants/acme`;
const TOKEN_ENDPOINT = `${ISSUER}/protocol/openid-connect/token`;
const AUTH_ENDPOINT = `${ISSUER}/protocol/openid-connect/auth`;
const NOTHING: RunTool = () => Promise.resolve({ kind: 'missing' });

const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
function accessToken(claims: Record<string, unknown>): string {
  return `${part({ alg: 'none' })}.${part({ iss: ISSUER, aud: [ADMIN_API_AUDIENCE, ISSUER], ...claims })}.`;
}

interface Seen {
  readonly url: string;
  readonly init: RequestInit;
}

interface Authority {
  issuer: string;
  tokenIssuer: string;
  refreshTokens: boolean;
  readonly seen: Seen[];
  readonly tokenForms: Record<string, string>[];
}

function authority(
  over: Partial<Pick<Authority, 'issuer' | 'tokenIssuer' | 'refreshTokens'>> = {},
) {
  const state: Authority = {
    issuer: ISSUER,
    tokenIssuer: ISSUER,
    refreshTokens: false,
    seen: [],
    tokenForms: [],
    ...over,
  };
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  const stub: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    state.seen.push({ url, init: init ?? {} });
    if (url === `${BASE}/.well-known/oauth-authorization-server/tenants/acme`) {
      return Promise.resolve(
        reply({
          issuer: state.issuer,
          authorization_endpoint: AUTH_ENDPOINT,
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
      state.tokenForms.push(form);
      const scope = form.scope ?? 'mcp:read';
      const withRefresh = state.refreshTokens && !scope.includes('mcp:write');
      return Promise.resolve(
        reply({
          access_token: accessToken({
            iss: state.tokenIssuer,
            scope,
            jti: String(state.tokenForms.length),
          }),
          token_type: 'Bearer',
          expires_in: 300,
          scope,
          ...(withRefresh ? { refresh_token: `rt-${String(state.tokenForms.length)}` } : {}),
        }),
      );
    }
    if (url.startsWith(`${BASE}/admin/tenants/acme/`)) {
      return Promise.resolve(
        reply({
          subjectId: 's1',
          issuerTenantId: 't1',
          issuerTenantName: 'acme',
          capabilities: ['view-users'],
          crossTenant: false,
        }),
      );
    }
    return Promise.resolve(new Response('nope', { status: 404 }));
  };
  return { ...state, state, fetch: stub };
}

let keyText: string;
beforeAll(async () => {
  keyText = await generateClientKey();
});

const run = (argv: string[], options: Parameters<typeof runMcp>[1] = {}): Promise<Run> =>
  runMcp(argv, { fetch: authority().fetch, ...options });

// What a tenant's own agent is offered: the two reads that span tenants are the
// system tenant's alone.
const TENANT_TOOLS = TOOLS.filter((t) => t.routeKey.includes(':tenant'));

const KEY_ARGS = ['--base-url', BASE, '--tenant', 'acme', '--client-id', 'svc'];

describe('odudu mcp: what it needs to start', () => {
  it.each([
    [['--tenant', 'acme'], /--base-url/u],
    [['--base-url', BASE], /--tenant/u],
    [
      ['--base-url', BASE, '--tenant', 'acme', '--read-only', '--allow-writes'],
      /--read-only.*--allow-writes/u,
    ],
    [['--base-url', BASE, '--tenant', 'acme', '--nonsense'], /--nonsense/u],
    [['--base-url', 'http://id.example.com', '--tenant', 'acme'], /https/u],
    [['--base-url', BASE, '--tenant', 'acme', 'stray'], /stray/u],
  ])(
    'refuses %j with one line on standard error and nothing on standard output',
    async (argv, pattern) => {
      const r = await run(argv, { env: { ODUDU_MCP_KEY: keyText } });
      expect(r.code).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).toHaveLength(1);
      expect(r.stderr[0]).toMatch(pattern);
      expect(r.stderr[0]).not.toContain('\n');
    },
  );

  it('names what to set when a client id has no key, without showing any value', async () => {
    const r = await run(KEY_ARGS);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toHaveLength(1);
    expect(r.stderr[0]).toContain('ODUDU_MCP_KEY');
    expect(r.stderr[0]).toContain('--key-file');
  });

  it('names what to set when a key has no client id', async () => {
    const r = await run(['--base-url', BASE, '--tenant', 'acme'], {
      env: { ODUDU_MCP_KEY: keyText },
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toHaveLength(1);
    expect(r.stderr[0]).toContain('--client-id');
    expect(r.stderr[0]).toContain('ODUDU_MCP_CLIENT_ID');
    expect(r.stderr[0]).not.toContain(keyText);
  });

  it('refuses a key that is not a key, without printing it', async () => {
    const r = await run(KEY_ARGS, { env: { ODUDU_MCP_KEY: 'SECRET-not-a-key' } });
    expect(r.code).toBe(1);
    expect(r.stderr).toHaveLength(1);
    expect(r.stderr[0]).not.toContain('SECRET');
  });

  it('refuses a key in both the environment and a file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'odudu-key-'));
    const file = join(dir, 'k');
    await writeFile(file, keyText, { mode: 0o600 });
    const r = await run([...KEY_ARGS, '--key-file', file], { env: { ODUDU_MCP_KEY: keyText } });
    expect(r.code).toBe(1);
    expect(r.stderr).toHaveLength(1);
    expect(r.stderr[0]).toMatch(/only one/u);
  });

  it('refuses a key file that group or others can read, with one line naming it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'odudu-key-'));
    const file = join(dir, 'k');
    await writeFile(file, keyText, { mode: 0o600 });
    await chmod(file, 0o644);
    const r = await run([...KEY_ARGS, '--key-file', file]);
    expect(r.code).toBe(1);
    expect(r.stderr).toHaveLength(1);
    expect(r.stderr[0]).toContain(file);
    expect(r.stderr[0]).toMatch(/group or others/u);
    expect(r.stderr[0]).not.toContain(keyText);
  });

  it('announces the tenant it was given, in the server info, the instructions and every description', async () => {
    const a = authority();
    const r = await run(['--base-url', BASE, '--tenant', 'beta', '--client-id', 'svc'], {
      env: { ODUDU_MCP_KEY: keyText },
      input: SESSION,
      fetch: a.fetch,
    });
    expect(r.code).toBe(0);
    expect(byId(r.lines, 1).result).toMatchObject({
      serverInfo: { name: 'odudu:beta', title: 'Odudu (beta)', version: '1.0.0' },
      instructions: expect.stringContaining('Odudu tenant "beta" only') as string,
    });
    const tools = (byId(r.lines, 2).result as { tools: { description: string }[] }).tools;
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) expect(tool.description.startsWith('[beta] ')).toBe(true);
  });

  it('reads the key from a file only the user can read', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'odudu-key-'));
    const file = join(dir, 'k');
    await writeFile(file, `${keyText}\n`, { mode: 0o600 });
    const r = await run([...KEY_ARGS, '--key-file', file], { input: SESSION });
    expect(r.code).toBe(0);
    expect(toolNames(r.lines).length).toBeGreaterThan(0);
  });
});

describe('odudu mcp with a service account key', () => {
  it('[MCP-AUTH-STDIO-01] authenticates with private_key_jwt for the token endpoint, and calls the admin API with that token', async () => {
    const a = authority();
    const r = await run(KEY_ARGS, {
      env: { ODUDU_MCP_KEY: keyText },
      input: SESSION,
      fetch: a.fetch,
    });
    expect(r.code).toBe(0);
    expect(a.state.tokenForms).toHaveLength(1);
    const form = a.state.tokenForms[0] ?? {};
    expect(form).toMatchObject({
      grant_type: 'client_credentials',
      client_id: 'svc',
      scope: 'mcp:read',
      resource: ADMIN_API_AUDIENCE,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    });
    const key = await loadClientKey(keyText);
    const verified = await verifyJwtAgainstJwkSet(
      form.client_assertion ?? '',
      { keys: [key.publicJwk] },
      {
        issuer: 'svc',
        audience: [TOKEN_ENDPOINT],
        now: new Date(),
        clockToleranceSeconds: 5,
      },
    );
    expect(verified).toBe(true);

    const admin = a.state.seen.filter((s) => s.url.includes('/admin/'));
    expect(admin).toHaveLength(1);
    expect(admin[0]?.url).toBe(`${BASE}/admin/tenants/acme/whoami`);
    const headers = admin[0]?.init.headers as Record<string, string>;
    expect(Object.keys(headers).sort()).toEqual(['accept', 'authorization', 'x-request-id']);
    expect(headers.authorization).toMatch(/^Bearer /u);
    expect(headers.authorization).toContain(
      Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
    );
  });

  it('answers the call with the tool result, and writes only JSON-RPC to standard output', async () => {
    const r = await run(KEY_ARGS, { env: { ODUDU_MCP_KEY: keyText }, input: SESSION });
    expect(r.code).toBe(0);
    for (const line of r.lines) expect((line as { jsonrpc: string }).jsonrpc).toBe('2.0');
    const result = byId(r.lines, 3).result as {
      isError: boolean;
      structuredContent: { data: { subjectId: string } };
    };
    expect(result.isError).toBe(false);
    expect(result.structuredContent.data.subjectId).toBe('s1');
  });

  it('keeps the key, the client assertion and the bearer off standard error', async () => {
    const a = authority();
    const r = await run(KEY_ARGS, {
      env: { ODUDU_MCP_KEY: keyText },
      input: SESSION,
      fetch: a.fetch,
    });
    const assertion = a.state.tokenForms[0]?.client_assertion ?? 'missing';
    const text = r.stderr.join('\n');
    expect(text).not.toContain(keyText);
    expect(text).not.toContain(assertion);
    expect(text).not.toContain('Bearer');
  });

  it('exits 0 at end of input', async () => {
    const r = await run(KEY_ARGS, { env: { ODUDU_MCP_KEY: keyText, ODUDU_MCP_CLIENT_ID: 'x' } });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('reads the client id from ODUDU_MCP_CLIENT_ID', async () => {
    const a = authority();
    await run(['--base-url', BASE, '--tenant', 'acme'], {
      env: { ODUDU_MCP_KEY: keyText, ODUDU_MCP_CLIENT_ID: 'from-env' },
      input: SESSION,
      fetch: a.fetch,
    });
    expect(a.state.tokenForms[0]?.client_id).toBe('from-env');
  });

  it('lists the read tools only by default, and the write tools too with --allow-writes', async () => {
    const read = await run(KEY_ARGS, { env: { ODUDU_MCP_KEY: keyText }, input: SESSION });
    const readNames = toolNames(read.lines);
    expect(readNames).toEqual(TENANT_TOOLS.filter((t) => t.access === 'read').map((t) => t.name));
    expect(readNames.length).toBe(42);

    const a = authority();
    const write = await run([...KEY_ARGS, '--allow-writes'], {
      env: { ODUDU_MCP_KEY: keyText },
      input: SESSION,
      fetch: a.fetch,
    });
    expect(toolNames(write.lines)).toEqual(TENANT_TOOLS.map((t) => t.name));
    expect(a.state.tokenForms[0]?.scope).toBe('mcp:write');
  });

  it('asks for mcp:read when it is read-only, whichever way that was said', async () => {
    for (const extra of [[], ['--read-only']]) {
      const a = authority();
      await run([...KEY_ARGS, ...extra], {
        env: { ODUDU_MCP_KEY: keyText },
        input: SESSION,
        fetch: a.fetch,
      });
      expect(a.state.tokenForms[0]?.scope).toBe('mcp:read');
    }
  });

  it('refuses a token of another issuer before any call to the admin API', async () => {
    const a = authority({ tokenIssuer: 'https://evil.example/tenants/acme' });
    const r = await run(KEY_ARGS, {
      env: { ODUDU_MCP_KEY: keyText },
      input: SESSION,
      fetch: a.fetch,
    });
    const result = byId(r.lines, 3).result as { isError: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('issuer');
    expect(a.state.seen.filter((s) => s.url.includes('/admin/'))).toEqual([]);
  });

  it('trusts no authorization server whose issuer is not the base URL and tenant', async () => {
    const a = authority({ issuer: 'https://evil.example/tenants/acme' });
    const r = await run(KEY_ARGS, {
      env: { ODUDU_MCP_KEY: keyText },
      input: SESSION,
      fetch: a.fetch,
    });
    const result = byId(r.lines, 3).result as { isError: boolean };
    expect(result.isError).toBe(true);
    expect(a.state.tokenForms).toEqual([]);
    expect(a.state.seen.filter((s) => s.url.includes('/admin/'))).toEqual([]);
  });

  it('answers a call to a write tool it does not offer as an unknown tool, and makes no admin call', async () => {
    const a = authority();
    const r = await run(KEY_ARGS, {
      env: { ODUDU_MCP_KEY: keyText },
      fetch: a.fetch,
      input: [
        INITIALIZE,
        INITIALIZED,
        {
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'update_client_metadata',
            arguments: { client_id: 'x', description: 'y' },
          },
        },
      ],
    });
    const answer = byId(r.lines, 4);
    const text = JSON.stringify(answer);
    expect(text).toMatch(/not found|unknown|isError/iu);
    expect(a.state.seen.filter((s) => s.url.includes('/admin/'))).toEqual([]);
  });
});

describe('odudu mcp --keygen and --logout', () => {
  it('prints a key line for the environment and the public key set to register, never the private key', async () => {
    const r = await run(['--keygen']);
    expect(r.code).toBe(0);
    const line = r.stdout.trim();
    expect(line.split('\n')).toHaveLength(1);
    expect(line).toMatch(/^ODUDU_MCP_KEY=[A-Za-z0-9+/=]+$/u);
    const key = await loadClientKey(line.slice('ODUDU_MCP_KEY='.length));
    expect(key.kid).toBeTruthy();
    const registered = JSON.parse(r.stderr.join('\n')) as { keys: Record<string, unknown>[] };
    expect(registered.keys).toHaveLength(1);
    expect(registered.keys[0]?.kid).toBe(key.kid);
    expect(registered.keys[0]).not.toHaveProperty('d');
  });

  it('forgets the stored sign-in of one tenant only', async () => {
    const configDir = await privateConfigDirectory();
    const a = authority({ refreshTokens: true });
    const signIn = (tenant: string) =>
      run(['--base-url', BASE, '--tenant', tenant], {
        configDir,
        fetch: a.fetch,
        openBrowser: () => Promise.resolve(false),
      });
    expect(typeof signIn).toBe('function');
    // Seed both tenants' files through the store itself.
    const { createCredentialStore } = await import('@odudu/mcp');
    for (const tenant of ['acme', 'other']) {
      await createCredentialStore({
        account: `${BASE}/tenants/${tenant}`,
        directory: configDir,
        platform: 'linux',
        run: NOTHING,
        warn: () => undefined,
      }).put(`rt-${tenant}`);
    }
    expect(await readdir(configDir)).toHaveLength(2);
    const r = await run(['--base-url', BASE, '--tenant', 'acme', '--logout'], { configDir });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toHaveLength(1);
    expect(await readdir(configDir)).toHaveLength(1);
  });
});

describe('odudu mcp with a browser sign-in', () => {
  // A browser that does what a person's does: opens the address it is given
  // and, once the sign-in is "done", is sent back to the redirect URI.
  function browserThat(answer: (address: URL) => string): McpIo['openBrowser'] {
    return async (address) => {
      const target = new URL(answer(new URL(address)));
      await fetch(target);
      return true;
    };
  }

  const approve =
    (extra = '') =>
    (address: URL) => {
      const redirect = new URL(address.searchParams.get('redirect_uri') ?? '');
      redirect.searchParams.set('code', 'the-code');
      redirect.searchParams.set('state', address.searchParams.get('state') ?? '');
      redirect.searchParams.set('iss', ISSUER);
      return redirect.href + extra;
    };

  it('signs in on a loopback listener, redeems the code with the verifier, and keeps only the refresh token', async () => {
    const a = authority({ refreshTokens: true });
    const configDir = await privateConfigDirectory();
    let authorizeAddress: URL | undefined;
    const r = await run(['--base-url', BASE, '--tenant', 'acme'], {
      configDir,
      fetch: a.fetch,
      input: SESSION,
      openBrowser: browserThat((address) => {
        authorizeAddress = address;
        return approve()(address);
      }),
    });
    expect(r.code).toBe(0);
    expect(authorizeAddress?.searchParams.get('client_id')).toBe(MCP_CLIENT_ID);
    expect(authorizeAddress?.searchParams.get('resource')).toBe(ADMIN_API_AUDIENCE);
    expect(authorizeAddress?.searchParams.get('scope')).toBe('mcp:read');
    expect(authorizeAddress?.searchParams.get('code_challenge_method')).toBe('S256');
    expect(a.state.tokenForms[0]).toMatchObject({
      grant_type: 'authorization_code',
      code: 'the-code',
      client_id: MCP_CLIENT_ID,
    });
    expect(a.state.tokenForms[0]?.code_verifier).toMatch(/^[A-Za-z0-9\-._~]{43}$/u);
    expect(a.state.tokenForms[0]).not.toHaveProperty('client_assertion');
    expect(await readdir(configDir)).toHaveLength(1);
    expect(r.stderr.join('\n')).not.toContain('the-code');
    expect(byId(r.lines, 3).result).toBeDefined();
  });

  it('refreshes with the stored token on the next run, and does not open the browser', async () => {
    const a = authority({ refreshTokens: true });
    const configDir = await privateConfigDirectory();
    await run(['--base-url', BASE, '--tenant', 'acme'], {
      configDir,
      fetch: a.fetch,
      input: SESSION,
      openBrowser: browserThat(approve()),
    });
    let opened = 0;
    const again = await run(['--base-url', BASE, '--tenant', 'acme'], {
      configDir,
      fetch: a.fetch,
      input: SESSION,
      openBrowser: () => {
        opened += 1;
        return Promise.resolve(false);
      },
    });
    expect(again.code).toBe(0);
    expect(opened).toBe(0);
    expect(a.state.tokenForms[1]).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'rt-1',
    });
  });

  it('never redeems a response from another issuer', async () => {
    const a = authority({ refreshTokens: true });
    const r = await run(['--base-url', BASE, '--tenant', 'acme'], {
      fetch: a.fetch,
      input: SESSION,
      openBrowser: browserThat((address) => {
        const url = new URL(approve()(address));
        url.searchParams.set('iss', 'https://evil.example/tenants/acme');
        url.searchParams.set('error', 'access_denied');
        url.searchParams.set('error_description', 'LEAK-TEXT');
        return url.href;
      }),
    });
    expect(a.state.tokenForms).toEqual([]);
    expect(byId(r.lines, 3).result).toMatchObject({ isError: true });
    expect(JSON.stringify(r.lines) + r.stderr.join('\n')).not.toContain('LEAK-TEXT');
  });

  it('with --allow-writes asks for mcp:write alone and keeps nothing', async () => {
    const a = authority({ refreshTokens: true });
    const configDir = await privateConfigDirectory();
    let scope: string | null = null;
    const r = await run(['--base-url', BASE, '--tenant', 'acme', '--allow-writes'], {
      configDir,
      fetch: a.fetch,
      input: SESSION,
      openBrowser: browserThat((address) => {
        scope = address.searchParams.get('scope');
        return approve()(address);
      }),
    });
    expect(r.code).toBe(0);
    expect(scope).toBe('mcp:write');
    expect(await readdir(configDir)).toEqual([]);
    expect(toolNames(r.lines)).toEqual(TENANT_TOOLS.map((t) => t.name));
  });

  it('does not use a stored refresh token for a run that allows writes', async () => {
    const a = authority({ refreshTokens: true });
    const configDir = await privateConfigDirectory();
    await run(['--base-url', BASE, '--tenant', 'acme'], {
      configDir,
      fetch: a.fetch,
      input: SESSION,
      openBrowser: browserThat(approve()),
    });
    const before = a.state.tokenForms.length;
    await run(['--base-url', BASE, '--tenant', 'acme', '--allow-writes'], {
      configDir,
      fetch: a.fetch,
      input: SESSION,
      openBrowser: browserThat(approve()),
    });
    const forms = a.state.tokenForms.slice(before);
    expect(forms.map((f) => f.grant_type)).toEqual(['authorization_code']);
    expect(forms[0]?.scope).toBeUndefined();
  });

  it('[MCP-AUTH-REFRESH-01] refuses a stored sign-in that group or others can read, before serving anything', async () => {
    const configDir = await privateConfigDirectory();
    const { createCredentialStore } = await import('@odudu/mcp');
    await createCredentialStore({
      account: ISSUER,
      directory: configDir,
      platform: 'linux',
      run: NOTHING,
      warn: () => undefined,
    }).put('rt-secret');
    const [name] = await readdir(configDir);
    await chmod(join(configDir, name ?? ''), 0o644);
    const r = await run(['--base-url', BASE, '--tenant', 'acme'], { configDir, input: SESSION });
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toHaveLength(1);
    expect(r.stderr[0]).toMatch(/group or others/u);
    expect(r.stderr[0]).not.toContain('rt-secret');
  });
});

describe('odudu mcp at a tenant with a domain of its own', () => {
  const DOMAIN = 'https://login.acme.org';
  const TOKEN = `${DOMAIN}/protocol/openid-connect/token`;

  function domainAuthority() {
    const seen: string[] = [];
    const reply = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    const stub: typeof fetch = (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      seen.push(url);
      if (url === `${DOMAIN}/.well-known/oauth-authorization-server`) {
        return Promise.resolve(
          reply({
            issuer: DOMAIN,
            authorization_endpoint: `${DOMAIN}/protocol/openid-connect/auth`,
            token_endpoint: TOKEN,
            code_challenge_methods_supported: ['S256'],
          }),
        );
      }
      if (url === TOKEN) {
        return Promise.resolve(
          reply({
            access_token: `${part({ alg: 'none' })}.${part({ iss: DOMAIN, aud: [ADMIN_API_AUDIENCE], scope: 'mcp:read' })}.`,
            token_type: 'Bearer',
            expires_in: 300,
          }),
        );
      }
      if (url.startsWith(`${BASE}/admin/tenants/acme/`)) {
        return Promise.resolve(
          reply({
            subjectId: 's1',
            issuerTenantId: 't1',
            issuerTenantName: 'acme',
            capabilities: [],
            crossTenant: false,
          }),
        );
      }
      return Promise.resolve(new Response('nope', { status: 404 }));
    };
    return { seen, fetch: stub };
  }

  it('signs in at the domain it is told of, and calls the admin API at the instance', async () => {
    const a = domainAuthority();
    const r = await run(
      ['--base-url', BASE, '--tenant-address', DOMAIN, '--tenant', 'acme', '--client-id', 'svc'],
      {
        env: { ODUDU_MCP_KEY: keyText },
        input: SESSION,
        fetch: a.fetch,
      },
    );
    expect(r.code).toBe(0);
    expect(byId(r.lines, 3).result).toMatchObject({ isError: false });
    expect(a.seen).toContain(`${BASE}/admin/tenants/acme/whoami`);
    expect(byId(r.lines, 1).result).toMatchObject({
      serverInfo: { name: 'odudu:acme', title: 'Odudu (acme)' },
      instructions: expect.stringContaining('Odudu tenant "acme" only') as string,
    });
    expect(a.seen.filter((url) => url.startsWith(DOMAIN))).toEqual([
      `${DOMAIN}/.well-known/oauth-authorization-server`,
      TOKEN,
    ]);
  });

  it('refuses a domain whose metadata names another host, before any token request', async () => {
    const a = domainAuthority();
    const hostile: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === `${DOMAIN}/.well-known/oauth-authorization-server`) {
        return new Response(
          JSON.stringify({
            issuer: 'https://evil.example',
            code_challenge_methods_supported: ['S256'],
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      }
      return a.fetch(input, init);
    };
    const r = await run(
      ['--base-url', BASE, '--tenant-address', DOMAIN, '--tenant', 'acme', '--client-id', 'svc'],
      {
        env: { ODUDU_MCP_KEY: keyText },
        input: SESSION,
        fetch: hostile,
      },
    );
    expect(byId(r.lines, 3).result).toMatchObject({ isError: true });
    expect(a.seen.filter((url) => url === TOKEN)).toEqual([]);
  });
});

describe('odudu mcp when a call is in flight at end of input', () => {
  it('waits for it, so its outcome is known before the process ends', async () => {
    const a = authority();
    let finished = false;
    const slow: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/admin/')) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        finished = true;
      }
      return a.fetch(input, init);
    };
    const r = await run(KEY_ARGS, {
      env: { ODUDU_MCP_KEY: keyText },
      input: [
        INITIALIZE,
        INITIALIZED,
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'whoami', arguments: {} } },
      ],
      fetch: slow,
      eof: 'while-running',
    });
    expect(r.code).toBe(0);
    expect(finished).toBe(true);
  });
});

describe('odudu mcp when something it did not expect goes wrong', () => {
  it('says what, with the correlation id, and leaves out what could be a secret', async () => {
    const a = authority();
    const breaking: typeof fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes('/admin/')) return a.fetch(input, init);
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(
                new TypeError('stream broke at https://id.example.com/x?code=SECRETCODE'),
              );
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      );
    };
    const r = await run(KEY_ARGS, {
      env: { ODUDU_MCP_KEY: keyText },
      input: SESSION,
      fetch: breaking,
    });
    const line = r.stderr.find((l) => l.includes('tool failed'));
    expect(line).toMatch(/^odudu mcp: tool failed \([0-9a-f-]{36}\): TypeError: stream broke/u);
    expect(r.stderr.join('\n')).not.toContain('SECRETCODE');
  });
});

describe('odudu mcp keeps a sign-in for the address it was made at', () => {
  const FIRST = 'https://login.acme.org';
  const SECOND = 'https://evil.example';

  // An authorization server at each address, and the admin API at the instance.
  function servers() {
    const tokenForms: { at: string; form: Record<string, string> }[] = [];
    const reply = (body: unknown) =>
      new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    const stub: typeof fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      for (const origin of [FIRST, SECOND]) {
        if (url === `${origin}/.well-known/oauth-authorization-server`) {
          return Promise.resolve(
            reply({
              issuer: origin,
              authorization_endpoint: `${origin}/protocol/openid-connect/auth`,
              token_endpoint: `${origin}/protocol/openid-connect/token`,
              code_challenge_methods_supported: ['S256'],
              authorization_response_iss_parameter_supported: true,
            }),
          );
        }
        if (url === `${origin}/protocol/openid-connect/token`) {
          const form = Object.fromEntries(
            new URLSearchParams(typeof init?.body === 'string' ? init.body : ''),
          );
          tokenForms.push({ at: origin, form });
          const n = String(tokenForms.length);
          return Promise.resolve(
            reply({
              access_token: `${part({ alg: 'none' })}.${part({ iss: origin, aud: [ADMIN_API_AUDIENCE], scope: 'mcp:read', jti: n })}.`,
              token_type: 'Bearer',
              expires_in: 300,
              scope: 'mcp:read',
              refresh_token: `rt-${n}`,
            }),
          );
        }
      }
      if (url.startsWith(`${BASE}/admin/`)) {
        return Promise.resolve(
          reply({
            subjectId: 's',
            issuerTenantId: 't',
            issuerTenantName: 'acme',
            capabilities: [],
            crossTenant: false,
          }),
        );
      }
      return Promise.resolve(new Response('nope', { status: 404 }));
    };
    return { tokenForms, fetch: stub };
  }

  const approving =
    (issuer: string) =>
    async (address: string): Promise<boolean> => {
      const url = new URL(address);
      const back = new URL(url.searchParams.get('redirect_uri') ?? '');
      back.searchParams.set('code', 'the-code');
      back.searchParams.set('state', url.searchParams.get('state') ?? '');
      back.searchParams.set('iss', issuer);
      await fetch(back);
      return true;
    };

  it('does not hand a refresh token kept for one tenant address to another', async () => {
    const s = servers();
    const configDir = await privateConfigDirectory();
    const args = (address: string) => [
      '--base-url',
      BASE,
      '--tenant-address',
      address,
      '--tenant',
      'acme',
    ];
    await run(args(FIRST), {
      configDir,
      fetch: s.fetch,
      input: SESSION,
      openBrowser: approving(FIRST),
    });
    expect(s.tokenForms.map((t) => t.form.grant_type)).toEqual(['authorization_code']);

    let opened = 0;
    await run(args(SECOND), {
      configDir,
      fetch: s.fetch,
      input: SESSION,
      openBrowser: (address) => {
        opened += 1;
        return approving(SECOND)(address);
      },
    });
    expect(opened).toBe(1);
    expect(s.tokenForms.filter((t) => t.at === SECOND).map((t) => t.form.grant_type)).toEqual([
      'authorization_code',
    ]);
    expect(JSON.stringify(s.tokenForms.filter((t) => t.at === SECOND))).not.toContain('rt-1');
  });

  it('refreshes at the address it was made at', async () => {
    const s = servers();
    const configDir = await privateConfigDirectory();
    const argv = ['--base-url', BASE, '--tenant-address', FIRST, '--tenant', 'acme'];
    await run(argv, { configDir, fetch: s.fetch, input: SESSION, openBrowser: approving(FIRST) });
    await run(argv, {
      configDir,
      fetch: s.fetch,
      input: SESSION,
      openBrowser: () => Promise.resolve(false),
    });
    expect(s.tokenForms.map((t) => t.form.grant_type)).toEqual([
      'authorization_code',
      'refresh_token',
    ]);
  });
});
