import { generateClientKey, loadClientKey } from '@odudu/crypto';
import { withTenant } from '@odudu/db';
import { auditEvents } from '@odudu/domain-audit';
import { roleRepository } from '@odudu/domain-authz';
import {
  ADMIN_API_AUDIENCE,
  ADMIN_CLIENT_ID,
  clientRepository,
  MCP_CLIENT_ID,
  tenantDomainRepository,
} from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { clientOidcConfig } from '@odudu/protocol-oidc';
import { eq } from 'drizzle-orm';
import { readdir } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed, seedAdmin } from '#/cli/seed';
import {
  byId,
  INITIALIZE,
  INITIALIZED,
  privateConfigDirectory,
  runMcp,
} from '#/testing/mcp-session';
import { type McpStack, startMcpStack } from '#/testing/mcp-stack';
import { reachingApp, scriptedBrowser } from '#/testing/scripted-browser';

// `odudu mcp` against the real app and a real database: the sign-in in a
// scripted browser with a real loopback listener, the service account's key,
// and tool calls that reach the admin API with a token issued straight to the
// built-in client or to the service account.

let stack: McpStack;

beforeAll(async () => {
  stack = await startMcpStack();
}, 120_000);

afterAll(async () => {
  await stack.close();
});

const BASE = 'https://id.example.com';
const HOST = 'id.example.com';
const PASSWORD = 'correct horse battery staple';
const CAPABILITIES = ['manage-clients', 'view-users', 'manage-tenant'];

async function tenant() {
  const name = `stdio-${newId()}`;
  const username = `u${newId().slice(-10)}`;
  const seeded = await seed({
    tenant: name,
    clientId: 'portal',
    redirectUris: ['https://app.example/callback'],
    username,
    password: PASSWORD,
  });
  await grant(seeded.tenantId, seeded.userSubjectId, CAPABILITIES);
  return { name, username, tenantId: seeded.tenantId };
}

async function grant(tenantId: string, subjectId: string | undefined, capabilities: string[]) {
  if (subjectId === undefined) throw new Error('no subject to grant to');
  await withTenant(stack.appDb.db, tenantId, async (tx) => {
    const admin = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
    if (admin === null) throw new Error('no admin client');
    for (const capability of capabilities) {
      const role = await roleRepository(tx).byName(capability, admin.id);
      if (role === null) throw new Error(`no role ${capability}`);
      await roleRepository(tx).assignToSubject(subjectId, role.id);
    }
  });
}

interface Wire {
  readonly fetch: typeof fetch;
  readonly admin: { url: string; authorization: string; headers: string[] }[];
}

function wire(...also: string[]): Wire {
  const through = reachingApp(stack.app, [BASE, ...also]);
  const admin: Wire['admin'] = [];
  return {
    admin,
    fetch: (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url).pathname.startsWith('/admin/')) {
        const headers = new Headers(init?.headers);
        admin.push({
          url,
          authorization: headers.get('authorization') ?? '',
          headers: [...headers.keys()].sort(),
        });
      }
      return through(input, init);
    },
  };
}

function call(id: number, name: string, args: unknown = {}) {
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } };
}

function claimsOf(authorization: string): Record<string, unknown> {
  const token = authorization.replace(/^Bearer /u, '');
  return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
}

