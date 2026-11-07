import { MESSAGE_OVERRIDE_LIMIT } from '@odudu/contracts/admin';
import { withTenant } from '@odudu/db';
import {
  messageOverrideRepository,
  TENANT_SETTING_NAMES,
  tenantSettingsRepository,
} from '@odudu/domain-tenant';
import type { ToolResult } from '@odudu/mcp';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type McpStack, startMcpStack } from '#/testing/mcp-stack';
import type { World } from '#/testing/mcp-world';

// The three wording tools through the real endpoint, the real admin API and a
// real database: what an agent holding `mcp:write` can say to people on the
// sign-in pages, and what refuses it.

let stack: McpStack;

beforeAll(async () => {
  stack = await startMcpStack();
}, 120_000);

afterAll(async () => {
  await stack.close();
});

const OWNER = ['manage-tenant', 'view-audit'];
const WRITE = 'mcp:read mcp:write';
const WORDING = ['display_name', 'supported_locales', 'default_locale'];

interface Rec {
  readonly data: Record<string, unknown>;
  readonly etag: string;
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
} {
  expect(result.isError).toBe(true);
  return (result.structuredContent as { error: never }).error;
}

async function sessionOf(capabilities: readonly string[] = OWNER) {
  const w = await stack.world(capabilities, WRITE);
  return { w, token: await stack.sign(w, WRITE) };
}

const rows = (w: World, action: string) => stack.auditRows(w, action);

const settingsOf = (w: World) =>
  withTenant(stack.appDb.db, w.tenantId, (tx) => tenantSettingsRepository(tx).byId(w.tenantId));

const overridesOf = (w: World) =>
  withTenant(stack.appDb.db, w.tenantId, (tx) =>
    messageOverrideRepository(tx, { isKnownKey: () => true }).all(w.tenantId),
  );

async function listed(w: World, token: string, locale: string) {
  const page = recOf(await stack.call(w, token, 'list_message_overrides', { locale }));
  return page.data as unknown as { key: string; message: string; etag: string }[];
}

