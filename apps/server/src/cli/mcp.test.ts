import { generateClientKey, loadClientKey, verifyJwtAgainstJwkSet } from '@odudu/crypto';
import { MCP_CLIENT_ID, ADMIN_API_AUDIENCE } from '@odudu/domain-tenant';
import { TOOLS, type RunTool } from '@odudu/mcp';
import { chmod, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { beforeAll, describe, expect, it } from 'vitest';
import { mcpCommand, type McpIo } from '#/cli/mcp';

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

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string[];
  readonly lines: unknown[];
}

async function run(
  argv: string[],
  options: {
    env?: Record<string, string>;
    input?: unknown[];
    fetch?: typeof fetch;
    configDir?: string;
    openBrowser?: McpIo['openBrowser'];
  } = {},
): Promise<Run> {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let out = '';
  stdout.setEncoding('utf8');
  stdout.on('data', (chunk: string) => {
    out += chunk;
  });
  const stderr: string[] = [];
  const configDir = options.configDir ?? (await mkdtemp(join(tmpdir(), 'odudu-mcp-')));
  const io: McpIo = {
    stdin,
    stdout,
    stderr: (line) => stderr.push(line),
    env: options.env ?? {},
    platform: 'linux',
    configDir,
    run: NOTHING,
    fetch: options.fetch ?? authority().fetch,
    now: () => new Date(),
    entropy: (bytes) => Uint8Array.from({ length: bytes }, (_, i) => (i * 7 + 3) % 251),
    ...(options.openBrowser === undefined ? {} : { openBrowser: options.openBrowser }),
  };
  const done = mcpCommand(argv, io);
  for (const message of options.input ?? []) stdin.write(`${JSON.stringify(message)}\n`);
  if (options.input !== undefined) {
    // Wait for every answer a request among them asks for, then end the input.
    const wanted = options.input.filter(
      (m) => typeof m === 'object' && m !== null && 'id' in m,
    ).length;
    for (let i = 0; i < 400 && out.split('\n').filter(Boolean).length < wanted; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  stdin.end();
  const code = await done;
  return {
    code,
    stdout: out,
    stderr,
    lines: out
      .split('\n')
      .filter(Boolean)
      .map((line): unknown => {
        try {
          return JSON.parse(line);
        } catch {
          return line;
        }
      }),
  };
}

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 't', version: '1' },
  },
};
const INITIALIZED = { jsonrpc: '2.0', method: 'notifications/initialized' };
const LIST = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
const WHOAMI = {
  jsonrpc: '2.0',
  id: 3,
  method: 'tools/call',
  params: { name: 'whoami', arguments: {} },
};
const SESSION = [INITIALIZE, INITIALIZED, LIST, WHOAMI];

function byId(lines: unknown[], id: number): Record<string, unknown> {
  const found = lines.find((l) => typeof l === 'object' && l !== null && 'id' in l && l.id === id);
  if (typeof found !== 'object' || found === null) throw new Error(`no answer ${String(id)}`);
  return Object.fromEntries(Object.entries(found));
}

function toolNames(lines: unknown[]): string[] {
  const result = byId(lines, 2).result as { tools: { name: string }[] };
  return result.tools.map((t) => t.name);
}

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
  it('authenticates with private_key_jwt for the token endpoint, and calls the admin API with that token', async () => {
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
    expect(readNames).toEqual(TOOLS.filter((t) => t.access === 'read').map((t) => t.name));
    expect(readNames.length).toBe(42);

    const a = authority();
    const write = await run([...KEY_ARGS, '--allow-writes'], {
      env: { ODUDU_MCP_KEY: keyText },
      input: SESSION,
      fetch: a.fetch,
    });
    expect(toolNames(write.lines)).toEqual(TOOLS.map((t) => t.name));
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
    const configDir = await mkdtemp(join(tmpdir(), 'odudu-mcp-'));
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
    const configDir = await mkdtemp(join(tmpdir(), 'odudu-mcp-'));
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
    const configDir = await mkdtemp(join(tmpdir(), 'odudu-mcp-'));
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
    const configDir = await mkdtemp(join(tmpdir(), 'odudu-mcp-'));
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
    expect(toolNames(r.lines)).toEqual(TOOLS.map((t) => t.name));
  });

  it('does not use a stored refresh token for a run that allows writes', async () => {
    const a = authority({ refreshTokens: true });
    const configDir = await mkdtemp(join(tmpdir(), 'odudu-mcp-'));
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

  it('refuses a stored sign-in that group or others can read, before serving anything', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'odudu-mcp-'));
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
