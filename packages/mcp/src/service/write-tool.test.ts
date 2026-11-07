import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { callTool } from '#/service/call-tool';
import { contentWriteTool, descriptionField, nameField } from '#/service/write-tool';
import { ETAG, NEW_ETAG } from '#/testing/write-conformance';
import { respondingWith } from '#/testing/fake-caller';

const UUID = '0192a0a0-0000-7000-8000-000000000001';
const ROLE = z.object({ id: z.string(), name: z.string() });
const ANSWER = { id: UUID, name: 'auditors' };

const create = contentWriteTool({
  name: 'create_thing',
  description: 'Creates a thing.',
  routeKey: 'POST /admin/tenants/:tenant/roles',
  capability: 'manage-tenant',
  what: 'role',
  mode: 'create',
  fields: { name: nameField, description: descriptionField.optional() },
  response: ROLE,
});

const amend = contentWriteTool({
  name: 'amend_thing',
  description: 'Amends a thing.',
  routeKey: 'PATCH /admin/tenants/:tenant/roles/:id',
  capability: 'manage-tenant',
  what: 'role',
  mode: 'amend',
  fields: { description: descriptionField.optional() },
  response: ROLE,
});

const put = contentWriteTool({
  name: 'put_thing',
  description: 'Replaces a thing.',
  routeKey: 'PUT /admin/tenants/:tenant/message-overrides/:locale/:key',
  capability: 'manage-tenant',
  what: 'message override',
  mode: 'put',
  params: { locale: z.string().min(2).max(35), key: z.string().min(1).max(100) },
  fields: { message: z.string().min(1).max(500) },
  response: ROLE,
  bodyCap: 200_000,
});

const remove = contentWriteTool({
  name: 'delete_thing',
  description: 'Removes a thing.',
  routeKey: 'DELETE /admin/tenants/:tenant/message-overrides/:locale/:key',
  capability: 'manage-tenant',
  what: 'message override',
  mode: 'delete',
  params: { locale: z.string().min(2).max(35), key: z.string().min(1).max(100) },
  fields: {},
  response: z.void(),
});

describe('contentWriteTool, the budget it spends', () => {
  it('spends a create from the create budget and every other mode from the mutating one', () => {
    expect(create.spends).toBe('create');
    expect(amend.spends).toBe('mutating');
    expect(put.spends).toBe('mutating');
    expect(remove.spends).toBe('mutating');
  });

  it('is a write that declares its fields, whatever the mode', () => {
    for (const tool of [create, amend, put, remove]) expect(tool.access).toBe('write');
    expect([...(create.bodyFields ?? [])].sort()).toEqual(['description', 'name']);
    expect(put.bodyFields).toEqual(['message']);
    expect(remove.bodyFields).toEqual([]);
  });

  it('hints idempotent for amend, put and delete, and not for create', () => {
    expect(create.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    });
    for (const tool of [amend, put]) {
      expect(tool.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      });
    }
    expect(remove.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });
  });

  it('names a field that collides with a reserved argument as a mistake in the definition', () => {
    for (const reserved of ['id', 'if_match', 'idempotency_key']) {
      expect(() =>
        contentWriteTool({
          name: 'x',
          description: 'x',
          routeKey: 'POST /admin/tenants/:tenant/roles',
          capability: 'manage-tenant',
          what: 'role',
          mode: 'create',
          fields: { [reserved]: z.string() },
          response: ROLE,
        }),
      ).toThrow(/reserved/u);
    }
  });
});

