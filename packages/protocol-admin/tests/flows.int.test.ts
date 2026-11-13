import { registeredAuthenticatorNames, flowRepository } from '@odudu/authn-flows';
import { withTenant } from '@odudu/db';
import { TENANT_CAPABILITIES } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture, etagAt } from '#/testing/admin-fixture';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
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

  it('is refused for every capability but manage-tenant', async () => {
    const t = await fixture.createTenant(`flows-${newId()}`);
    for (const capability of TENANT_CAPABILITIES) {
      if (capability === 'manage-tenant') continue;
      const token = await fixture.adminToken(t.name, [capability]);
      expect((await call(token, t.name, 'GET', '')).statusCode, capability).toBe(403);
    }
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
    expect((await call(mine.token, mine.t.name, 'DELETE', `/${foreign.id}`)).statusCode).toBe(404);

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
  it('deletes a non-default flow and records flow.delete', async () => {
    const { t, token } = await tenantWithToken();
    const flow = await create(token, t.name, 'staff');
    expect((await call(token, t.name, 'DELETE', `/${flow.id}`)).statusCode).toBe(204);
    expect((await call(token, t.name, 'GET', `/${flow.id}`)).statusCode).toBe(404);
    expect((await auditActions(token, t.name, 'flow.delete')).map((row) => row.outcome)).toEqual([
      'allowed',
    ]);
  });

  it('refuses the default flow with default-flow and keeps it', async () => {
    const { t, token } = await tenantWithToken();
    const list = (await call(token, t.name, 'GET', '')).json<{ items: FlowBody[] }>();
    const fallback = list.items.find((flow) => flow.is_default);
    const res = await call(token, t.name, 'DELETE', `/${fallback?.id ?? ''}`);
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
      expect((await call(other, t.name, 'DELETE', `/${flow.id}`)).statusCode, capability).toBe(403);
    }
  });
});
