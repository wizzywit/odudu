import { registeredAuthenticatorNames, flowRepository } from '@odudu/authn-flows';
import { createDatabase, withTenant } from '@odudu/db';
import { TENANT_CAPABILITIES } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture, etagAt } from '#/testing/admin-fixture';

const statements: string[] = [];

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture({
    openApp: (url) =>
      createDatabase(url, {
        max: 5,
        onQueryForTests: (query) => {
          statements.push(query);
        },
      }),
  });
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

interface Step {
  authenticator: string;
  requirement: string;
}
interface FlowBody {
  id: string;
  name: string;
  is_default: boolean;
  steps: Step[];
}
interface Problem {
  type: string;
  status: number;
  detail?: string;
  errors?: { path: string; message: string }[];
}

const password: Step = { authenticator: 'password', requirement: 'required' };

async function tenantWithToken(capabilities: string[] = ['manage-tenant', 'view-audit']) {
  const t = await fixture.createTenant(`flows-${newId()}`);
  return { t, token: await fixture.adminToken(t.name, capabilities) };
}

function call(
  token: string,
  tenant: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  options: { body?: unknown; ifMatch?: string } = {},
) {
  return fixture.http.inject({
    method,
    url: `/admin/tenants/${tenant}/flows${path}`,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.ifMatch === undefined ? {} : { 'if-match': options.ifMatch }),
    },
    ...(options.body === undefined ? {} : { payload: JSON.stringify(options.body) }),
  });
}

async function create(token: string, tenant: string, name: string, steps: Step[] = [password]) {
  const res = await call(token, tenant, 'POST', '', { body: { name, steps } });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<FlowBody>();
}

async function remove(token: string, tenant: string, id: string) {
  const ifMatch = await etagAt(fixture.http, `/admin/tenants/${tenant}/flows/${id}`, token);
  return call(token, tenant, 'DELETE', `/${id}`, { ifMatch });
}

async function put(token: string, tenant: string, id: string, body: unknown) {
  const ifMatch = await etagAt(fixture.http, `/admin/tenants/${tenant}/flows/${id}`, token);
  return call(token, tenant, 'PUT', `/${id}`, { body, ifMatch });
}