describe('odudu mcp, signing in as a person', () => {
  it('lists and counts the tenants for a system administrator, which a tenant’s own run is not offered', async () => {
    const username = `ops${newId().slice(-10)}`;
    await seedAdmin({ username, password: PASSWORD });
    const t = await tenant();
    const w = wire();
    const names = (lines: Parameters<typeof byId>[0], id: number) =>
      (byId(lines, id).result as { tools: { name: string }[] }).tools.map((tool) => tool.name);
    const system = await runMcp(['--base-url', BASE, '--tenant', 'system'], {
      fetch: w.fetch,
      configDir: await privateConfigDirectory(),
      input: [
        INITIALIZE,
        INITIALIZED,
        { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
        call(3, 'list_tenants', { name: t.name }),
        call(4, 'count_tenants', {}),
      ],
      openBrowser: async (address) => {
        await fetch(
          await scriptedBrowser(stack.app, address, {
            host: HOST,
            tenant: 'system',
            username,
            password: PASSWORD,
            tick: ['mcp:read'],
          }),
        );
        return true;
      },
    });
    expect(system.code).toBe(0);
    expect(names(system.lines, 2)).toEqual(
      expect.arrayContaining(['list_tenants', 'count_tenants']),
    );
    const page = byId(system.lines, 3).result as {
      isError: boolean;
      structuredContent: { data: { name: string }[] };
    };
    expect(page.isError, JSON.stringify(page)).toBe(false);
    expect(page.structuredContent.data.map((row) => row.name)).toEqual([t.name]);
    const count = byId(system.lines, 4).result as {
      structuredContent: { data: { count: number } };
    };
    expect(count.structuredContent.data.count).toBeGreaterThanOrEqual(2);
    expect(w.admin.map((seen) => new URL(seen.url).pathname)).toEqual([
      '/admin/tenants',
      '/admin/tenants/count',
    ]);

    const local = await runMcp(['--base-url', BASE, '--tenant', t.name], {
      fetch: wire().fetch,
      configDir: await privateConfigDirectory(),
      input: [INITIALIZE, INITIALIZED, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }],
      openBrowser: async (address) => {
        await fetch(
          await scriptedBrowser(stack.app, address, {
            host: HOST,
            tenant: t.name,
            username: t.username,
            password: PASSWORD,
            tick: ['mcp:read'],
          }),
        );
        return true;
      },
    });
    expect(names(local.lines, 2)).not.toContain('list_tenants');
    expect(names(local.lines, 2)).not.toContain('count_tenants');
    expect(names(local.lines, 2)).toContain('list_clients');
  }, 90_000);

  it('answers a tenant person who calls the tenant tools by name with a refusal, and asks the admin API nothing', async () => {
    const t = await tenant();
    const w = wire();
    const r = await runMcp(['--base-url', BASE, '--tenant', t.name], {
      fetch: w.fetch,
      configDir: await privateConfigDirectory(),
      input: [INITIALIZE, INITIALIZED, call(2, 'list_tenants'), call(3, 'count_tenants')],
      openBrowser: async (address) => {
        await fetch(
          await scriptedBrowser(stack.app, address, {
            host: HOST,
            tenant: t.name,
            username: t.username,
            password: PASSWORD,
            tick: ['mcp:read'],
          }),
        );
        return true;
      },
    });
    expect(r.code).toBe(0);
    for (const id of [2, 3]) {
      const reply = byId(r.lines, id);
      const refused =
        (reply.result as { isError?: boolean } | undefined)?.isError === true ||
        reply.error !== undefined;
      expect(refused, JSON.stringify(reply)).toBe(true);
    }
    expect(w.admin.map((seen) => new URL(seen.url).pathname)).toEqual([]);
  }, 90_000);

  it('signs in through the real /authorize and consent, then reads as the person with a token issued to odudu-mcp', async () => {
    const t = await tenant();
    const w = wire();
    const configDir = await privateConfigDirectory();
    const r = await runMcp(['--base-url', BASE, '--tenant', t.name], {
      fetch: w.fetch,
      configDir,
      input: [INITIALIZE, INITIALIZED, call(2, 'whoami'), call(3, 'list_clients')],
      openBrowser: async (address) => {
        const back = await scriptedBrowser(stack.app, address, {
          host: HOST,
          tenant: t.name,
          username: t.username,
          password: PASSWORD,
          tick: ['mcp:read'],
        });
        expect(back.startsWith('http://127.0.0.1:')).toBe(true);
        await fetch(back);
        return true;
      },
    });
    expect(r.stderr[0]).toMatch(/sign in in the browser/u);
    expect(r.code).toBe(0);
    const whoami = byId(r.lines, 2).result as {
      isError: boolean;
      structuredContent: { data: { capabilities: string[] } };
    };
    expect(whoami.isError).toBe(false);
    expect(whoami.structuredContent.data.capabilities).toEqual(
      expect.arrayContaining(CAPABILITIES),
    );
    const clients = byId(r.lines, 3).result as {
      isError: boolean;
      structuredContent: { data: unknown[] };
    };
    expect(clients.isError, JSON.stringify(clients)).toBe(false);
    expect(clients.structuredContent.data.length).toBeGreaterThan(1);

    expect(w.admin.length).toBe(2);
    for (const seen of w.admin) {
      expect(seen.headers).toEqual(['accept', 'authorization', 'x-request-id']);
      const claims = claimsOf(seen.authorization);
      expect(claims).toMatchObject({ client_id: MCP_CLIENT_ID, scope: 'mcp:read' });
      expect(claims.aud).toEqual(expect.arrayContaining([ADMIN_API_AUDIENCE]));
      expect(claims.act).toBeUndefined();
    }
    expect(await readdir(configDir)).toHaveLength(1);
  }, 60_000);

  it('uses the stored refresh token on the next run, with no browser', async () => {
    const t = await tenant();
    const configDir = await privateConfigDirectory();
    const signIn = (address: string) =>
      scriptedBrowser(stack.app, address, {
        host: HOST,
        tenant: t.name,
        username: t.username,
        password: PASSWORD,
        tick: ['mcp:read'],
      }).then(async (back) => {
        await fetch(back);
        return true;
      });
    await runMcp(['--base-url', BASE, '--tenant', t.name], {
      fetch: wire().fetch,
      configDir,
      input: [INITIALIZE, INITIALIZED, call(2, 'whoami')],
      openBrowser: signIn,
    });
    let opened = 0;
    const second = await runMcp(['--base-url', BASE, '--tenant', t.name], {
      fetch: wire().fetch,
      configDir,
      input: [INITIALIZE, INITIALIZED, call(2, 'whoami')],
      openBrowser: () => {
        opened += 1;
        return Promise.resolve(false);
      },
    });
    expect(opened).toBe(0);
    expect(second.stderr.join('\n')).not.toMatch(/sign in in the browser/u);
    expect(byId(second.lines, 2).result).toMatchObject({ isError: false });
  }, 60_000);

  it('with --allow-writes asks again, issues mcp:write only, changes a client description and keeps nothing', async () => {
    const t = await tenant();
    const w = wire();
    const configDir = await privateConfigDirectory();
    const portal = await withTenant(stack.appDb.db, t.tenantId, async (tx) => {
      const row = await clientRepository(tx).byClientId('portal');
      if (row === null) throw new Error('no portal');
      return row;
    });
    const got = await runMcp(['--base-url', BASE, '--tenant', t.name, '--allow-writes'], {
      fetch: w.fetch,
      configDir,
      input: [INITIALIZE, INITIALIZED, call(2, 'get_client', { id: portal.id })],
      openBrowser: async (address) => {
        const url = new URL(address);
        expect(url.searchParams.get('scope')).toBe('mcp:write');
        const back = await scriptedBrowser(stack.app, address, {
          host: HOST,
          tenant: t.name,
          username: t.username,
          password: PASSWORD,
          tick: ['mcp:write'],
        });
        await fetch(back);
        return true;
      },
    });
    expect(got.code).toBe(0);
    const read = byId(got.lines, 2).result as {
      isError: boolean;
      structuredContent: { etag: string };
    };
    expect(read.isError, JSON.stringify(read)).toBe(false);
    const etag = read.structuredContent.etag;
    expect(await readdir(configDir)).toEqual([]);
    expect(claimsOf(w.admin[0]?.authorization ?? '')).toMatchObject({ scope: 'mcp:write' });

    const wrote = await runMcp(['--base-url', BASE, '--tenant', t.name, '--allow-writes'], {
      fetch: w.fetch,
      configDir,
      input: [
        INITIALIZE,
        INITIALIZED,
        call(2, 'update_client_metadata', {
          id: portal.id,
          if_match: etag,
          description: 'set over stdio',
        }),
      ],
      openBrowser: async (address) => {
        const back = await scriptedBrowser(stack.app, address, {
          host: HOST,
          tenant: t.name,
          username: t.username,
          password: PASSWORD,
          tick: ['mcp:write'],
        });
        await fetch(back);
        return true;
      },
    });
    const result = byId(wrote.lines, 2).result as { isError: boolean };
    expect(result.isError, JSON.stringify(wrote.lines)).toBe(false);
    const row = await withTenant(stack.appDb.db, t.tenantId, (tx) =>
      clientRepository(tx).byId(portal.id),
    );
    expect(row?.description).toBe('set over stdio');
    const amended = await withTenant(stack.appDb.db, t.tenantId, (tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.action, 'client.amend')),
    );
    expect(amended.length).toBeGreaterThan(0);
    const agentRow = await withTenant(stack.appDb.db, t.tenantId, (tx) =>
      clientRepository(tx).byClientId(MCP_CLIENT_ID),
    );
    expect(amended.at(-1)?.actorClientId).toBe(agentRow?.id);
    expect(await readdir(configDir)).toEqual([]);
  }, 90_000);

  it('does not redeem a response that came back with another issuer', async () => {
    const t = await tenant();
    const w = wire();
    const r = await runMcp(['--base-url', BASE, '--tenant', t.name], {
      fetch: w.fetch,
      input: [INITIALIZE, INITIALIZED, call(2, 'whoami')],
      openBrowser: async (address) => {
        const back = new URL(
          await scriptedBrowser(stack.app, address, {
            host: HOST,
            tenant: t.name,
            username: t.username,
            password: PASSWORD,
            tick: ['mcp:read'],
          }),
        );
        back.searchParams.set('iss', 'https://evil.example/tenants/x');
        await fetch(back);
        return true;
      },
    });
    expect(byId(r.lines, 2).result).toMatchObject({ isError: true });
    expect(w.admin).toEqual([]);
  }, 60_000);
});