describe('update_tenant_text_settings', () => {
  it('sets the display name and the languages under the etag of get_settings, and the row shows them before and after', async () => {
    const { w, token } = await sessionOf();
    const read = recOf(await stack.call(w, token, 'get_settings', {}));
    expect(read.data).toMatchObject({ display_name: null, supported_locales: ['en'] });
    const updated = recOf(
      await stack.call(w, token, 'update_tenant_text_settings', {
        if_match: read.etag,
        display_name: 'Acme',
        supported_locales: ['en', 'fr'],
        default_locale: 'fr',
      }),
    );
    expect(updated.data).toMatchObject({
      display_name: 'Acme',
      supported_locales: ['en', 'fr'],
      default_locale: 'fr',
    });
    expect(updated.etag).not.toBe(read.etag);
    const [row] = await rows(w, 'tenant.amend_settings');
    expect(row).toMatchObject({
      outcome: 'allowed',
      actorSubjectId: w.subjectId,
      actorClientId: w.agentDbId,
    });
    expect(row?.detail).toEqual({
      display_name: { before: null, after: 'Acme' },
      supported_locales: { before: ['en'], after: ['en', 'fr'] },
      default_locale: { before: null, after: 'fr' },
    });
    const calls = await rows(w, 'agent.tool_call');
    expect(calls.map((c) => [c.outcome, (c.detail as { tool: string }).tool])).toEqual([
      ['allowed', 'get_settings'],
      ['allowed', 'update_tenant_text_settings'],
    ]);
  });

  it('clears the display name and the default with an empty string, and sending the earlier values back undoes it', async () => {
    const { w, token } = await sessionOf();
    const first = recOf(await stack.call(w, token, 'get_settings', {}));
    const set = recOf(
      await stack.call(w, token, 'update_tenant_text_settings', {
        if_match: first.etag,
        display_name: 'Acme',
        supported_locales: ['en', 'fr'],
        default_locale: 'fr',
      }),
    );
    const cleared = recOf(
      await stack.call(w, token, 'update_tenant_text_settings', {
        if_match: set.etag,
        display_name: '',
        default_locale: '',
      }),
    );
    expect(cleared.data).toMatchObject({ display_name: null, default_locale: null });
    const back = recOf(
      await stack.call(w, token, 'update_tenant_text_settings', {
        if_match: cleared.etag,
        display_name: 'Acme',
        default_locale: 'fr',
      }),
    );
    expect(back.data).toMatchObject({ display_name: 'Acme', default_locale: 'fr' });
    expect((await rows(w, 'tenant.amend_settings')).map((r) => r.detail)).toContainEqual({
      display_name: { before: 'Acme', after: null },
      default_locale: { before: 'fr', after: null },
    });
  });

  it('answers a stale etag as a 412 that says to read again, and changes nothing', async () => {
    const { w, token } = await sessionOf();
    const read = recOf(await stack.call(w, token, 'get_settings', {}));
    recOf(
      await stack.call(w, token, 'update_tenant_text_settings', {
        if_match: read.etag,
        display_name: 'first',
      }),
    );
    const stale = errorOf(
      await stack.call(w, token, 'update_tenant_text_settings', {
        if_match: read.etag,
        display_name: 'second',
      }),
    );
    expect(stale).toMatchObject({ status: 412, title: 'Precondition Failed' });
    expect(stale.detail).toMatch(/get_settings/u);
    expect((await settingsOf(w))?.display_name).toBe('first');
  });

  it('is refused by the admin API for a default outside the list, a name past 256 and a list past 32, as it said it', async () => {
    const { w, token } = await sessionOf();
    const read = recOf(await stack.call(w, token, 'get_settings', {}));
    const before = await settingsOf(w);
    const outside = errorOf(
      await stack.call(w, token, 'update_tenant_text_settings', {
        if_match: read.etag,
        default_locale: 'de',
      }),
    );
    expect(outside.status).toBe(400);
    const long = errorOf(
      await stack.call(w, token, 'update_tenant_text_settings', {
        if_match: read.etag,
        display_name: 'x'.repeat(257),
      }),
    );
    expect(long.type).toBe('mcp:invalid_arguments');
    expect(await settingsOf(w)).toEqual(before);
    expect(await rows(w, 'tenant.amend_settings')).toEqual([]);
  });

  it('shrinks the languages below an override’s and leaves the override where it is, still listed and clearable', async () => {
    const { w, token } = await sessionOf();
    const read = recOf(await stack.call(w, token, 'get_settings', {}));
    const widened = recOf(
      await stack.call(w, token, 'update_tenant_text_settings', {
        if_match: read.etag,
        supported_locales: ['en', 'fr'],
      }),
    );
    recOf(
      await stack.call(w, token, 'set_message_override', {
        locale: 'fr',
        key: 'login.title',
        message: 'Connexion',
      }),
    );
    recOf(
      await stack.call(w, token, 'update_tenant_text_settings', {
        if_match: widened.etag,
        supported_locales: ['en'],
      }),
    );
    expect((await settingsOf(w))?.supported_locales).toEqual(['en']);
    const items = await listed(w, token, 'fr');
    expect(items.map((i) => [i.key, i.message])).toEqual([['login.title', 'Connexion']]);
    const gone = recOf(
      await stack.call(w, token, 'clear_message_override', {
        locale: 'fr',
        key: 'login.title',
        if_match: items[0]?.etag,
      }),
    );
    expect(gone.data).toEqual({ deleted: true });
  });
});