async function auditActions(token: string, tenant: string, action: string) {
  const res = await fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${tenant}/audit?action=${action}`,
    headers: { authorization: `Bearer ${token}` },
  });
  return res
    .json<{ items: { outcome: string; resource_id: string; detail: unknown }[] }>()
    .items.map((item) => ({
      outcome: item.outcome,
      resourceId: item.resource_id,
      detail: item.detail,
    }));
}

describe('GET /admin/tenants/{t}/flows', () => {
  it('lists the default flow with the total and the registry names, ordered by name', async () => {
    const { t, token } = await tenantWithToken();
    await create(token, t.name, 'staff');
    await create(token, t.name, 'admins');

    const res = await call(token, t.name, 'GET', '');
    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: FlowBody[]; total: number; available: string[] }>();
    expect(body.items.map((flow) => [flow.name, flow.is_default])).toEqual([
      ['admins', false],
      ['default', true],
      ['staff', false],
    ]);
    expect(body.total).toBe(3);
    expect(body.available).toEqual([...registeredAuthenticatorNames()]);
  });

  it('answers an ETag that follows the flows', async () => {
    const { t, token } = await tenantWithToken();
    const before = (await call(token, t.name, 'GET', '')).headers.etag;
    expect(before).toBe((await call(token, t.name, 'GET', '')).headers.etag);
    await create(token, t.name, 'staff');
    expect((await call(token, t.name, 'GET', '')).headers.etag).not.toBe(before);
  });

  it('is refused for every capability but manage-tenant', async () => {
    const t = await fixture.createTenant(`flows-${newId()}`);
    for (const capability of TENANT_CAPABILITIES) {
      if (capability === 'manage-tenant') continue;
      const token = await fixture.adminToken(t.name, [capability]);
      expect((await call(token, t.name, 'GET', '')).statusCode, capability).toBe(403);
    }
  });
});

describe('the statements a flow route sends', () => {
  async function sent(run: () => Promise<{ statusCode: number }>): Promise<number> {
    const from = statements.length;
    const res = await run();
    expect(res.statusCode).toBeLessThan(300);
    return statements.length - from;
  }

  it('are the same however many flows the tenant holds, for every route', async () => {
    const { t, token } = await tenantWithToken();
    const body = { name: 'probe', steps: [password] };
    const measure = async (name: string, id: string | null) => {
      const made = await sent(() =>
        call(token, t.name, 'POST', '', { body: { ...body, name: `a-${name}` } }),
      );
      const flowId = id ?? (await create(token, t.name, `b-${name}`)).id;
      const etag = await etagAt(fixture.http, `/admin/tenants/${t.name}/flows/${flowId}`, token);
      return {
        list: await sent(() => call(token, t.name, 'GET', '')),
        read: await sent(() => call(token, t.name, 'GET', `/${flowId}`)),
        made,
        replaced: await sent(() =>
          call(token, t.name, 'PUT', `/${flowId}`, {
            body: { ...body, name: `c-${name}` },
            ifMatch: etag,
          }),
        ),
        removed: await sent(() => remove(token, t.name, flowId)),
      };
    };
    const few = await measure('few', null);
    for (let n = 1; n < 17; n += 1) await create(token, t.name, `flow-${String(n)}`);
    const many = await measure('many', null);
    expect(many).toEqual(few);
  });
});

describe('POST /admin/tenants/{t}/flows', () => {
  it('creates a non-default flow, trimming the name, and answers its ETag', async () => {
    const { t, token } = await tenantWithToken();
    const res = await call(token, t.name, 'POST', '', {
      body: { name: '  staff  ', steps: [password] },
    });
    expect(res.statusCode, res.body).toBe(201);
    const flow = res.json<FlowBody>();
    expect(flow).toMatchObject({ name: 'staff', is_default: false, steps: [password] });
    expect(res.headers.etag).toBe((await call(token, t.name, 'GET', `/${flow.id}`)).headers.etag);
  });

  it('refuses a duplicate name with flow-name-taken, in its own tenant only', async () => {
    const { t, token } = await tenantWithToken();
    await create(token, t.name, 'staff');
    const again = await call(token, t.name, 'POST', '', {
      body: { name: 'staff', steps: [password] },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json<Problem>().type).toBe('about:blank#flow-name-taken');

    const other = await tenantWithToken();
    await create(other.token, other.t.name, 'staff');
  });

  it('refuses the name default, held by the default flow, the same way', async () => {
    const { t, token } = await tenantWithToken();
    const res = await call(token, t.name, 'POST', '', {
      body: { name: 'default', steps: [password] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<Problem>().type).toBe('about:blank#flow-name-taken');
  });

  it('refuses a name that is empty, blank or past 64 characters with a field path', async () => {
    const { t, token } = await tenantWithToken();
    for (const name of ['', '   ', 'x'.repeat(65)]) {
      const res = await call(token, t.name, 'POST', '', { body: { name, steps: [password] } });
      expect(res.statusCode, name).toBe(400);
      expect(res.json<Problem>().errors?.[0]?.path).toBe('name');
    }
  });

  it('refuses steps past twenty, an unknown field and is_default with a field path', async () => {
    const { t, token } = await tenantWithToken();
    const many = await call(token, t.name, 'POST', '', {
      body: { name: 'a', steps: Array.from({ length: 21 }, () => password) },
    });
    expect(many.statusCode).toBe(400);
    expect(many.json<Problem>().errors?.[0]?.path).toBe('steps');

    const extra = await call(token, t.name, 'POST', '', {
      body: { name: 'a', steps: [{ ...password, index: 0 }] },
    });
    expect(extra.statusCode).toBe(400);

    const asDefault = await call(token, t.name, 'POST', '', {
      body: { name: 'a', steps: [password], is_default: true },
    });
    expect(asDefault.statusCode).toBe(400);
  });

  it('rejects a structurally ambiguous step list at save time, as the default flow does', async () => {
    const { t, token } = await tenantWithToken();
    const refusal = async (steps: Step[]) =>
      (await call(token, t.name, 'POST', '', { body: { name: 'a', steps } })).json<Problem>();

    expect((await refusal([])).type).toBe('about:blank#flow-empty');
    expect((await refusal([{ authenticator: 'password', requirement: 'disabled' }])).type).toBe(
      'about:blank#flow-no-enabled-step',
    );
    expect((await refusal([{ authenticator: 'passkey', requirement: 'required' }])).type).toBe(
      'about:blank#flow-no-first-challenge',
    );
    const unknown = await refusal([{ authenticator: 'bogus', requirement: 'required' }]);
    expect(unknown.type).toBe('about:blank#flow-unknown-authenticator');
    expect(unknown.errors?.[0]?.path).toBe('steps[0].authenticator');
    const repeated = await refusal([password, password]);
    expect(repeated.type).toBe('about:blank#flow-duplicate-authenticator');
    expect(repeated.errors?.[0]?.path).toBe('steps[1].authenticator');
  });

  it('refuses the twenty-first flow with flow-limit naming the cap', async () => {
    const { t, token } = await tenantWithToken();
    for (let n = 1; n < 20; n += 1) await create(token, t.name, `flow-${String(n)}`);

    const res = await call(token, t.name, 'POST', '', {
      body: { name: 'one-too-many', steps: [password] },
    });
    expect(res.statusCode).toBe(409);
    const problem = res.json<Problem>();
    expect(problem.type).toBe('about:blank#flow-limit');
    expect(problem.detail).toContain('20');
    expect((await call(token, t.name, 'GET', '')).json<{ total: number }>().total).toBe(20);
  });

  it('lets exactly one of two concurrent creates win at nineteen flows', async () => {
    const { t, token } = await tenantWithToken();
    for (let n = 1; n < 19; n += 1) await create(token, t.name, `flow-${String(n)}`);

    const results = await Promise.all(
      ['left', 'right'].map((name) =>
        call(token, t.name, 'POST', '', { body: { name, steps: [password] } }),
      ),
    );
    expect(results.map((res) => res.statusCode).sort()).toEqual([201, 409]);
    const total = await withTenant(fixture.app.db, t.id, (tx) =>
      flowRepository(tx).countForTenant(t.id),
    );
    expect(total).toBe(20);
  });

  it('records flow.create with the name and steps by value', async () => {
    const { t, token } = await tenantWithToken();
    const flow = await create(token, t.name, 'staff');
    expect(await auditActions(token, t.name, 'flow.create')).toEqual([
      {
        outcome: 'allowed',
        resourceId: flow.id,
        detail: {
          name: { after: 'staff' },
          steps: { after: [password] },
        },
      },
    ]);
  });

  it('is refused for every capability but manage-tenant', async () => {
    const t = await fixture.createTenant(`flows-${newId()}`);
    for (const capability of TENANT_CAPABILITIES) {
      if (capability === 'manage-tenant') continue;
      const token = await fixture.adminToken(t.name, [capability]);
      const res = await call(token, t.name, 'POST', '', {
        body: { name: 'x', steps: [password] },
      });
      expect(res.statusCode, capability).toBe(403);
    }
  });
});

describe('GET /admin/tenants/{t}/flows/{id}', () => {
  it('answers the flow with an ETag, and 404s an unknown id', async () => {
    const { t, token } = await tenantWithToken();
    const flow = await create(token, t.name, 'staff');
    const read = await call(token, t.name, 'GET', `/${flow.id}`);
    expect(read.statusCode).toBe(200);
    expect(read.json<FlowBody>()).toEqual(flow);
    expect(typeof read.headers.etag).toBe('string');

    expect((await call(token, t.name, 'GET', `/${newId()}`)).statusCode).toBe(404);
  });

  it('404s a flow of another tenant, on every route that takes an id', async () => {
    const mine = await tenantWithToken();
    const theirs = await tenantWithToken();
    const foreign = await create(theirs.token, theirs.t.name, 'theirs');

    expect((await call(mine.token, mine.t.name, 'GET', `/${foreign.id}`)).statusCode).toBe(404);
    expect(
      (
        await call(mine.token, mine.t.name, 'PUT', `/${foreign.id}`, {
          body: { name: 'taken', steps: [password] },
          ifMatch: '"x"',
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await call(mine.token, mine.t.name, 'DELETE', `/${foreign.id}`, { ifMatch: '"x"' }))
        .statusCode,
    ).toBe(404);

    const still = await call(theirs.token, theirs.t.name, 'GET', `/${foreign.id}`);
    expect(still.json<FlowBody>().name).toBe('theirs');
  });
});

describe('PUT /admin/tenants/{t}/flows/{id}', () => {
  it('replaces the name and steps, keeping the id and the flag', async () => {
    const { t, token } = await tenantWithToken();
    const flow = await create(token, t.name, 'staff');
    const res = await put(token, t.name, flow.id, {
      name: 'crew',
      steps: [password, { authenticator: 'otp', requirement: 'conditional' }],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<FlowBody>()).toMatchObject({
      id: flow.id,
      name: 'crew',
      is_default: false,
      steps: [password, { authenticator: 'otp', requirement: 'conditional' }],
    });
  });

  it('edits the default flow in place, which stays the default', async () => {
    const { t, token } = await tenantWithToken();
    const list = (await call(token, t.name, 'GET', '')).json<{ items: FlowBody[] }>();
    const fallback = list.items.find((flow) => flow.is_default);
    const res = await put(token, t.name, fallback?.id ?? '', { name: 'main', steps: [password] });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<FlowBody>()).toMatchObject({ name: 'main', is_default: true });
    const executions = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/flow/executions`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(executions.json<{ items: Step[] }>().items).toHaveLength(1);
  });

  it('requires If-Match: 428 without, 412 when stale', async () => {
    const { t, token } = await tenantWithToken();
    const flow = await create(token, t.name, 'staff');
    const body = { name: 'staff', steps: [password] };
    expect((await call(token, t.name, 'PUT', `/${flow.id}`, { body })).statusCode).toBe(428);
    expect(
      (await call(token, t.name, 'PUT', `/${flow.id}`, { body, ifMatch: '*' })).statusCode,
    ).toBe(428);
    expect(
      (await call(token, t.name, 'PUT', `/${flow.id}`, { body, ifMatch: '"stale"' })).statusCode,
    ).toBe(412);
  });

  it('refuses a name another flow holds with flow-name-taken, and changes nothing', async () => {
    const { t, token } = await tenantWithToken();
    await create(token, t.name, 'admins');
    const flow = await create(token, t.name, 'staff');
    const res = await put(token, t.name, flow.id, { name: 'admins', steps: [password] });
    expect(res.statusCode).toBe(409);
    expect(res.json<Problem>().type).toBe('about:blank#flow-name-taken');
    expect((await call(token, t.name, 'GET', `/${flow.id}`)).json<FlowBody>().name).toBe('staff');
  });

  it('keeps its own name without conflict and rejects an ambiguous list', async () => {
    const { t, token } = await tenantWithToken();
    const flow = await create(token, t.name, 'staff');
    expect(
      (await put(token, t.name, flow.id, { name: 'staff', steps: [password] })).statusCode,
    ).toBe(200);
    const bad = await put(token, t.name, flow.id, { name: 'staff', steps: [password, password] });
    expect(bad.statusCode).toBe(400);
    expect(bad.json<Problem>().type).toBe('about:blank#flow-duplicate-authenticator');
  });

  it('records flow.amend as a redacted diff of name and steps', async () => {
    const { t, token } = await tenantWithToken();
    const flow = await create(token, t.name, 'staff');
    await put(token, t.name, flow.id, { name: 'crew', steps: [password] });
    expect(await auditActions(token, t.name, 'flow.amend')).toEqual([
      {
        outcome: 'allowed',
        resourceId: flow.id,
        detail: { name: { before: 'staff', after: 'crew' } },
      },
    ]);
  });
});

