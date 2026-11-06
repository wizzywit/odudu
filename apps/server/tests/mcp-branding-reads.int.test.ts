import { withTenant } from '@odudu/db';
import { messageOverrideRepository } from '@odudu/domain-tenant';
import { assetRepository, themeRepository, type ThemeBody } from '@odudu/domain-theme';
import type { ToolResult } from '@odudu/mcp';
import { createHash } from 'node:crypto';
import { makePng } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type McpStack, startMcpStack } from '#/testing/mcp-stack';
import type { World } from '#/testing/mcp-world';

// The eleven branding reads through the real endpoint, the real admin API and
// a real database: a theme with a draft and a published version is read whole,
// the draft's entity tag comes back beside it, and what stays withheld is
// still refused.

let stack: McpStack;

beforeAll(async () => {
  stack = await startMcpStack();
}, 120_000);

afterAll(async () => {
  await stack.close();
});

const READ = 'mcp:read';
const CAPS = ['manage-tenant', 'manage-clients'];
const KIB = 1024;
const ELEVEN = [
  'get_theme',
  'list_theme_versions',
  'get_theme_preview_info',
  'get_stylesheet_hooks',
  'get_mail_branding',
  'list_message_overrides',
  'get_message_catalogue',
  'get_client_theme',
  'list_client_theme_versions',
  'get_client_theme_preview_info',
  'get_client_mail_branding',
];
const TEMPLATE =
  '<div>{{t "login.title"}}{{error}}{{form.open}}{{fields}}{{submit}}{{form.close}}</div>';

function theme(parts: Partial<ThemeBody>): ThemeBody {
  return { tokens: {}, stylesheet: null, templates: {}, assets: {}, ...parts };
}

async function save(
  w: World,
  clientId: string | null,
  body: ThemeBody,
  publish: boolean,
): Promise<void> {
  await withTenant(stack.appDb.db, w.tenantId, async (tx) => {
    const themes = themeRepository(tx);
    const scope = { tenantId: w.tenantId, clientId };
    await themes.saveDraft(scope, body, (await themes.draft(scope))?.etag ?? null);
    if (publish) await themes.publish(scope);
  });
}

function data(result: ToolResult): Record<string, unknown> {
  expect(result.isError, JSON.stringify(result.structuredContent).slice(0, 400)).toBe(false);
  return (result.structuredContent as { data: Record<string, unknown> }).data;
}

function refusal(result: ToolResult): { type: string; status?: number; detail?: string } {
  expect(result.isError).toBe(true);
  return (result.structuredContent as { error: { type: string; status?: number } }).error;
}

async function listed(w: World, token: string): Promise<string[]> {
  const res = await stack.send(w, token, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {},
  });
  return (res.json().result as { tools: { name: string }[] }).tools.map((t) => t.name);
}

async function portalId(w: World, token: string): Promise<string> {
  const found = (await stack.call(w, token, 'list_clients', { client_id: 'portal' }))
    .structuredContent as { data: { id: string }[] };
  const id = found.data[0]?.id;
  if (id === undefined) throw new Error('no portal client');
  return id;
}