async function serviceAccount(t: { name: string; tenantId: string }, capabilities: string[]) {
  const keyText = await generateClientKey();
  const key = await loadClientKey(keyText);
  await seed([
    'client',
    '--tenant',
    t.name,
    '--client-id',
    'agent-svc',
    '--client-secret',
    'unused-secret-value-123456',
    '--grant-type',
    'client_credentials',
    '--client-credentials-scope',
    'mcp:read',
  ]);
  const subjectId = await withTenant(stack.appDb.db, t.tenantId, async (tx) => {
    const row = await clientRepository(tx).byClientId('agent-svc');
    if (row === null) throw new Error('no agent-svc');
    await tx
      .update(clientOidcConfig)
      .set({
        tokenEndpointAuthMethod: 'private_key_jwt',
        jwks: { keys: [key.publicJwk] },
        audiences: [ADMIN_API_AUDIENCE],
      })
      .where(eq(clientOidcConfig.clientId, row.id));
    return row.serviceSubjectId;
  });
  await grant(t.tenantId, subjectId ?? undefined, capabilities);
  return { keyText, subjectId };
}

describe('odudu mcp, as a service account', () => {
  it('signs in with its key (private_key_jwt, client_credentials) and reads with the ceiling of its roles', async () => {
    const t = await tenant();
    const { keyText, subjectId } = await serviceAccount(t, ['manage-clients']);
    const w = wire();
    const r = await runMcp(['--base-url', BASE, '--tenant', t.name, '--client-id', 'agent-svc'], {
      fetch: w.fetch,
      env: { ODUDU_MCP_KEY: keyText },
      input: [INITIALIZE, INITIALIZED, call(2, 'list_clients'), call(3, 'list_subjects')],
    });
    expect(r.code).toBe(0);
    expect(r.stderr).toEqual([]);
    const clients = byId(r.lines, 2).result as { isError: boolean };
    expect(clients.isError, JSON.stringify(r.lines)).toBe(false);
    // The account holds manage-clients and nothing for users.
    const subjects = byId(r.lines, 3).result as {
      isError: boolean;
      structuredContent: { error: Record<string, unknown> };
    };
    expect(subjects.isError).toBe(true);
    expect(Object.keys(subjects.structuredContent.error).sort()).toEqual(
      ['detail', 'status', 'title', 'type'].filter((k) => k in subjects.structuredContent.error),
    );
    expect(subjects.structuredContent.error.status).toBe(403);
    const claims = claimsOf(w.admin[0]?.authorization ?? '');
    expect(claims).toMatchObject({ client_id: 'agent-svc', scope: 'mcp:read' });
    expect(claims.sub).toBe(subjectId);
  }, 60_000);
});