describe('DELETE /admin/tenants/{t}/flows/{id}', () => {
  it('checks in order: a missing flow is 404 even with no header, the default is 428 or 412 before 409', async () => {
    const { t, token } = await tenantWithToken();
    expect((await call(token, t.name, 'DELETE', `/${newId()}`)).statusCode).toBe(404);
    const fallback = (await call(token, t.name, 'GET', '')).json<{ items: FlowBody[] }>().items[0];
    const path = `/${fallback?.id ?? ''}`;
    expect((await call(token, t.name, 'DELETE', path)).statusCode).toBe(428);
    expect((await call(token, t.name, 'DELETE', path, { ifMatch: '"stale"' })).statusCode).toBe(
      412,
    );
    const tag = await etagAt(fixture.http, `/admin/tenants/${t.name}/flows${path}`, token);
    expect((await call(token, t.name, 'DELETE', path, { ifMatch: tag })).statusCode).toBe(409);
  });

  it('serialises a delete against a replacement made on the same tag: one wins, the other sees it', async () => {
    const { t, token } = await tenantWithToken();
    const flow = await create(token, t.name, 'staff');
    const tag = await etagAt(fixture.http, `/admin/tenants/${t.name}/flows/${flow.id}`, token);
    const [replaced, deleted] = await Promise.all([
      call(token, t.name, 'PUT', `/${flow.id}`, {
        body: { name: 'crew', steps: [password] },
        ifMatch: tag,
      }),
      call(token, t.name, 'DELETE', `/${flow.id}`, { ifMatch: tag }),
    ]);
    const outcomes = [replaced.statusCode, deleted.statusCode];
    const after = await call(token, t.name, 'GET', `/${flow.id}`);
    if (deleted.statusCode === 204) {
      expect(outcomes).toEqual([404, 204]);
      expect(after.statusCode).toBe(404);
    } else {
      expect(outcomes).toEqual([200, 412]);
      expect(after.json<FlowBody>().name).toBe('crew');
    }
  });

  it('requires If-Match: 428 without or with *, 412 for a flow changed since it was read', async () => {
    const { t, token } = await tenantWithToken();
    const flow = await create(token, t.name, 'staff');
    const seen = await etagAt(fixture.http, `/admin/tenants/${t.name}/flows/${flow.id}`, token);
    const absent = await call(token, t.name, 'DELETE', `/${flow.id}`);
    expect(absent.statusCode).toBe(428);
    expect(absent.json<Problem>().detail).toBe('If-Match is required to delete a flow');
    expect((await call(token, t.name, 'DELETE', `/${flow.id}`, { ifMatch: '*' })).statusCode).toBe(
      428,
    );
    expect(
      (await put(token, t.name, flow.id, { name: 'crew', steps: [password] })).statusCode,
    ).toBe(200);
    expect((await call(token, t.name, 'DELETE', `/${flow.id}`, { ifMatch: seen })).statusCode).toBe(
      412,
    );
    expect((await call(token, t.name, 'GET', `/${flow.id}`)).statusCode).toBe(200);
  });

  it('deletes a non-default flow and records flow.delete', async () => {
    const { t, token } = await tenantWithToken();
    const flow = await create(token, t.name, 'staff');
    expect((await remove(token, t.name, flow.id)).statusCode).toBe(204);
    expect((await call(token, t.name, 'GET', `/${flow.id}`)).statusCode).toBe(404);
    expect((await auditActions(token, t.name, 'flow.delete')).map((row) => row.outcome)).toEqual([
      'allowed',
    ]);
  });

  it('refuses the default flow with default-flow and keeps it', async () => {
    const { t, token } = await tenantWithToken();
    const list = (await call(token, t.name, 'GET', '')).json<{ items: FlowBody[] }>();
    const fallback = list.items.find((flow) => flow.is_default);
    const res = await remove(token, t.name, fallback?.id ?? '');
    expect(res.statusCode).toBe(409);
    expect(res.json<Problem>().type).toBe('about:blank#default-flow');
    expect((await call(token, t.name, 'GET', '')).json<{ total: number }>().total).toBe(1);
  });

  it('is refused for every capability but manage-tenant', async () => {
    const { t, token } = await tenantWithToken();
    const flow = await create(token, t.name, 'staff');
    for (const capability of TENANT_CAPABILITIES) {
      if (capability === 'manage-tenant') continue;
      const other = await fixture.adminToken(t.name, [capability]);
      expect(
        (await call(other, t.name, 'DELETE', `/${flow.id}`, { ifMatch: '"x"' })).statusCode,
        capability,
      ).toBe(403);
    }
  });
});