describe('a create', () => {
  const valid = { idempotency_key: 'create-auditors-1', name: 'auditors' };

  it('sends one POST with the client’s own key and the fields, nothing else', async () => {
    const caller = respondingWith(ANSWER, 201);
    const result = await callTool(create, caller, valid);
    expect(result.isError).toBe(false);
    expect(caller.requests).toEqual([
      {
        method: 'POST',
        pattern: '/admin/tenants/:tenant/roles',
        params: {},
        query: {},
        body: { name: 'auditors' },
        idempotencyKey: 'create-auditors-1',
      },
    ]);
    expect(result.structuredContent).toEqual({ data: ANSWER });
  });

  it('is refused without a key, before any call', async () => {
    const caller = respondingWith(ANSWER, 201);
    const result = await callTool(create, caller, { name: 'auditors' });
    expect(result.structuredContent).toMatchObject({ error: { type: 'mcp:invalid_arguments' } });
    expect(JSON.stringify(result)).toContain('idempotency_key');
    expect(caller.requests).toHaveLength(0);
  });

  it.each(['', 'a b', 'a\nb', 'k'.repeat(256), 'é', 'a/b', 7, null])(
    'is refused for the key %j, before any call',
    async (key) => {
      const caller = respondingWith(ANSWER, 201);
      const result = await callTool(create, caller, { ...valid, idempotency_key: key });
      expect(result.isError).toBe(true);
      expect(caller.requests).toHaveLength(0);
    },
  );

  it('takes the same key on a retry, since the key is the client’s and not the request’s', async () => {
    const caller = respondingWith(ANSWER, 201);
    await callTool(create, caller, valid);
    await callTool(create, caller, valid);
    expect(caller.requests.map((r) => r.idempotencyKey)).toEqual([
      'create-auditors-1',
      'create-auditors-1',
    ]);
  });

  it('refuses an id, a precondition and a field the tool does not name', async () => {
    const caller = respondingWith(ANSWER, 201);
    for (const extra of [{ id: UUID }, { if_match: ETAG }, { enabled: true }, { tenant: 'x' }]) {
      expect((await callTool(create, caller, { ...valid, ...extra })).isError).toBe(true);
    }
    expect(caller.requests).toHaveLength(0);
  });

  it('answers the admin API’s conflict for a key reused with another body', async () => {
    const caller = respondingWith(
      { type: 'about:blank#idempotency-key-reused', title: 'Conflict', status: 409 },
      409,
    );
    const result = await callTool(create, caller, valid);
    expect(result.structuredContent).toMatchObject({ error: { status: 409 } });
  });
});

describe('an amend', () => {
  it('sends the etag as If-Match and refuses a call without it or without a field', async () => {
    const caller = respondingWith(ANSWER);
    await callTool(amend, caller, { id: UUID, if_match: ETAG, description: 'd' });
    expect(caller.requests[0]).toEqual({
      method: 'PATCH',
      pattern: '/admin/tenants/:tenant/roles/:id',
      params: { id: UUID },
      query: {},
      body: { description: 'd' },
      ifMatch: ETAG,
    });
    expect((await callTool(amend, caller, { id: UUID, description: 'd' })).isError).toBe(true);
    expect((await callTool(amend, caller, { id: UUID, if_match: ETAG })).isError).toBe(true);
    expect(caller.requests).toHaveLength(1);
  });

  it('says a stale etag as the admin API’s 412', async () => {
    const caller = respondingWith({ type: 'about:blank', title: 'Precondition Failed' }, 412);
    const result = await callTool(amend, caller, { id: UUID, if_match: ETAG, description: 'd' });
    expect(result.structuredContent).toMatchObject({ error: { status: 412 } });
    expect(JSON.stringify(result)).toMatch(/read it again/iu);
  });

  it('answers the new etag beside the data', async () => {
    const caller = respondingWith(ANSWER, 200, { etag: NEW_ETAG });
    const result = await callTool(amend, caller, { id: UUID, if_match: ETAG, description: 'd' });
    expect(result.structuredContent).toEqual({ data: ANSWER, etag: NEW_ETAG });
  });
});