describe('what the admin API records of an agent that reached it directly', () => {
  it('leaves one agent.tool_call row for each read over stdio, naming odudu-mcp', async () => {
    const t = await tenant();
    const configDir = await privateConfigDirectory();
    const r = await runMcp(['--base-url', BASE, '--tenant', t.name], {
      fetch: wire().fetch,
      configDir,
      input: [INITIALIZE, INITIALIZED, call(2, 'whoami'), call(3, 'list_clients')],
      openBrowser: async (address) => {
        const back = await scriptedBrowser(stack.app, address, {
          host: HOST,
          tenant: t.name,
          username: t.username,
          password: PASSWORD,
          tick: ['mcp:read'],
        });
        await fetch(back);
        return true;
      },
    });
    expect(r.code).toBe(0);
    const rows = await withTenant(stack.appDb.db, t.tenantId, (tx) =>
      tx
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, 'agent.tool_call'))
        .orderBy(auditEvents.id),
    );
    expect(rows.map((row) => (row.detail as { tool: string }).tool)).toEqual([
      'admin.get.whoami',
      'admin.get.clients',
    ]);
    const mcpClient = await withTenant(stack.appDb.db, t.tenantId, (tx) =>
      clientRepository(tx).byClientId(MCP_CLIENT_ID),
    );
    for (const row of rows) {
      expect(row).toMatchObject({ outcome: 'allowed', actorClientId: mcpClient?.id });
    }
  }, 60_000);

  it('leaves a service account the same rows, and a call through the endpoint only the endpoint’s', async () => {
    const t = await tenant();
    const { keyText } = await serviceAccount(t, ['manage-clients']);
    const r = await runMcp(['--base-url', BASE, '--tenant', t.name, '--client-id', 'agent-svc'], {
      fetch: wire().fetch,
      env: { ODUDU_MCP_KEY: keyText },
      input: [INITIALIZE, INITIALIZED, call(2, 'list_clients')],
    });
    expect(byId(r.lines, 2).result).toMatchObject({ isError: false });
    const rows = await withTenant(stack.appDb.db, t.tenantId, (tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.action, 'agent.tool_call')),
    );
    expect(rows).toHaveLength(1);

    const w = await stack.world(['manage-clients'], 'mcp:read');
    const result = await stack.call(w, await stack.sign(w, 'mcp:read'), 'list_clients');
    expect(result.isError).toBe(false);
    const viaEndpoint = await stack.auditRows(w, 'agent.tool_call');
    expect(viaEndpoint).toHaveLength(1);
    expect((viaEndpoint[0]?.detail as { tool: string }).tool).toBe('list_clients');
  }, 60_000);
});