describe('POST /admin/tenants/{t}/flows/{id}/make-default', () => {
  async function promote(token: string, tenant: string, id: string, ifMatch?: string) {
    const tag =
      ifMatch ?? (await etagAt(fixture.http, `/admin/tenants/${tenant}/flows/${id}`, token));
    return call(token, tenant, 'POST', `/${id}/make-default`, { ifMatch: tag });
  }

  async function defaults(token: string, tenant: string): Promise<string[]> {
    const list = (await call(token, tenant, 'GET', '')).json<{ items: FlowBody[] }>().items;
    return list.filter((flow) => flow.is_default).map((flow) => flow.name);
  }

  it('makes another flow the default, leaving exactly one, and answers its ETag', async () => {
    const { t, token } = await tenantWithToken();
    const staff = await create(token, t.name, 'staff', [
      { authenticator: 'password', requirement: 'required' },
    ]);
    const res = await promote(token, t.name, staff.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<FlowBody>()).toMatchObject({ id: staff.id, is_default: true });
    expect(res.headers.etag).toBe((await call(token, t.name, 'GET', `/${staff.id}`)).headers.etag);
    expect(await defaults(token, t.name)).toEqual(['staff']);
    const executions = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/flow/executions`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(executions.json<{ items: Step[] }>().items).toHaveLength(1);
  });

  it('lets the former default be deleted, and refuses deleting the new one', async () => {
    const { t, token } = await tenantWithToken();
    const former = (await call(token, t.name, 'GET', ''))
      .json<{ items: FlowBody[] }>()
      .items.find((flow) => flow.is_default);
    const staff = await create(token, t.name, 'staff');
    await promote(token, t.name, staff.id);
    expect((await remove(token, t.name, staff.id)).statusCode).toBe(409);
    expect((await remove(token, t.name, former?.id ?? '')).statusCode).toBe(204);
  });

  it('requires If-Match: 428 without or with *, 412 when stale', async () => {
    const { t, token } = await tenantWithToken();
    const staff = await create(token, t.name, 'staff');
    const url = `/${staff.id}/make-default`;
    const absent = await call(token, t.name, 'POST', url);
    expect(absent.statusCode).toBe(428);
    expect(absent.json<Problem>().detail).toBe('If-Match is required to make a flow the default');
    expect((await call(token, t.name, 'POST', url, { ifMatch: '*' })).statusCode).toBe(428);
    expect((await call(token, t.name, 'POST', url, { ifMatch: '"stale"' })).statusCode).toBe(412);
    expect(await defaults(token, t.name)).toEqual(['default']);
  });

  it('leaves exactly one default when two flows are promoted at once', async () => {
    const { t, token } = await tenantWithToken();
    const left = await create(token, t.name, 'left');
    const right = await create(token, t.name, 'right');
    const [a, b] = await Promise.all([
      promote(token, t.name, left.id),
      promote(token, t.name, right.id),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 200]);
    const named = await defaults(token, t.name);
    expect(named).toHaveLength(1);
    expect(['left', 'right']).toContain(named[0]);
  });

  it('is idempotent for the flow that is already the default, and writes no audit row', async () => {
    const { t, token } = await tenantWithToken();
    const fallback = (await call(token, t.name, 'GET', '')).json<{ items: FlowBody[] }>().items[0];
    const res = await promote(token, t.name, fallback?.id ?? '');
    expect(res.statusCode).toBe(200);
    expect(res.json<FlowBody>().is_default).toBe(true);
    expect(await auditActions(token, t.name, 'flow.default_set')).toEqual([]);
  });

  it('records flow.default_set as the flow gaining the default', async () => {
    const { t, token } = await tenantWithToken();
    const staff = await create(token, t.name, 'staff');
    await promote(token, t.name, staff.id);
    expect(await auditActions(token, t.name, 'flow.default_set')).toEqual([
      {
        outcome: 'allowed',
        resourceId: staff.id,
        detail: { is_default: { before: false, after: true } },
      },
    ]);
  });

  it('404s an unknown id and a flow of another tenant, and changes nothing', async () => {
    const mine = await tenantWithToken();
    const theirs = await tenantWithToken();
    const foreign = await create(theirs.token, theirs.t.name, 'theirs');
    expect(
      (await call(mine.token, mine.t.name, 'POST', `/${newId()}/make-default`, { ifMatch: '"x"' }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await call(mine.token, mine.t.name, 'POST', `/${foreign.id}/make-default`, {
          ifMatch: '"x"',
        })
      ).statusCode,
    ).toBe(404);
    expect(await defaults(theirs.token, theirs.t.name)).toEqual(['default']);
  });

  it('is refused for every capability but manage-tenant', async () => {
    const { t, token } = await tenantWithToken();
    const staff = await create(token, t.name, 'staff');
    for (const capability of TENANT_CAPABILITIES) {
      if (capability === 'manage-tenant') continue;
      const other = await fixture.adminToken(t.name, [capability]);
      const res = await call(other, t.name, 'POST', `/${staff.id}/make-default`, {
        ifMatch: '"x"',
      });
      expect(res.statusCode, capability).toBe(403);
    }
  });
});