describe('a put', () => {
  it('addresses the resource by its parameters, with the cap its tool names', async () => {
    const caller = respondingWith(ANSWER);
    await callTool(put, caller, { locale: 'de', key: 'login.title', message: 'Hallo' });
    expect(caller.requests).toEqual([
      {
        method: 'PUT',
        pattern: '/admin/tenants/:tenant/message-overrides/:locale/:key',
        params: { locale: 'de', key: 'login.title' },
        query: {},
        body: { message: 'Hallo' },
        bodyCap: 200_000,
        createOnly: true,
      },
    ]);
  });

  it('may only create when it names no etag, and replaces when it does, never both', async () => {
    const create = respondingWith(ANSWER);
    await callTool(put, create, { locale: 'de', key: 'k', message: 'm' });
    expect(create.requests[0]).toMatchObject({ createOnly: true });
    expect(create.requests[0]).not.toHaveProperty('ifMatch');
    const replace = respondingWith(ANSWER);
    await callTool(put, replace, { locale: 'de', key: 'k', message: 'm', if_match: ETAG });
    expect(replace.requests[0]).toMatchObject({ ifMatch: ETAG });
    expect(replace.requests[0]).not.toHaveProperty('createOnly');
  });

  it('sends the etag it was given, and none when there is none', async () => {
    const caller = respondingWith(ANSWER);
    await callTool(put, caller, { locale: 'de', key: 'k', message: 'm', if_match: ETAG });
    expect(caller.requests[0]?.ifMatch).toBe(ETAG);
    const bad = await callTool(put, caller, {
      locale: 'de',
      key: 'k',
      message: 'm',
      if_match: '*',
    });
    expect(bad.isError).toBe(true);
    expect(caller.requests).toHaveLength(1);
  });
});

describe('a delete', () => {
  it('sends no body, the etag as If-Match and answers that it is done', async () => {
    const caller = respondingWith(null, 204);
    const result = await callTool(remove, caller, { locale: 'de', key: 'k', if_match: ETAG });
    expect(caller.requests).toEqual([
      {
        method: 'DELETE',
        pattern: '/admin/tenants/:tenant/message-overrides/:locale/:key',
        params: { locale: 'de', key: 'k' },
        query: {},
        ifMatch: ETAG,
      },
    ]);
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({ data: { deleted: true } });
  });

  it('is refused without the etag, before any call', async () => {
    const caller = respondingWith(null, 204);
    expect((await callTool(remove, caller, { locale: 'de', key: 'k' })).isError).toBe(true);
    expect(caller.requests).toHaveLength(0);
  });
});

describe('what every mode says of a refusal', () => {
  it.each([
    ['create', create, { idempotency_key: 'k1', name: 'n' }],
    ['put', put, { locale: 'de', key: 'k', message: 'm' }],
  ] as const)(
    'a %s refused by the door is insufficient_scope with the tool’s advice',
    async (_l, tool, args) => {
      const caller = respondingWith(
        { type: 'about:blank', title: 'Forbidden', status: 403, detail: 'insufficient_scope' },
        403,
      );
      const result = await callTool(tool, caller, args);
      expect(result.structuredContent).toMatchObject({
        error: { status: 403, detail: expect.stringMatching(/^insufficient_scope/u) as unknown },
      });
    },
  );

  it('leaves any other answer outside 2xx to the admin API’s own problem', async () => {
    const caller = respondingWith(
      { type: 'about:blank#roles-full', title: 'Conflict', status: 409 },
      409,
    );
    const result = await callTool(create, caller, { idempotency_key: 'k1', name: 'n' });
    expect(result.structuredContent).toMatchObject({
      error: { type: 'about:blank#roles-full', status: 409 },
    });
  });
});

