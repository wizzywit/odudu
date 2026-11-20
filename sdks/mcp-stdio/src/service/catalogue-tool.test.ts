import { describe, expect, it } from 'vitest';
import type { CatalogueEntry } from '#/service/catalogue';
import { toolOf } from '#/service/catalogue-tool';
import { ToolProblem } from '#/service/tool';
import { respondingWith } from '#/testing/fake-caller';

const ID = '0192a0a0-0000-7000-8000-000000000001';
const ETAG = `"${'a'.repeat(16)}"`;

const readFlags = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
const row = {
  type: 'object',
  properties: { id: { type: 'string' }, name: { type: 'string' } },
  required: ['id'],
  additionalProperties: false,
};

const page: CatalogueEntry = {
  name: 'list_things',
  description: 'Lists things.',
  scope: 'mcp:read',
  method: 'GET',
  pathTemplate: '/admin/tenants/:tenant/things',
  kind: 'page',
  annotations: readFlags,
  pathParams: [],
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 200 },
      cursor: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: { items: { type: 'array', items: row }, next: { type: 'string' } },
    required: ['items'],
    additionalProperties: false,
  },
};

const value: CatalogueEntry = {
  ...page,
  name: 'get_thing',
  kind: 'value',
  pathTemplate: '/admin/tenants/:tenant/things/:id',
  pathParams: ['id'],
  etag: true,
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string' }, verbose: { type: 'boolean' } },
    required: ['id'],
    additionalProperties: false,
  },
  outputSchema: row,
};

const write: CatalogueEntry = {
  ...page,
  name: 'update_thing',
  scope: 'mcp:write',
  method: 'PATCH',
  kind: 'write',
  pathTemplate: '/admin/tenants/:tenant/things/:id',
  pathParams: ['id'],
  bodyFields: ['name'],
  spends: 'mutating',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  refusal: 'insufficient_scope: change only the name.',
  stale: 'Read it again.',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string' }, if_match: { type: 'string' }, name: { type: 'string' } },
    required: ['id', 'if_match'],
    additionalProperties: false,
  },
  outputSchema: row,
};

async function problemOf(call: Promise<unknown>): Promise<ToolProblem> {
  try {
    await call;
  } catch (error) {
    if (error instanceof ToolProblem) return error;
    throw error;
  }
  throw new Error('the call did not fail');
}

