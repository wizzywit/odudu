import { withTenant } from '@odudu/db';
import { clientRepository } from '@odudu/domain-tenant';
import { mcpAudienceOfIssuer, newId } from '@odudu/kernel';
import { clientOidcConfig } from '@odudu/protocol-oidc';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '#/cli/seed';
import { type McpStack, startMcpStack } from '#/testing/mcp-stack';

// The write scope is put to the person every time it is requested, through the
// real /authorize, the sign-in and the consent page, for a client that an
// administrator made and that does not otherwise ask for consent.

let stack: McpStack;

beforeAll(async () => {
  stack = await startMcpStack();
}, 120_000);

afterAll(async () => {
  await stack.close();
});

const HOST = 'id.example.com';
const PASSWORD = 'correct horse battery staple';
const REDIRECT = 'https://app.example/callback';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const FORM = { 'content-type': 'application/x-www-form-urlencoded', host: HOST };

async function tenant() {
  const name = `consent-${newId()}`;
  const username = `u${newId().slice(-10)}`;
  const seeded = await seed({
    tenant: name,
    clientId: 'portal',
    redirectUris: [REDIRECT],
    username,
    password: PASSWORD,
  });
  const resource = mcpAudienceOfIssuer(`http://${HOST}/tenants/${name}`.replace('http:', 'https:'));
  await withTenant(stack.appDb.db, seeded.tenantId, async (tx) => {
    const portal = await clientRepository(tx).byClientId('portal');
    if (portal === null) throw new Error('no portal');
    await tx
      .update(clientOidcConfig)
      .set({ audiences: [resource] })
      .where(eq(clientOidcConfig.clientId, portal.id));
  });
  for (const scope of ['mcp:read', 'mcp:write']) {
    await seed([
      'assign-scope',
      '--tenant',
      name,
      '--client-id',
      'portal',
      '--scope',
      scope,
      '--assignment',
      'optional',
    ]);
  }
  return { name, username, resource };
}

type T = Awaited<ReturnType<typeof tenant>>;
type Res = { statusCode: number; headers: Record<string, unknown>; body: string };

function jarOf(jar: Map<string, string>, res: Res): void {
  const raw = res.headers['set-cookie'];
  const lines = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
  for (const line of lines) {
    const [pair] = line.split(';');
    const at = pair?.indexOf('=') ?? -1;
    if (pair === undefined || at < 0) continue;
    const value = pair.slice(at + 1);
    if (value === '') jar.delete(pair.slice(0, at));
    else jar.set(pair.slice(0, at), value);
  }
}

const cookie = (jar: Map<string, string>) => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

function field(html: string): string {
  const found = /name="auth_session_id" value="([^"]*)"/u.exec(html)?.[1];
  if (found === undefined) throw new Error(`no auth_session_id in ${html.slice(0, 200)}`);
  return found;
}

async function authorize(t: T, jar: Map<string, string>, scope: string, extra = ''): Promise<Res> {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: 'portal',
    redirect_uri: REDIRECT,
    scope,
    state: 's',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    resource: t.resource,
  });
  const res = await stack.app.inject({
    method: 'GET',
    url: `/tenants/${t.name}/protocol/openid-connect/auth?${query.toString()}${extra}`,
    headers: { host: HOST, ...(jar.size === 0 ? {} : { cookie: cookie(jar) }) },
  });
  jarOf(jar, res);
  return res;
}

async function signIn(t: T, jar: Map<string, string>, page: Res): Promise<Res> {
  const res = await stack.app.inject({
    method: 'POST',
    url: `/tenants/${t.name}/login-actions/authenticate`,
    headers: { ...FORM, cookie: cookie(jar) },
    payload: new URLSearchParams({
      auth_session_id: field(page.body),
      username: t.username,
      password: PASSWORD,
    }).toString(),
  });
  jarOf(jar, res);
  return res;
}

async function decide(t: T, jar: Map<string, string>, page: Res, scopes: string[]): Promise<Res> {
  const body = new URLSearchParams({ auth_session_id: field(page.body), decision: 'allow' });
  for (const scope of scopes) body.append('scope', scope);
  const res = await stack.app.inject({
    method: 'POST',
    url: `/tenants/${t.name}/login-actions/consent`,
    headers: { ...FORM, cookie: cookie(jar) },
    payload: body.toString(),
  });
  jarOf(jar, res);
  return res;
}

const location = (res: Res): URL => new URL(String(res.headers.location));

async function scopeOfCode(t: T, res: Res): Promise<string> {
  const code = location(res).searchParams.get('code');
  expect(code, res.body.slice(0, 200)).not.toBeNull();
  const token = await stack.app.inject({
    method: 'POST',
    url: `/tenants/${t.name}/protocol/openid-connect/token`,
    headers: FORM,
    payload: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code ?? '',
      redirect_uri: REDIRECT,
      client_id: 'portal',
      code_verifier: VERIFIER,
      resource: t.resource,
    }).toString(),
  });
  expect(token.statusCode, token.body).toBe(200);
  return token.json<{ scope: string }>().scope;
}

describe('requesting mcp:write from a client that asks for no consent', () => {
  it('shows the consent page, and issues the scope only to a person who ticks it', async () => {
    const t = await tenant();
    const jar = new Map<string, string>();
    const login = await signIn(t, jar, await authorize(t, jar, 'openid mcp:write'));
    expect(login.statusCode).toBe(200);
    expect(login.body).toContain('value="mcp:write"');
    const declined = await decide(t, jar, login, []);
    expect(await scopeOfCode(t, declined)).toBe('openid');
  });

  it('still behaves as before for mcp:read: no consent page', async () => {
    const t = await tenant();
    const jar = new Map<string, string>();
    const login = await signIn(t, jar, await authorize(t, jar, 'openid mcp:read'));
    expect(login.statusCode).toBe(302);
    expect(await scopeOfCode(t, login)).toBe('openid mcp:read');
  });

  it('asks again after an approval, on a new sign-in and on a reused session, and does not tick the box', async () => {
    const t = await tenant();
    const jar = new Map<string, string>();
    const first = await signIn(t, jar, await authorize(t, jar, 'openid mcp:write'));
    const approved = await decide(t, jar, first, ['mcp:write']);
    expect(await scopeOfCode(t, approved)).toBe('openid mcp:write');

    const reused = await authorize(t, jar, 'openid mcp:write');
    expect(reused.statusCode).toBe(200);
    expect(reused.body).toContain('value="mcp:write"');
    expect(reused.body).not.toMatch(/value="mcp:write"[^>]*checked/u);

    const fresh = new Map<string, string>();
    const again = await signIn(t, fresh, await authorize(t, fresh, 'openid mcp:write'));
    expect(again.statusCode).toBe(200);
    expect(again.body).not.toMatch(/value="mcp:write"[^>]*checked/u);
  });

  it('answers consent_required to prompt=none, even with a session and an approval on record', async () => {
    const t = await tenant();
    const jar = new Map<string, string>();
    const first = await signIn(t, jar, await authorize(t, jar, 'openid mcp:write'));
    await decide(t, jar, first, ['mcp:write']);
    const silent = await authorize(t, jar, 'openid mcp:write', '&prompt=none');
    expect(silent.statusCode).toBe(302);
    expect(location(silent).searchParams.get('error')).toBe('consent_required');
    expect(location(silent).searchParams.get('code')).toBeNull();
  });
});