describe('a tool that names its own body cap', () => {
  const big = contentWriteTool({
    name: 'put_big',
    description: 'Replaces a big thing.',
    routeKey: 'PUT /admin/tenants/:tenant/message-overrides/:locale/:key',
    capability: 'manage-tenant',
    what: 'message override',
    mode: 'put',
    params: { locale: z.string().min(2).max(35), key: z.string().min(1).max(100) },
    fields: { message: z.string().min(1).max(400_000) },
    response: ROLE,
    bodyCap: 200_000,
  });
  const small = contentWriteTool({
    name: 'put_small',
    description: 'Replaces a small thing.',
    routeKey: 'PUT /admin/tenants/:tenant/message-overrides/:locale/:key',
    capability: 'manage-tenant',
    what: 'message override',
    mode: 'put',
    params: { locale: z.string().min(2).max(35), key: z.string().min(1).max(100) },
    fields: { message: z.string().min(1).max(400_000) },
    response: ROLE,
    bodyCap: 1_000,
  });
  const at = (message: string) => ({ locale: 'de', key: 'k', message });

  it('accepts a body between 60,000 bytes and its cap, and refuses one above', async () => {
    const caller = respondingWith(ANSWER);
    expect((await callTool(big, caller, at('x'.repeat(100_000)))).isError).toBe(false);
    const over = await callTool(big, caller, at('x'.repeat(200_000)));
    expect(over.structuredContent).toMatchObject({ error: { type: 'mcp:invalid_arguments' } });
    expect(caller.requests).toHaveLength(1);
  });

  it('refuses a body above a cap below 60,000 as an argument, before any call', async () => {
    const caller = respondingWith(ANSWER);
    const result = await callTool(small, caller, at('x'.repeat(2_000)));
    expect(result.structuredContent).toMatchObject({ error: { type: 'mcp:invalid_arguments' } });
    expect(caller.requests).toHaveLength(0);
  });
});

describe('a definition that names one argument twice', () => {
  it('throws when a path parameter has the name of a body field or a reserved argument', () => {
    for (const name of ['locale', 'if_match', 'idempotency_key']) {
      expect(() =>
        contentWriteTool({
          name: 'x',
          description: 'x',
          routeKey: 'PUT /admin/tenants/:tenant/message-overrides/:locale/:key',
          capability: 'manage-tenant',
          what: 'message override',
          mode: 'put',
          params: { [name]: z.string(), key: z.string() },
          fields: name === 'locale' ? { locale: z.string() } : { message: z.string() },
          response: ROLE,
        }),
      ).toThrow(/reserved|twice/u);
    }
  });
});

describe('the values a write tool sends', () => {
  const rich = contentWriteTool({
    name: 'put_rich',
    description: 'Replaces a rich thing.',
    routeKey: 'PUT /admin/tenants/:tenant/message-overrides/:locale/:key',
    capability: 'manage-tenant',
    what: 'message override',
    mode: 'put',
    params: { locale: z.string(), key: z.string() },
    fields: {
      count: z.number().int(),
      on: z.boolean(),
      list: z.array(z.string()),
      nested: z.object({ a: z.number(), b: z.array(z.boolean()), c: z.null() }),
      gone: z.string().nullable(),
    },
    response: ROLE,
  });

  it('are every JSON value: numbers, booleans, arrays, nested records and null', async () => {
    const caller = respondingWith(ANSWER);
    const body = {
      count: 3,
      on: false,
      list: ['a', 'b'],
      nested: { a: 1.5, b: [true, false], c: null },
      gone: null,
    };
    const result = await callTool(rich, caller, { locale: 'de', key: 'k', ...body });
    expect(result.isError, JSON.stringify(result.structuredContent)).toBe(false);
    expect(caller.requests[0]?.body).toEqual(body);
  });
});

describe('a tool that says its own 412', () => {
  const custom = contentWriteTool({
    name: 'put_other',
    description: 'Replaces a thing.',
    routeKey: 'PUT /admin/tenants/:tenant/message-overrides/:locale/:key',
    capability: 'manage-tenant',
    what: 'message override',
    mode: 'put',
    params: { locale: z.string().min(2).max(35), key: z.string().min(1).max(100) },
    fields: { message: z.string().min(1).max(500) },
    response: ROLE,
    stale: 'Another override exists: list the overrides and send its etag as if_match.',
  });

  it('answers the advice it names in place of the one for a resource read before', async () => {
    const caller = respondingWith({ type: 'about:blank', title: 'Precondition Failed' }, 412);
    const result = await callTool(custom, caller, { locale: 'de', key: 'k', message: 'm' });
    expect(result.structuredContent).toMatchObject({
      error: { status: 412, detail: expect.stringMatching(/list the overrides/u) as unknown },
    });
  });
});