describe('odudu mcp, at a tenant with a domain of its own', () => {
  async function domainTenant() {
    const t = await tenant();
    const host = `d${t.name.slice(-8)}.domain-tests.net`;
    await withTenant(stack.appDb.db, t.tenantId, async (tx) => {
      const domains = tenantDomainRepository(tx);
      const row = await domains.insert({ tenantId: t.tenantId, host, challenge: 'c' });
      await domains.markVerified(t.tenantId, row.id, new Date());
      await domains.setCanonical(t.tenantId, row.id);
    });
    return { ...t, host };
  }

  it('reads through the domain, which is the issuer, with the service account’s key', async () => {
    const t = await domainTenant();
    const { keyText } = await serviceAccount(t, ['manage-clients']);
    const address = `https://${t.host}`;
    const w = wire(address);
    const r = await runMcp(
      [
        '--base-url',
        BASE,
        '--tenant-address',
        address,
        '--tenant',
        t.name,
        '--client-id',
        'agent-svc',
      ],
      {
        fetch: w.fetch,
        env: { ODUDU_MCP_KEY: keyText },
        input: [INITIALIZE, INITIALIZED, call(2, 'list_clients')],
      },
    );
    expect(r.code).toBe(0);
    const listed = byId(r.lines, 2).result as { isError: boolean };
    expect(listed.isError, JSON.stringify(r.lines)).toBe(false);
    expect(claimsOf(w.admin[0]?.authorization ?? '').iss).toBe(address);
  }, 60_000);

  it('says what to do when the tenant is asked for at the instance address instead', async () => {
    const t = await domainTenant();
    const { keyText } = await serviceAccount(t, ['manage-clients']);
    const r = await runMcp(['--base-url', BASE, '--tenant', t.name, '--client-id', 'agent-svc'], {
      fetch: wire().fetch,
      env: { ODUDU_MCP_KEY: keyText },
      input: [INITIALIZE, INITIALIZED, call(2, 'list_clients')],
    });
    const result = byId(r.lines, 2).result as { isError: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/domain of its own|issuer/u);
  }, 60_000);
});