describe('a tenant administrator’s agent reading branding', () => {
  it('reads a published theme and a draft whole, with the draft’s etag beside them', async () => {
    const w = await stack.world(CAPS, READ);
    const token = await stack.sign(w, READ);
    const stylesheet = `.page { color: red; }\n/* ${'a'.repeat(100 * KIB)} */`;
    await save(w, null, theme({ stylesheet: '.page { color: blue; }' }), true);
    await save(w, null, theme({ stylesheet, templates: { 'sign-in': TEMPLATE } }), false);

    const result = await stack.call(w, token, 'get_theme', {});
    const view = data(result) as {
      draft: { stylesheet: string; templates: Record<string, string> };
      published: { version: number; body: { stylesheet: string } };
      changed: string[];
    };
    expect(view.draft.stylesheet).toBe(stylesheet);
    expect(view.draft.templates['sign-in']).toBe(TEMPLATE);
    expect(view.published.body.stylesheet).toBe('.page { color: blue; }');
    expect(view.changed).toEqual(expect.arrayContaining(['stylesheet', 'templates']));
    expect(result.structuredContent).not.toHaveProperty('truncated');
    expect(result.structuredContent.etag).toMatch(/^"[0-9a-f]+"$/u);

    const versions = data(await stack.call(w, token, 'list_theme_versions', {}));
    expect((versions.items as unknown[]).length).toBe(1);
  });

  it('answers no etag when the theme has no draft', async () => {
    const w = await stack.world(CAPS, READ);
    const token = await stack.sign(w, READ);
    const result = await stack.call(w, token, 'get_theme', {});
    expect(data(result)).toMatchObject({ draft: null, published: null });
    expect(result.structuredContent).not.toHaveProperty('etag');
  });

  it('reads the preview info, the hooks, the mail look and the catalogue', async () => {
    const w = await stack.world(CAPS, READ);
    const token = await stack.sign(w, READ);
    const info = data(
      await stack.call(w, token, 'get_theme_preview_info', { kind: 'consent', scheme: 'dark' }),
    );
    expect(info.kind).toBe('consent');
    const hooks = data(await stack.call(w, token, 'get_stylesheet_hooks', {}));
    expect(hooks.classes).toEqual(expect.arrayContaining([expect.any(String)]));
    expect(data(await stack.call(w, token, 'get_mail_branding', {}))).toHaveProperty('light');
    const catalogue = data(await stack.call(w, token, 'get_message_catalogue', {}));
    expect((catalogue.sections as unknown[]).length).toBeGreaterThan(0);
  });

  it('lists a locale’s message overrides a page at a time, each with its etag', async () => {
    const w = await stack.world(CAPS, READ);
    const token = await stack.sign(w, READ);
    await withTenant(stack.appDb.db, w.tenantId, async (tx) => {
      const overrides = messageOverrideRepository(tx, { isKnownKey: () => true });
      for (const key of ['login.title', 'login.submit', 'error.title']) {
        await overrides.put({ tenantId: w.tenantId, locale: 'en', key, message: `own ${key}` });
      }
    });
    const first = await stack.call(w, token, 'list_message_overrides', { locale: 'en', limit: 2 });
    const rows = data(first) as unknown as { message: string; etag: string }[];
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.etag.length > 0)).toBe(true);
    expect(first.structuredContent.next_cursor).toEqual(expect.any(String));
    const second = await stack.call(w, token, 'list_message_overrides', {
      locale: 'en',
      limit: 2,
      cursor: first.structuredContent.next_cursor,
    });
    expect(data(second) as unknown as unknown[]).toHaveLength(1);
  });

  it('reads a client’s theme, versions, preview info and mail look', async () => {
    const w = await stack.world(CAPS, READ);
    const token = await stack.sign(w, READ);
    const id = await portalId(w, token);
    await save(w, id, theme({ stylesheet: '.page { color: green; }' }), true);
    await save(w, id, theme({ templates: { consent: TEMPLATE } }), false);
    const result = await stack.call(w, token, 'get_client_theme', { id });
    const view = data(result) as {
      scope: string;
      draft: { templates: Record<string, string> };
      published: { body: { stylesheet: string } };
    };
    expect(view.scope).toBe('client');
    expect(view.draft.templates.consent).toBe(TEMPLATE);
    expect(view.published.body.stylesheet).toBe('.page { color: green; }');
    expect(result.structuredContent.etag).toMatch(/^"[0-9a-f]+"$/u);
    const versions = data(await stack.call(w, token, 'list_client_theme_versions', { id }));
    expect((versions.items as unknown[]).length).toBe(1);
    expect(
      data(await stack.call(w, token, 'get_client_theme_preview_info', { id, kind: 'consent' })),
    ).toHaveProperty('shown');
    expect(data(await stack.call(w, token, 'get_client_mail_branding', { id }))).toHaveProperty(
      'light',
    );
  });

  it('cannot read another tenant’s client theme by its id', async () => {
    const mine = await stack.world(CAPS, READ);
    const other = await stack.world(CAPS, READ);
    const otherToken = await stack.sign(other, READ);
    const theirs = await portalId(other, otherToken);
    const token = await stack.sign(mine, READ);
    for (const tool of ['get_client_theme', 'get_client_mail_branding']) {
      expect(refusal(await stack.call(mine, token, tool, { id: theirs })).status, tool).toBe(404);
    }
  });

  it('refuses a theme too large for one result, and says where to read it', async () => {
    const w = await stack.world(CAPS, READ);
    const token = await stack.sign(w, READ);
    const kinds = ['sign-in', 'consent', 'select-account', 'logout-confirm', 'notice'] as const;
    const body = (size: number) =>
      theme({
        stylesheet: `.page { color: red; }\n/* ${'s'.repeat(size)} */`,
        templates: Object.fromEntries(
          kinds.map((kind) => [kind, `<div>${'t'.repeat(size / 2)}</div>`]),
        ),
      });
    await save(w, null, body(100 * KIB), false);
    const error = refusal(await stack.call(w, token, 'get_theme', {}));
    expect(error.type).toBe('mcp:result_too_large');
    expect(error.detail).toContain('console');
  });

  it('refuses a theme past the admin read cap as the same problem', async () => {
    const w = await stack.world(CAPS, READ);
    const token = await stack.sign(w, READ);
    const kinds = [
      'sign-in',
      'consent',
      'select-account',
      'logout-confirm',
      'notice',
      'reset',
      'registration',
      'verification',
      'required-actions',
      'logged-out',
      'email-unverified',
      'authorize-error',
      'totp-enrolment',
      'passkey-enrolment',
      'recovery-codes',
      'update-password',
      'required-action',
    ] as const;
    const body = theme({
      stylesheet: `.page { color: red; }\n/* ${'s'.repeat(127 * KIB)} */`,
      templates: Object.fromEntries(
        kinds.map((kind) => [kind, `<div>${'t'.repeat(63 * KIB)}</div>`]),
      ),
    });
    await save(w, null, body, true);
    await save(w, null, theme({ ...body, stylesheet: '.page { color: blue; }' }), false);
    expect(refusal(await stack.call(w, token, 'get_theme', {})).type).toBe('mcp:result_too_large');
  });
});

