import { withTenant } from '@odudu/db';
import { clientRepository, clients, MCP_CLIENT_ID } from '@odudu/domain-tenant';
import { themeRepository, type ThemeBody } from '@odudu/domain-theme';
import type { ToolResult } from '@odudu/mcp';
import { tokenGrants } from '@odudu/protocol-oidc';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type McpStack, startMcpStack } from '#/testing/mcp-stack';
import type { World } from '#/testing/mcp-world';

// The two theme draft tools through the real endpoint, the real admin API and a
// real database: what an agent holding `mcp:write` can prepare for a person to
// publish, and what keeps a draft from being what people see.

let stack: McpStack;

beforeAll(async () => {
  stack = await startMcpStack();
}, 120_000);

afterAll(async () => {
  await stack.close();
});

const OWNER = ['manage-tenant', 'manage-clients', 'view-audit'];
const WRITE = 'mcp:read mcp:write';
const BASE_HOST = 'id.example.com';
const REDIRECT_URI = 'https://app.example/callback';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

const SIGN_IN = (marker: string, pad = ''): string =>
  `<div class="${marker}"><p>${pad}</p>{{error}}{{form.open}}{{fields}}{{submit}}{{form.close}}</div>`;
const MESSAGE = (pad: string): string => `<div class="card"><p>${pad}</p>{{message}}</div>`;

const PALETTE = {
  surfacePage: '#ffffff',
  surfacePanel: '#ffffff',
  surfaceSunken: '#ffffff',
  inkPrimary: '#000000',
  inkMuted: '#767676',
  signalActive: '#ffffff',
  signalActiveInk: '#000000',
  signalDanger: '#ffffff',
  signalDangerInk: '#000000',
  borderStrong: '#949494',
  focusRing: '#949494',
};

interface Rec {
  readonly data: Record<string, unknown>;
  readonly etag?: string;
}

function recOf(result: ToolResult): Rec {
  expect(result.isError, JSON.stringify(result.structuredContent)).toBe(false);
  return result.structuredContent as unknown as Rec;
}

function errorOf(result: ToolResult): {
  type: string;
  title: string;
  status: number;
  detail?: string;
  errors?: Record<string, unknown>[];
} {
  expect(result.isError).toBe(true);
  return (result.structuredContent as { error: never }).error;
}

async function sessionOf(capabilities: readonly string[] = OWNER, scope = WRITE) {
  const w = await stack.world(capabilities, WRITE);
  return { w, token: await stack.sign(w, scope) };
}

const draftOf = (w: World, clientId: string | null = null) =>
  withTenant(stack.appDb.db, w.tenantId, (tx) =>
    themeRepository(tx).draft({ tenantId: w.tenantId, clientId }),
  );

const publishedOf = (w: World, clientId: string | null = null) =>
  withTenant(stack.appDb.db, w.tenantId, (tx) =>
    themeRepository(tx).published({ tenantId: w.tenantId, clientId }),
  );

// A draft or a published theme put in as a person's console edit would, which
// moves the draft's etag.
async function consoleSave(
  w: World,
  body: ThemeBody,
  options: { publish?: boolean; clientId?: string | null } = {},
) {
  await withTenant(stack.appDb.db, w.tenantId, async (tx) => {
    const themes = themeRepository(tx);
    const scope = { tenantId: w.tenantId, clientId: options.clientId ?? null };
    await themes.saveDraft(scope, body, (await themes.draft(scope))?.etag ?? null);
    if (options.publish === true) await themes.publish(scope);
  });
}

const grantUse = (w: World) =>
  withTenant(stack.appDb.db, w.tenantId, async (tx) => {
    const [row] = await tx
      .select({ writes: tokenGrants.agentWrites, creates: tokenGrants.agentCreates })
      .from(tokenGrants)
      .where(eq(tokenGrants.id, w.grantId));
    return row;
  });

const clientRow = (w: World, clientId: string) =>
  withTenant(stack.appDb.db, w.tenantId, async (tx) => {
    const [row] = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.clientId, clientId));
    if (row === undefined) throw new Error(`no client ${clientId}`);
    return row.id;
  });