describe('set_message_override and clear_message_override', () => {
  it('create, replace and remove, and each audit row holds the text before and after', async () => {
    const { w, token } = await sessionOf();
    const made = recOf(
      await stack.call(w, token, 'set_message_override', {
        locale: 'fr',
        key: 'login.title',
        message: 'first wording',
      }),
    );
    expect(made.data).toMatchObject({ locale: 'fr', key: 'login.title', message: 'first wording' });
    expect(made.etag).toMatch(/^"[0-9a-f]{64}"$/u);
    const replaced = recOf(
      await stack.call(w, token, 'set_message_override', {
        locale: 'fr',
        key: 'login.title',
        message: 'second wording',
        if_match: made.etag,
      }),
    );
    expect(replaced.etag).not.toBe(made.etag);
    const [item] = await listed(w, token, 'fr');
    expect(item).toMatchObject({ key: 'login.title', message: 'second wording' });
    const removed = recOf(
      await stack.call(w, token, 'clear_message_override', {
        locale: 'fr',
        key: 'login.title',
        if_match: item?.etag,
      }),
    );
    expect(removed.data).toEqual({ deleted: true });
    expect(await overridesOf(w)).toEqual([]);
    expect((await rows(w, 'message_override.set')).map((r) => r.detail)).toEqual([
      { locale: 'fr', key: 'login.title', before: null, after: 'first wording' },
      { locale: 'fr', key: 'login.title', before: 'first wording', after: 'second wording' },
    ]);
    const [deleted] = await rows(w, 'message_override.delete');
    expect(deleted).toMatchObject({
      outcome: 'allowed',
      actorSubjectId: w.subjectId,
      actorClientId: w.agentDbId,
      detail: { locale: 'fr', key: 'login.title', before: 'second wording' },
    });
    const calls = await rows(w, 'agent.tool_call');
    expect(calls.map((c) => (c.detail as { tool: string }).tool)).toEqual([
      'set_message_override',
      'set_message_override',
      'list_message_overrides',
      'clear_message_override',
    ]);
  });

  it('put the cleared text back with the same call', async () => {
    const { w, token } = await sessionOf();
    const made = recOf(
      await stack.call(w, token, 'set_message_override', {
        locale: 'fr',
        key: 'login.title',
        message: 'Connexion',
      }),
    );
    recOf(
      await stack.call(w, token, 'clear_message_override', {
        locale: 'fr',
        key: 'login.title',
        if_match: made.etag,
      }),
    );
    const [deleted] = await rows(w, 'message_override.delete');
    const earlier = (deleted?.detail as { before: string }).before;
    recOf(
      await stack.call(w, token, 'set_message_override', {
        locale: 'fr',
        key: 'login.title',
        message: earlier,
      }),
    );
    expect((await overridesOf(w)).map((o) => o.message)).toEqual(['Connexion']);
  });

  it('refuse a create for a key that holds an override, and a stale etag, with a 412 that names the way on', async () => {
    const { w, token } = await sessionOf();
    const made = recOf(
      await stack.call(w, token, 'set_message_override', {
        locale: 'fr',
        key: 'login.title',
        message: 'one',
      }),
    );
    const clash = errorOf(
      await stack.call(w, token, 'set_message_override', {
        locale: 'fr',
        key: 'login.title',
        message: 'two',
      }),
    );
    expect(clash.status).toBe(412);
    expect(clash.detail).toMatch(/list_message_overrides/u);
    recOf(
      await stack.call(w, token, 'set_message_override', {
        locale: 'fr',
        key: 'login.title',
        message: 'three',
        if_match: made.etag,
      }),
    );
    const stale = errorOf(
      await stack.call(w, token, 'set_message_override', {
        locale: 'fr',
        key: 'login.title',
        message: 'four',
        if_match: made.etag,
      }),
    );
    expect(stale.status).toBe(412);
    const staleClear = errorOf(
      await stack.call(w, token, 'clear_message_override', {
        locale: 'fr',
        key: 'login.title',
        if_match: made.etag,
      }),
    );
    expect(staleClear.status).toBe(412);
    expect((await overridesOf(w)).map((o) => o.message)).toEqual(['three']);
  });

  it('answer the admin API’s own refusals: an unknown key, a text the page cannot fill, a missing override, a language that is no tag', async () => {
    const { w, token } = await sessionOf();
    const set = (args: Record<string, unknown>) =>
      stack.call(w, token, 'set_message_override', args);
    expect(errorOf(await set({ locale: 'fr', key: 'login.nonesuch', message: 'x' })).status).toBe(
      400,
    );
    expect(
      errorOf(await set({ locale: 'fr', key: 'login.title', message: 'a {oops' })).status,
    ).toBe(400);
    expect(
      errorOf(await set({ locale: 'fr', key: 'consent.heading', message: 'No client named' }))
        .status,
    ).toBe(400);
    expect(errorOf(await set({ locale: 'en_US', key: 'login.title', message: 'x' })).type).toBe(
      'mcp:invalid_arguments',
    );
    const missing = errorOf(
      await stack.call(w, token, 'clear_message_override', {
        locale: 'fr',
        key: 'login.title',
        if_match: `"${'0'.repeat(64)}"`,
      }),
    );
    expect(missing.status).toBe(404);
    expect(await overridesOf(w)).toEqual([]);
    expect(await rows(w, 'message_override.set')).toEqual([]);
  });

  it('are bounded per tenant by the admin API at 500, changing one that exists is still allowed, and clearing one makes room', async () => {
    const { w, token } = await sessionOf();
    await withTenant(stack.appDb.db, w.tenantId, async (tx) => {
      await tx.execute(
        sql`insert into message_overrides (tenant_id, locale, key, message)
            select ${w.tenantId}::uuid, 'fr', 'filler.' || g, 'x' from generate_series(1, ${MESSAGE_OVERRIDE_LIMIT - 1}) g`,
      );
    });
    expect(MESSAGE_OVERRIDE_LIMIT).toBe(500);
    const last = recOf(
      await stack.call(w, token, 'set_message_override', {
        locale: 'fr',
        key: 'login.title',
        message: 'the last',
      }),
    );
    expect(await overridesOf(w)).toHaveLength(500);
    const over = errorOf(
      await stack.call(w, token, 'set_message_override', {
        locale: 'fr',
        key: 'login.submit',
        message: 'one too many',
      }),
    );
    expect(over).toMatchObject({ status: 409 });
    expect(over.detail).toContain('500');
    recOf(
      await stack.call(w, token, 'set_message_override', {
        locale: 'fr',
        key: 'login.title',
        message: 'changed at the limit',
        if_match: last.etag,
      }),
    );
    expect(await overridesOf(w)).toHaveLength(500);
  });
});

