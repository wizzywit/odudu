import { describe, expect, it } from 'vitest';
import { parseCatalogue } from '#/service/catalogue';

const entry = {
  name: 'get_thing',
  description: 'Reads a thing.',
  scope: 'mcp:read',
  method: 'GET',
  pathTemplate: '/admin/tenants/:tenant/things/:id',
  kind: 'value',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  pathParams: ['id'],
  etag: true,
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
};

describe('reading the catalogue file', () => {
  it('reads a tool with its optional fields left out', () => {
    const { tools } = parseCatalogue({ tools: [entry] });
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ name: 'get_thing', scope: 'mcp:read', etag: true });
    expect(tools[0]?.bodyFields).toBeUndefined();
  });

  it('keeps the fields a write carries', () => {
    const write = {
      ...entry,
      name: 'update_thing',
      scope: 'mcp:write',
      method: 'PATCH',
      kind: 'write',
      bodyFields: ['name'],
      spends: 'mutating',
      bodyCap: 1000,
      refusal: 'no',
      stale: 'old',
    };
    expect(parseCatalogue({ tools: [write] }).tools[0]).toMatchObject({
      bodyFields: ['name'],
      spends: 'mutating',
      bodyCap: 1000,
      refusal: 'no',
      stale: 'old',
    });
  });

  it.each([
    ['not an object', 'text'],
    ['no tools list', {}],
    ['a tool that is not an object', { tools: [1] }],
    ['no name', { tools: [{ ...entry, name: undefined }] }],
    ['a scope that is not an MCP scope', { tools: [{ ...entry, scope: 'admin' }] }],
    ['a method that is not an HTTP method', { tools: [{ ...entry, method: 'TRACE' }] }],
    ['a path template that is not a path', { tools: [{ ...entry, pathTemplate: 'things' }] }],
    ['a kind that is unknown', { tools: [{ ...entry, kind: 'stream' }] }],
    ['annotations that are not flags', { tools: [{ ...entry, annotations: { readOnlyHint: 1 } }] }],
    ['path parameters that are not text', { tools: [{ ...entry, pathParams: [1] }] }],
    ['a body cap that is not a whole number', { tools: [{ ...entry, bodyCap: 1.5 }] }],
    ['an input schema that is not an object', { tools: [{ ...entry, inputSchema: [] }] }],
    ['a spend that is unknown', { tools: [{ ...entry, spends: 'free' }] }],
  ])('refuses a file with %s', (_label, value) => {
    expect(() => parseCatalogue(value)).toThrow(/tool catalogue/u);
  });
});