async function signInPage(w: World): Promise<string> {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: 'portal',
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 's',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  const res = await stack.app.inject({
    url: `/tenants/${w.name}/protocol/openid-connect/auth?${query.toString()}`,
    headers: { host: BASE_HOST },
  });
  expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
  return res.body;
}

describe('update_theme_draft', () => {
  it('creates the first draft, then replaces it under the etag of get_theme, audited as the agent’s with the scope alone', async () => {
    const { w, token } = await sessionOf();
    const first = recOf(
      await stack.call(w, token, 'update_theme_draft', {
        tokens: { light: PALETTE, font: 'IBM Plex Mono' },
        stylesheet: '.page { color: red; }',
      }),
    );
    expect(first.data).toMatchObject({
      scope: 'tenant',
      draft: { stylesheet: '.page { color: red; }', tokens: { font: 'IBM Plex Mono' } },
    });
    const read = recOf(await stack.call(w, token, 'get_theme', {}));
    expect(read.etag).toBe(first.etag);
    const second = recOf(
      await stack.call(w, token, 'update_theme_draft', {
        if_match: read.etag,
        templates: { 'sign-in': SIGN_IN('agent') },
      }),
    );
    expect(second.etag).not.toBe(first.etag);
    const stored = await draftOf(w);
    expect(stored?.body).toMatchObject({
      stylesheet: '.page { color: red; }',
      templates: { 'sign-in': SIGN_IN('agent') },
      tokens: { font: 'IBM Plex Mono' },
    });
    const saved = await stack.auditRows(w, 'theme.draft_saved');
    expect(saved.map((row) => row.detail)).toEqual([{ scope: 'tenant' }, { scope: 'tenant' }]);
    for (const row of saved) {
      expect(row).toMatchObject({
        outcome: 'allowed',
        actorSubjectId: w.subjectId,
        actorClientId: w.agentDbId,
      });
    }
    const calls = await stack.auditRows(w, 'agent.tool_call');
    expect(calls.map((c) => [c.outcome, (c.detail as { tool: string }).tool])).toEqual([
      ['allowed', 'update_theme_draft'],
      ['allowed', 'get_theme'],
      ['allowed', 'update_theme_draft'],
    ]);
  });

  it('spends a create for the first draft and a mutating place for a replacement, and gives back a refused call', async () => {
    const { w, token } = await sessionOf();
    expect(await grantUse(w)).toEqual({ writes: 0, creates: 0 });
    const first = recOf(
      await stack.call(w, token, 'update_theme_draft', { stylesheet: '.page { color: red; }' }),
    );
    expect(await grantUse(w)).toEqual({ writes: 1, creates: 1 });
    // No etag with a draft there is the tool's 412, a 4xx that changed nothing.
    const refused = errorOf(
      await stack.call(w, token, 'update_theme_draft', { stylesheet: '.page { color: blue; }' }),
    );
    expect(refused.status).toBe(412);
    expect(await grantUse(w)).toEqual({ writes: 1, creates: 1 });
    recOf(
      await stack.call(w, token, 'update_theme_draft', {
        if_match: first.etag,
        stylesheet: '.page { color: blue; }',
      }),
    );
    expect(await grantUse(w)).toEqual({ writes: 2, creates: 1 });
  });

  it('starts a first draft from the published theme, so the parts it does not name carry over', async () => {
    const { w, token } = await sessionOf();
    await consoleSave(
      w,
      {
        tokens: { light: PALETTE },
        stylesheet: '.page { color: green; }',
        templates: {},
        assets: {},
      },
      { publish: true },
    );
    expect(await draftOf(w)).toBeNull();
    recOf(await stack.call(w, token, 'update_theme_draft', { tokens: { font: 'IBM Plex Mono' } }));
    expect((await draftOf(w))?.body).toMatchObject({
      tokens: { font: 'IBM Plex Mono' },
      stylesheet: '.page { color: green; }',
    });
    expect((await publishedOf(w))?.body.tokens).toMatchObject({ light: PALETTE });
  });

  it('leaves a part it was not given byte-identical on the stored form, a carriage return and a zero-width space included', async () => {
    const { w, token } = await sessionOf();
    const stylesheet = '.page { color: red; }\r\n/* a​b */\r\n';
    const templates = { 'sign-in': `${SIGN_IN('stored')}\r\n` };
    await consoleSave(w, { tokens: {}, stylesheet, templates, assets: {} });
    const before = await draftOf(w);
    expect(before?.body.stylesheet).toBe(stylesheet);
    const read = recOf(await stack.call(w, token, 'get_theme', {}));
    // What get_theme says is not what is stored: it is cleaned for the model.
    const shown = (read.data as { draft: { stylesheet: string } }).draft.stylesheet;
    expect(shown).not.toBe(stylesheet);
    const updated = recOf(
      await stack.call(w, token, 'update_theme_draft', {
        if_match: read.etag,
        tokens: { light: PALETTE },
      }),
    );
    expect(updated.data).toMatchObject({ scope: 'tenant' });
    const after = await draftOf(w);
    expect(after?.body.stylesheet).toBe(stylesheet);
    expect(after?.body.templates).toEqual(templates);
    expect(after?.body.tokens).toEqual({ light: PALETTE });
  });

  it('reads and writes back a draft of 500 KiB, changing only what was named, within the deadline', async () => {
    const { w, token } = await sessionOf();
    const pad = 'x'.repeat(60 * 1024);
    const templates = {
      'sign-in': SIGN_IN('big', pad),
      reset: SIGN_IN('big', pad),
      registration: SIGN_IN('big', pad),
      'update-password': SIGN_IN('big', pad),
      'required-action': MESSAGE(pad),
      'authorize-error': MESSAGE(pad),
      'email-unverified': MESSAGE(pad),
      notice: MESSAGE(pad),
    };
    const stylesheet = `${'/* pad */\n'.repeat(1_000)}.page { color: red; }\r\n`;
    await consoleSave(w, { tokens: {}, stylesheet, templates, assets: {} });
    const size = Buffer.byteLength(JSON.stringify((await draftOf(w))?.body));
    expect(size).toBeGreaterThan(490 * 1024);
    expect(size).toBeLessThan(512 * 1024);
    const started = Date.now();
    const read = await stack.call(w, token, 'get_theme', {});
    // The read for the model is refused as too large, which is why the tool reads for itself.
    expect(errorOf(read).type).toBe('mcp:result_too_large');
    const etag = await etagOf(w);
    const updated = recOf(
      await stack.call(w, token, 'update_theme_draft', {
        if_match: etag,
        tokens: { light: PALETTE },
      }),
    );
    expect(Date.now() - started).toBeLessThan(20_000);
    // Saved all the same; the answer says it does not repeat a draft it cannot carry.
    expect(updated.data).toMatchObject({ scope: 'tenant', draft: null, draft_omitted: true });
    const after = await draftOf(w);
    expect(after?.body.stylesheet).toBe(stylesheet);
    expect(after?.body.templates).toEqual(templates);
    expect(after?.body.tokens).toEqual({ light: PALETTE });
  });

  it('answers a stale etag, a console edit made since the read, as a 412 that says to read again, and keeps the edit', async () => {
    const { w, token } = await sessionOf();
    const first = recOf(
      await stack.call(w, token, 'update_theme_draft', { stylesheet: '.page { color: red; }' }),
    );
    await consoleSave(w, {
      tokens: {},
      stylesheet: '.page { color: purple; }',
      templates: {},
      assets: {},
    });
    const stale = errorOf(
      await stack.call(w, token, 'update_theme_draft', {
        if_match: first.etag,
        stylesheet: '.page { color: blue; }',
      }),
    );
    expect(stale).toMatchObject({ status: 412, title: 'Precondition Failed' });
    expect(stale.detail).toMatch(/Read it again with get_theme/u);
    expect((await draftOf(w))?.body.stylesheet).toBe('.page { color: purple; }');
    // Only the agent's first draft is a row: the console edit here went in below the API.
    expect(await stack.auditRows(w, 'theme.draft_saved')).toHaveLength(1);
  });

  it('answers a stylesheet or a template the admin API refuses as its 400 with the problems, capped, and writes nothing', async () => {
    const { w, token } = await sessionOf();
    const before = await draftOf(w);
    const stylesheet = Array.from(
      { length: 30 },
      () => '.nothing-like-a-hook { color: red; }',
    ).join('\n');
    const bad = errorOf(
      await stack.call(w, token, 'update_theme_draft', {
        stylesheet,
        templates: { 'sign-in': '<script>alert(1)</script>{{fields}}' },
      }),
    );
    expect(bad.status).toBe(400);
    expect(bad.errors?.length).toBe(10);
    expect(bad.errors?.every((entry) => typeof entry.path === 'string')).toBe(true);
    expect(JSON.stringify(bad).length).toBeLessThan(8_000);
    expect(await draftOf(w)).toEqual(before);
    expect(await stack.auditRows(w, 'theme.draft_saved')).toEqual([]);
  });

  it('is refused under mcp:read, and to an owner without manage-tenant, and nothing is written', async () => {
    const reader = await sessionOf(OWNER, 'mcp:read');
    // With a draft there, so that a tool which read first would have said "name the etag" and not why it was refused.
    await consoleSave(reader.w, {
      tokens: {},
      stylesheet: '.page { color: purple; }',
      templates: {},
      assets: {},
    });
    const refusedScope = await stack.call(reader.w, reader.token, 'update_theme_draft', {
      stylesheet: '.page { color: red; }',
    });
    expect(errorOf(refusedScope)).toMatchObject({ status: 403, type: 'mcp:insufficient_scope' });
    expect((await draftOf(reader.w))?.body.stylesheet).toBe('.page { color: purple; }');
    const clientsOnly = await sessionOf(['manage-clients', 'view-audit']);
    const refusedOwner = await stack.call(clientsOnly.w, clientsOnly.token, 'update_theme_draft', {
      stylesheet: '.page { color: red; }',
    });
    expect(errorOf(refusedOwner).status).toBe(403);
    expect(await draftOf(clientsOnly.w)).toBeNull();
    expect(await stack.auditRows(clientsOnly.w, 'theme.draft_saved')).toEqual([]);
  });

  it('is not what people see: the sign-in page still shows the published theme', async () => {
    const { w, token } = await sessionOf();
    await consoleSave(
      w,
      {
        tokens: {},
        stylesheet: null,
        templates: { 'sign-in': SIGN_IN('published-marker') },
        assets: {},
      },
      { publish: true },
    );
    const read = recOf(await stack.call(w, token, 'get_theme', {}));
    recOf(
      await stack.call(w, token, 'update_theme_draft', {
        if_match: read.etag,
        templates: { 'sign-in': SIGN_IN('draft-marker') },
        stylesheet: '.page { color: red; }',
      }),
    );
    const page = await signInPage(w);
    expect(page).toContain('published-marker');
    expect(page).not.toContain('draft-marker');
    expect((await publishedOf(w))?.version).toBe(1);
    expect((await draftOf(w))?.body.templates).toEqual({ 'sign-in': SIGN_IN('draft-marker') });
  });

  it('cannot publish, restore, discard or reset: there is no such tool, and the admin API is asked for none', async () => {
    const { w, token } = await sessionOf();
    const seen = stack.adminSeen.length;
    for (const name of [
      'publish_theme',
      'publish_theme_draft',
      'restore_theme_version',
      'discard_theme_draft',
      'reset_theme',
      'publish_client_theme',
    ]) {
      const result = await stack.call(w, token, name, {});
      expect(errorOf(result).type, name).toBe('jsonrpc:error');
    }
    expect(stack.adminSeen.slice(seen)).toEqual([]);
  });

  it('refuses a part of the wrong kind, a control character and an unknown member before any admin call', async () => {
    const { w, token } = await sessionOf();
    const seen = stack.adminSeen.length;
    for (const args of [
      {},
      { stylesheet: '.page { color: red; }\u0000' },
      { stylesheet: '/* ‮ */' },
      { templates: { admin: '<p>{{message}}</p>' } },
      { stylesheet: '.page { color: red; }', redirect_uris: ['https://evil.example/cb'] },
      { assets: { logo: { assetId: '0192a0a0-0000-7000-8000-0000000000aa', alt: 'x' } } },
    ]) {
      const result = await stack.call(w, token, 'update_theme_draft', args);
      expect(errorOf(result).type, JSON.stringify(args)).toBe('mcp:invalid_arguments');
    }
    expect(stack.adminSeen.slice(seen)).toEqual([]);
    expect(await draftOf(w)).toBeNull();
  });
});