describe('what the token and its owner decide', () => {
  const ETAG = `"${'0'.repeat(64)}"`;
  const ARGS: Record<string, Record<string, unknown>> = {
    update_tenant_text_settings: { if_match: ETAG, display_name: 'x' },
    set_message_override: { locale: 'fr', key: 'login.title', message: 'x' },
    clear_message_override: { locale: 'fr', key: 'login.title', if_match: ETAG },
  };

  it('refuses every tool to a read token, at the admin API itself when this layer lets it through', async () => {
    const { w } = await sessionOf();
    for (const [tool, args] of Object.entries(ARGS)) {
      const result = await stack.runUnguarded(w, ['mcp:read'], tool, args);
      expect(errorOf(result), tool).toMatchObject({
        status: 403,
        detail: expect.stringMatching(/^insufficient_scope/u) as unknown,
      });
    }
    const refusals = await rows(w, 'capability.refused');
    expect(refusals).toHaveLength(Object.keys(ARGS).length);
    for (const row of refusals) {
      expect(row).toMatchObject({
        outcome: 'refused',
        actorClientId: w.agentDbId,
        detail: { reason: 'insufficient_scope' },
      });
    }
    expect(await overridesOf(w)).toEqual([]);
  });

  it('refuses every tool by name to a read token, and the row says it was refused for its scope', async () => {
    const { w } = await sessionOf();
    const token = await stack.sign(w, 'mcp:read');
    for (const [tool, args] of Object.entries(ARGS)) {
      expect(errorOf(await stack.call(w, token, tool, args)), tool).toMatchObject({
        type: 'mcp:insufficient_scope',
        status: 403,
      });
    }
    const calls = await rows(w, 'agent.tool_call');
    expect(calls).toHaveLength(Object.keys(ARGS).length);
    for (const row of calls) {
      expect(row).toMatchObject({ outcome: 'refused', detail: { reason: 'insufficient_scope' } });
    }
  });

  it('refuses an owner who lacks manage-tenant, by the admin API, and records it', async () => {
    const { w, token } = await sessionOf(['view-audit', 'manage-clients']);
    for (const [tool, args] of Object.entries(ARGS)) {
      expect(errorOf(await stack.call(w, token, tool, args)), tool).toMatchObject({ status: 403 });
    }
    const refusals = await rows(w, 'capability.refused');
    expect(refusals).toHaveLength(Object.keys(ARGS).length);
    for (const row of refusals) {
      expect(row).toMatchObject({
        outcome: 'refused',
        actorSubjectId: w.subjectId,
        actorClientId: w.agentDbId,
        detail: { capability: 'manage-tenant', reason: 'missing_capability' },
      });
    }
    for (const action of ['tenant.amend_settings', 'message_override.set']) {
      expect(await rows(w, action), action).toEqual([]);
    }
    expect(await overridesOf(w)).toEqual([]);
  });

  it('lists the three tools, hinted, to a write token whose owner holds manage-tenant, and to no read token or other owner', async () => {
    const { w } = await sessionOf();
    const list = async (world: World, token: string) => {
      const res = await stack.send(world, token, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      });
      return (res.json().result as { tools: { name: string; annotations: unknown }[] }).tools;
    };
    const names = Object.keys(ARGS);
    const write = (await list(w, await stack.sign(w, 'mcp:write'))).filter((t) =>
      names.includes(t.name),
    );
    expect(write.map((t) => t.name).sort()).toEqual([...names].sort());
    for (const tool of write) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: tool.name === 'clear_message_override',
        idempotentHint: true,
      });
    }
    expect(
      (await list(w, await stack.sign(w, 'mcp:read'))).some((t) => names.includes(t.name)),
    ).toBe(false);
    const clientsOnly = await stack.world(['manage-clients'], WRITE);
    const seen = await list(clientsOnly, await stack.sign(clientsOnly, 'mcp:write'));
    expect(seen.filter((t) => names.includes(t.name))).toEqual([]);
  });
});