describe('a tool read from the catalogue', () => {
  it('is described for a client and for the budget from its entry', () => {
    const tool = toolOf(write);
    expect(tool).toMatchObject({
      name: 'update_thing',
      routeKey: 'PATCH /admin/tenants/:tenant/things/:id',
      access: 'write',
      spends: 'mutating',
      bodyFields: ['name'],
    });
    expect(toolOf(page).access).toBe('read');
  });

  it('reads a page: path and query from the arguments, rows cleaned, the cursor passed back', async () => {
    const caller = respondingWith({
      items: [{ id: '1', name: 'a\u0000b', extra: 1 }],
      next: 'c.d',
    });
    const out = await toolOf(page).run(caller, { limit: 5 });
    expect(out).toEqual({ data: [{ id: '1', name: 'ab' }], next_cursor: 'c.d' });
    expect(caller.requests).toEqual([
      {
        method: 'GET',
        pattern: '/admin/tenants/:tenant/things',
        params: {},
        query: { limit: '5' },
      },
    ]);
  });

  it('says when a string was cut', async () => {
    const caller = respondingWith({ items: [{ id: '1', name: 'x'.repeat(1_500) }] });
    const out = await toolOf(page).run(caller, {});
    expect(out.truncated).toBe(true);
  });

  it('refuses a cursor it could not pass back', async () => {
    const caller = respondingWith({ items: [], next: 'a b' });
    expect((await problemOf(toolOf(page).run(caller, {}))).problemType).toBe(
      'mcp:unexpected_response',
    );
  });

  it('reads one value with the etag the route sent, never an unlisted member', async () => {
    const caller = respondingWith({ id: ID, name: 'n', client_secret: 's' }, 200, { etag: ETAG });
    const out = await toolOf(value).run(caller, { id: ID });
    expect(out).toEqual({ data: { id: ID, name: 'n' }, etag: ETAG });
    expect(caller.requests[0]).toMatchObject({ params: { id: ID }, query: {} });
  });

  it('leaves the etag out when the route sent none, or one that is not strong', async () => {
    const weak = respondingWith({ id: ID }, 200, { etag: `W/${ETAG}` });
    expect(await toolOf(value).run(weak, { id: ID })).toEqual({ data: { id: ID } });
  });

  it('refuses an answer that is not the documented one', async () => {
    for (const body of [{}, { id: 5 }, null, 'text']) {
      const problem = await problemOf(toolOf(value).run(respondingWith(body), { id: ID }));
      expect(problem.problemType).toBe('mcp:unexpected_response');
    }
  });

  it('turns an admin refusal into its problem', async () => {
    const caller = respondingWith({ type: 'about:blank', title: 'Not found' }, 404);
    const problem = await problemOf(toolOf(value).run(caller, { id: ID }));
    expect([problem.problemType, problem.status, problem.title]).toEqual([
      'about:blank',
      404,
      'Not found',
    ]);
  });

  it('refuses arguments the schema refuses before anything is sent', async () => {
    const caller = respondingWith({});
    for (const args of [{}, { id: 1 }, { id: ID, extra: true }, null]) {
      const problem = await problemOf(toolOf(value).run(caller, args));
      expect(problem).toMatchObject({ problemType: 'mcp:invalid_arguments', status: 400 });
    }
    expect(caller.requests).toEqual([]);
  });

  it('refuses a string longer than any id or cursor, on a read', async () => {
    const caller = respondingWith({ items: [] });
    const problem = await problemOf(toolOf(page).run(caller, { cursor: 'c'.repeat(1_025) }));
    expect(problem.detail).toContain('cursor');
    expect(caller.requests).toEqual([]);
  });

  it('amends the named fields under the etag it was given', async () => {
    const caller = respondingWith({ id: ID, name: 'new' }, 200, { etag: ETAG });
    const out = await toolOf(write).run(caller, { id: ID, if_match: ETAG, name: 'new' });
    expect(out).toEqual({ data: { id: ID, name: 'new' }, etag: ETAG });
    expect(caller.requests).toEqual([
      {
        method: 'PATCH',
        pattern: '/admin/tenants/:tenant/things/:id',
        params: { id: ID },
        query: {},
        body: { name: 'new' },
        ifMatch: ETAG,
      },
    ]);
  });

  it('refuses a write that names no field, or a body past its cap', async () => {
    const caller = respondingWith({});
    const none = await problemOf(toolOf(write).run(caller, { id: ID, if_match: ETAG }));
    expect(none.detail).toBe('name at least one of name');
    const capped = toolOf({ ...write, bodyCap: 10 });
    const big = await problemOf(
      capped.run(caller, { id: ID, if_match: ETAG, name: 'x'.repeat(20) }),
    );
    expect(big.detail).toBe('the text is too long in all');
    expect(caller.requests).toEqual([]);
  });

  it('says what to do about a stale etag and a refused scope, in the tool’s own words', async () => {
    const args = { id: ID, if_match: ETAG, name: 'n' };
    const stale = await problemOf(
      toolOf(write).run(respondingWith({ type: 't', title: 'Precondition' }, 412), args),
    );
    expect([stale.status, stale.detail]).toEqual([412, 'Read it again.']);
    const refused = await problemOf(
      toolOf(write).run(
        respondingWith({ type: 't', title: 'Forbidden', detail: 'insufficient_scope' }, 403),
        args,
      ),
    );
    expect([refused.status, refused.detail]).toEqual([
      403,
      'insufficient_scope: change only the name.',
    ]);
  });

  it('answers whether the arguments are valid without running anything', () => {
    const tool = toolOf(value);
    expect(tool.input.safeParse({ id: ID }).success).toBe(true);
    expect(tool.input.safeParse({}).success).toBe(false);
  });
});