async function etagOf(w: World): Promise<string> {
  const stored = await draftOf(w);
  if (stored === null) throw new Error('no draft');
  return `"${stored.etag}"`;
}

describe('update_client_theme_draft', () => {
  it('saves a custom client’s draft under its own etag, and leaves the tenant’s theme and every other client alone', async () => {
    const { w, token } = await sessionOf();
    const portal = await clientRow(w, 'portal');
    const first = recOf(
      await stack.call(w, token, 'update_client_theme_draft', {
        id: portal,
        stylesheet: '.page { color: red; }',
      }),
    );
    expect(first.data).toMatchObject({ scope: 'client' });
    const read = recOf(await stack.call(w, token, 'get_client_theme', { id: portal }));
    expect(read.etag).toBe(first.etag);
    recOf(
      await stack.call(w, token, 'update_client_theme_draft', {
        id: portal,
        if_match: read.etag,
        tokens: { light: PALETTE },
      }),
    );
    expect((await draftOf(w, portal))?.body).toMatchObject({
      stylesheet: '.page { color: red; }',
      tokens: { light: PALETTE },
    });
    expect(await draftOf(w)).toBeNull();
    const saved = await stack.auditRows(w, 'theme.draft_saved');
    expect(saved.map((row) => row.detail)).toEqual([{ scope: 'client' }, { scope: 'client' }]);
  });

  it('refuses the built-in admin client and the built-in MCP client, by id, and nothing is written', async () => {
    const { w, token } = await sessionOf();
    for (const id of [w.adminDbId, w.agentDbId]) {
      const refused = errorOf(
        await stack.call(w, token, 'update_client_theme_draft', {
          id,
          stylesheet: '.page { color: red; }',
        }),
      );
      expect(refused.status, id).toBe(403);
      expect(refused.detail, id).toMatch(/built-in/u);
      expect(await draftOf(w, id)).toBeNull();
    }
    expect(await stack.auditRows(w, 'theme.draft_saved')).toEqual([]);
    const agent = await withTenant(stack.appDb.db, w.tenantId, (tx) =>
      clientRepository(tx).byClientId(MCP_CLIENT_ID),
    );
    expect(agent?.id).toBe(w.agentDbId);
  });

  it('refuses the client of another tenant as not found, and writes nothing in either', async () => {
    const mine = await sessionOf();
    const theirs = await sessionOf();
    const foreign = await clientRow(theirs.w, 'portal');
    const refused = errorOf(
      await stack.call(mine.w, mine.token, 'update_client_theme_draft', {
        id: foreign,
        stylesheet: '.page { color: red; }',
      }),
    );
    expect(refused.status).toBe(404);
    expect(await draftOf(theirs.w, foreign)).toBeNull();
    expect(await draftOf(mine.w, foreign)).toBeNull();
  });

  it('is refused to an owner holding manage-tenant without manage-clients', async () => {
    const { w, token } = await sessionOf(['manage-tenant', 'view-audit']);
    const portal = await clientRow(w, 'portal');
    const refused = errorOf(
      await stack.call(w, token, 'update_client_theme_draft', {
        id: portal,
        stylesheet: '.page { color: red; }',
      }),
    );
    expect(refused.status).toBe(403);
    expect(await draftOf(w, portal)).toBeNull();
  });
});
