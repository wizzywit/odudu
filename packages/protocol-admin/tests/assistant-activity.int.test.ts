import { ASSISTANT_SETTING_DEFAULTS, type AssistantActivityReplay } from '@odudu/contracts/admin';
import { newId } from '@odudu/kernel';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { type AssistantActivityStore } from '#/usecase/assistant-activity';

let fixture: AdminFixture | undefined;
function fx(): AdminFixture {
  if (fixture === undefined) throw new Error('fixture not started');
  return fixture;
}

const OWNER = newId();
const CONVERSATION = newId();
const WORDS = 'what the person asked';

const replay = (text: boolean): AssistantActivityReplay => ({
  conversation: {
    id: CONVERSATION,
    person: OWNER,
    person_username: null,
    profile: 'free-chat',
    mode: 'ask',
    started_at: new Date().toISOString(),
    last_active_at: new Date().toISOString(),
    reported_at: null,
  },
  asked: [{ at: new Date().toISOString(), text: text ? WORDS : '[withheld]' }],
  turns: [],
  turns_omitted: 0,
  approvals: [],
  text_visible: text,
});

const store: AssistantActivityStore = {
  list: (_tx, _filters, _cursor, _limit, text) =>
    Promise.resolve({
      items: [
        {
          id: CONVERSATION,
          person: OWNER,
          person_username: null,
          profile: 'free-chat',
          mode: 'ask',
          title: text ? 'A title' : '[withheld]',
          started_at: new Date().toISOString(),
          last_active_at: new Date().toISOString(),
          turns: 0,
          steps: 0,
          tokens: { fast: 0, standard: 0, deep: 0 },
          stop_reason: null,
          tools: [],
          approvals: 0,
          reported_at: null,
          report_old: false,
        },
      ],
      next: null,
    }),
  replay: (_tx, _tenant, _id, text) => Promise.resolve(replay(text)),
  export: () => Promise.resolve(null),
  report: () => Promise.resolve({ kind: 'missing' }),
};

beforeAll(async () => {
  fixture = await startAdminFixture({
    assistantActivity: store,
    assistantSettings: {
      read: () =>
        Promise.resolve({ ...ASSISTANT_SETTING_DEFAULTS, assistant_auditor_visible: true }),
      write: () => Promise.resolve(),
    },
  });
}, 180_000);
afterAll(async () => {
  await fixture?.stop();
});

async function textReads(tenantId: string): Promise<number> {
  const rows = await fx().owner.db.execute<{ n: number }>(
    sql`select count(*)::int as n from audit_events
         where tenant_id = ${tenantId} and action = 'assistant.text_read'`,
  );
  return rows[0]?.n ?? 0;
}

function get(tenant: string, token: string, tail: string) {
  return fx().http.inject({
    method: 'GET',
    url: `/admin/tenants/${tenant}/assistant/activity${tail}`,
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('a read of conversation text', () => {
  it('is recorded in the transaction of the read, and a record that cannot be written returns no text', async () => {
    const tenant = await fx().createTenant(`ac-${newId()}`);
    const token = await fx().adminToken(tenant.name, ['read-assistant-activity']);
    const ok = await get(tenant.name, token, `/conversations/${CONVERSATION}`);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.body).toContain(WORDS);
    expect(await textReads(tenant.id)).toBe(1);

    await fx().failNextWriteAfterAudit();
    const failed = await get(tenant.name, token, `/conversations/${CONVERSATION}`);
    expect(failed.statusCode).toBeGreaterThanOrEqual(500);
    expect(failed.body).not.toContain(WORDS);
    expect(await textReads(tenant.id)).toBe(1);
  });

  it('is recorded once for a list that returns titles, and fails closed the same way', async () => {
    const tenant = await fx().createTenant(`ac-${newId()}`);
    const token = await fx().adminToken(tenant.name, ['read-assistant-activity']);
    const ok = await get(tenant.name, token, '');
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.body).toContain('A title');
    expect(await textReads(tenant.id)).toBe(1);

    await fx().failNextWriteAfterAudit();
    const failed = await get(tenant.name, token, '');
    expect(failed.statusCode).toBeGreaterThanOrEqual(500);
    expect(failed.body).not.toContain('A title');
    expect(await textReads(tenant.id)).toBe(1);
  });
});
