import { createDatabase } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture({ openApp: (url) => createDatabase(url, { max: 5 }) });
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

interface Refusal {
  readonly type?: string;
  readonly detail?: string;
  readonly errors?: readonly { path: string; message: string; code?: string }[];
}
interface FlowBody {
  id: string;
  name: string;
  is_default: boolean;
  client_count?: number;
}

const STEPS = [{ authenticator: 'password', requirement: 'required' }];

async function setup() {
  const t = await fixture.createTenant(`cf-${newId()}`);
  const token = await fixture.adminToken(t.name, ['manage-tenant', 'manage-clients', 'view-audit']);
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const url = (path: string) => `/admin/tenants/${t.name}${path}`;
  const send = (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ) =>
    fixture.http.inject({
      method,
      url: url(path),
      headers: body === undefined ? { authorization: `Bearer ${token}` } : headers,
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });
  const flow = async (name: string): Promise<FlowBody> => {
    const res = await send('POST', '/flows', { name, steps: STEPS });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<FlowBody>();
  };
  const createClient = (body: Record<string, unknown> = {}) =>
    send('POST', '/clients', {
      client_id: `c-${newId()}`,
      redirect_uris: ['https://app.example/callback'],
      ...body,
    });
  const read = (id: string) => send('GET', `/clients/${id}`);
  const patch = async (id: string, body: Record<string, unknown>) => {
    const etag = (await read(id)).headers.etag;
    return fixture.http.inject({
      method: 'PATCH',
      url: url(`/clients/${id}`),
      headers: { ...headers, ...(typeof etag === 'string' ? { 'if-match': etag } : {}) },
      payload: JSON.stringify(body),
    });
  };
  return { t, token, headers, send, flow, createClient, read, patch };
}

function codes(res: LightMyRequestResponse): (string | undefined)[] {
  return (res.json<Refusal>().errors ?? []).map((error) => error.code);
}

describe('flow_id on a client', () => {
  it('is null for a client that never set it, and is named at create and amend', async () => {
    const s = await setup();
    const staff = await s.flow('staff');
    const kiosk = await s.flow('kiosk');

    const plain = await s.createClient();
    expect(plain.statusCode, plain.body).toBe(201);
    expect(plain.json()).toMatchObject({ flow_id: null });

    const pinned = await s.createClient({ flow_id: staff.id });
    expect(pinned.statusCode, pinned.body).toBe(201);
    const { id } = pinned.json<{ id: string }>();
    expect((await s.read(id)).json()).toMatchObject({ flow_id: staff.id });

    const moved = await s.patch(id, { flow_id: kiosk.id });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json()).toMatchObject({ flow_id: kiosk.id });

    const cleared = await s.patch(id, { flow_id: null });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(cleared.json()).toMatchObject({ flow_id: null });
  });

  it('refuses a flow that does not exist, naming the field, and changes nothing', async () => {
    const s = await setup();
    const created = (await s.createClient()).json<{ id: string }>();
    const res = await s.patch(created.id, { flow_id: newId() });
    expect(res.statusCode, res.body).toBe(400);
    expect((res.json<Refusal>().errors ?? []).map((error) => error.path)).toEqual(['flow_id']);
    expect(codes(res)).toEqual(['unknown_flow']);
    expect((await s.read(created.id)).json()).toMatchObject({ flow_id: null });

    const onCreate = await s.createClient({ flow_id: newId() });
    expect(onCreate.statusCode, onCreate.body).toBe(400);
    expect(codes(onCreate)).toEqual(['unknown_flow']);
  });

  it('answers a flow of another tenant exactly as one that does not exist', async () => {
    const s = await setup();
    const other = await setup();
    const foreign = await other.flow('theirs');
    const created = (await s.createClient()).json<{ id: string }>();
    const res = await s.patch(created.id, { flow_id: foreign.id });
    expect(res.statusCode, res.body).toBe(400);
    expect(codes(res)).toEqual(['unknown_flow']);
    expect(res.json<Refusal>().detail).not.toContain(other.t.name);
    expect((await s.read(created.id)).json()).toMatchObject({ flow_id: null });
  });

  it('refuses a value that is neither a flow id nor null', async () => {
    const s = await setup();
    const created = (await s.createClient()).json<{ id: string }>();
    for (const bad of ['staff', 7, '']) {
      const res = await s.patch(created.id, { flow_id: bad });
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
      expect((res.json<Refusal>().errors ?? []).map((error) => error.path)).toEqual(['flow_id']);
    }
  });

  it('is not amendable on the console client that administrators sign in through', async () => {
    const s = await setup();
    const staff = await s.flow('staff');
    const listed = (await s.send('GET', '/clients?client_id=odudu-admin')).json<{
      items: { id: string }[];
    }>();
    const res = await s.patch(listed.items[0]?.id ?? '', { flow_id: staff.id });
    expect(res.statusCode, res.body).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });

  it('records the flow in the audit trail by value', async () => {
    const s = await setup();
    const staff = await s.flow('staff');
    const created = (await s.createClient()).json<{ id: string }>();
    await s.patch(created.id, { flow_id: staff.id });
    const audit = await s.send('GET', '/audit?action=client.amend');
    const row = audit
      .json<{ items: { resource_id: string; detail: unknown }[] }>()
      .items.find((item) => item.resource_id === created.id);
    expect(row?.detail).toMatchObject({ flow_id: { before: null, after: staff.id } });
  });
});