describe('what an agent is not offered', () => {
  it('lists the client tools only to an owner holding manage-clients', async () => {
    const tenantOnly = await stack.world(['manage-tenant'], READ);
    const names = await listed(tenantOnly, await stack.sign(tenantOnly, READ));
    for (const tool of ELEVEN.filter((name) => !name.includes('client'))) {
      expect(names, tool).toContain(tool);
    }
    for (const tool of ELEVEN.filter((name) => name.includes('client'))) {
      expect(names, tool).not.toContain(tool);
    }
    const clientsOnly = await stack.world(['manage-clients'], READ);
    const clientNames = await listed(clientsOnly, await stack.sign(clientsOnly, READ));
    expect(clientNames).toContain('get_client_theme');
    expect(clientNames).toContain('get_stylesheet_hooks');
    expect(clientNames).not.toContain('get_theme');
  });

  it('refuses a client tool called by name without manage-clients', async () => {
    const w = await stack.world(['manage-tenant'], READ);
    const token = await stack.sign(w, READ);
    const full = await stack.world(CAPS, READ);
    const id = await portalId(full, await stack.sign(full, READ));
    expect(refusal(await stack.call(w, token, 'get_client_theme', { id })).status).toBe(403);
  });

  it('keeps the asset bytes refused at the door, whichever scope the token holds', async () => {
    const w = await stack.world(CAPS, 'mcp:read mcp:write');
    const bytes = makePng({ width: 16, height: 16 });
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const stored = await withTenant(stack.appDb.db, w.tenantId, (tx) =>
      assetRepository(tx).put({
        tenantId: w.tenantId,
        sha256,
        mime: 'image/png',
        width: 16,
        height: 16,
        bytes,
        tenantCapBytes: 8 * 1024 * 1024,
      }),
    );
    if (stored === 'over_cap') throw new Error('over cap');
    for (const scope of [['mcp:read'], ['mcp:write'], ['mcp:read', 'mcp:write']]) {
      const res = await stack.unguardedCaller(w, scope).call({
        method: 'GET',
        pattern: '/admin/tenants/:tenant/theme/assets/:assetId/content',
        params: { assetId: stored.id },
        query: {},
      });
      expect(res.status, scope.join(' ')).toBe(403);
    }
    const token = await stack.sign(w, 'mcp:read mcp:write');
    const names = await listed(w, token);
    expect(names.filter((name) => /asset|preview$|content/u.test(name))).toEqual([]);
  });
});