describe('a body sent to the admin API past the tools', () => {
  it('is refused whole for each of the other settings, three bodies each, and nothing changes', async () => {
    const { w } = await sessionOf();
    const read = recOf(await stack.runUnguarded(w, ['mcp:read'], 'get_settings', {}));
    const caller = stack.unguardedCaller(w, ['mcp:read', 'mcp:write']);
    const others = TENANT_SETTING_NAMES.filter((name) => !WORDING.includes(name));
    const before = await settingsOf(w);
    let refused = 0;
    for (const name of others) {
      for (const body of [
        { [name]: true },
        { display_name: 'Hijacked', [name]: true },
        { [name]: 1, default_locale: 'en' },
      ]) {
        const res = await caller.call({
          method: 'PATCH',
          pattern: '/admin/tenants/:tenant/settings',
          params: {},
          query: {},
          body,
          ifMatch: read.etag,
        });
        expect(res.status, JSON.stringify(body)).toBe(403);
        expect(res.body).toMatchObject({ detail: 'insufficient_scope' });
        refused += 1;
      }
    }
    expect(refused).toBe(others.length * 3);
    expect(await settingsOf(w)).toEqual(before);
    expect(await rows(w, 'tenant.amend_settings')).toEqual([]);
    expect(await rows(w, 'capability.refused')).toHaveLength(refused);
  });
});