describe('deleting a flow a client names', () => {
  it('is refused with flow-in-use, naming the count and at most ten clients', async () => {
    const s = await setup();
    const staff = await s.flow('staff');
    const ids: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const res = await s.createClient({ flow_id: staff.id });
      ids.push(res.json<{ id: string }>().id);
    }
    const res = await s.send('DELETE', `/flows/${staff.id}`);
    expect(res.statusCode, res.body).toBe(409);
    const problem = res.json<Refusal>();
    expect(problem.type).toBe('about:blank#flow-in-use');
    expect(problem.detail).toContain('12 clients');
    const named = (problem.detail ?? '').match(/c-[0-9a-f-]+/g) ?? [];
    expect(named).toHaveLength(10);
    expect((await s.send('GET', `/flows/${staff.id}`)).statusCode).toBe(200);
  });

  it('is allowed once no client names it', async () => {
    const s = await setup();
    const staff = await s.flow('staff');
    const created = (await s.createClient({ flow_id: staff.id })).json<{ id: string }>();
    expect((await s.send('DELETE', `/flows/${staff.id}`)).statusCode).toBe(409);
    expect((await s.patch(created.id, { flow_id: null })).statusCode).toBe(200);
    expect((await s.send('DELETE', `/flows/${staff.id}`)).statusCode).toBe(204);
  });

  it('cannot leave a dangling reference when a client is pointed while the flow is deleted', async () => {
    const s = await setup();
    const staff = await s.flow('staff');
    const created = (await s.createClient()).json<{ id: string }>();

    let deletion: Promise<LightMyRequestResponse> | undefined;
    await fixture.owner.sql.begin(async (sql) => {
      await sql`update client_oidc_config set flow_id = ${staff.id} where client_id = ${created.id}`;
      deletion = s.send('DELETE', `/flows/${staff.id}`);
      for (let tries = 0; tries < 100; tries += 1) {
        const waiting = await sql`
          select 1 from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()`;
        if (waiting.length > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    });
    const res = await deletion;
    expect(res?.statusCode, res?.body).toBe(409);
    expect(res?.json<Refusal>().type).toBe('about:blank#flow-in-use');
    expect((await s.read(created.id)).json()).toMatchObject({ flow_id: staff.id });
  });
});

describe('GET /flows', () => {
  it('says how many clients name each flow', async () => {
    const s = await setup();
    const staff = await s.flow('staff');
    const kiosk = await s.flow('kiosk');
    await s.createClient({ flow_id: staff.id });
    await s.createClient({ flow_id: staff.id });
    await s.createClient({ flow_id: kiosk.id });
    await s.createClient();
    const listed = (await s.send('GET', '/flows')).json<{ items: FlowBody[] }>();
    expect(listed.items.map((item) => [item.name, item.client_count])).toEqual([
      ['default', 0],
      ['kiosk', 1],
      ['staff', 2],
    ]);
  });
});
