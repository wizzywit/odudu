import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { callTool } from '#/service/call-tool';
import { TOOLS } from '#/service/catalogue';
import { tenantGet, valueTool } from '#/service/read-tool';
import { respondingWith } from '#/testing/fake-caller';

describe('the input schema a client lists', () => {
  it('tells the model an id is a UUID, in the schema and not only in a refinement', () => {
    const get = TOOLS.find((tool) => tool.name === 'get_client');
    const schema = z.toJSONSchema(get?.input ?? z.never(), { io: 'input', unrepresentable: 'any' });
    const id = schema.properties?.id;
    expect(id).toMatchObject({ type: 'string', maxLength: 36 });
    const pattern = typeof id === 'object' ? id.pattern : undefined;
    expect(typeof pattern).toBe('string');
    const uuid = new RegExp(String(pattern), 'u');
    expect(uuid.test('0192A0A0-0000-7000-8000-00000000000F')).toBe(true);
    expect(uuid.test('../x')).toBe(false);
    expect(uuid.test('0192a0a0-0000-7000-8000-000000000001/..')).toBe(false);
  });

  it('keeps the page size and the cursor bound in the schema', () => {
    const list = TOOLS.find((tool) => tool.name === 'list_clients');
    const schema = z.toJSONSchema(list?.input ?? z.never(), {
      io: 'input',
      unrepresentable: 'any',
    });
    expect(schema.properties?.limit).toMatchObject({ minimum: 1, maximum: 200 });
    expect(schema.properties?.cursor).toMatchObject({ maxLength: 1024 });
  });
});

describe('a tool that declares long text', () => {
  const response = z.object({ title: z.string(), stylesheet: z.string().nullable() });
  const KIB = 1024;

  function longTool(longText?: readonly string[]) {
    return valueTool({
      name: 'get_long',
      description: 'Reads one document.',
      routeKey: tenantGet('/long'),
      capability: 'manage-tenant',
      shape: {},
      response,
      ...(longText === undefined ? {} : { longText }),
    });
  }

  it('returns the declared member whole up to 128 KiB and cuts every other string at 1,000', async () => {
    const body = { title: 't'.repeat(5_000), stylesheet: 's'.repeat(100 * KIB) };
    const result = await callTool(longTool(['stylesheet']), respondingWith(body), {});
    const data = result.structuredContent.data as z.infer<typeof response>;
    expect(data.stylesheet).toHaveLength(100 * KIB);
    expect(data.title).toHaveLength(1_000);
    expect(result.structuredContent.truncated).toBe(true);
  });

  it('cuts the same member at 1,000 in a tool that does not declare it', async () => {
    const body = { title: 't', stylesheet: 's'.repeat(100 * KIB) };
    const result = await callTool(longTool(), respondingWith(body), {});
    const data = result.structuredContent.data as z.infer<typeof response>;
    expect(data.stylesheet).toHaveLength(1_000);
  });

  it('says in its description that the declared member is cut later than the rest', () => {
    expect(longTool(['stylesheet']).description).toMatch(/131,072/u);
    expect(longTool().description).not.toMatch(/131,072/u);
  });

  it('answers mcp:result_too_large, with its own advice, when the text passes the result cap', async () => {
    const body = { title: 't', stylesheet: 's'.repeat(128 * KIB) };
    const tool = valueTool({
      name: 'get_two',
      description: 'Reads one document.',
      routeKey: tenantGet('/long'),
      capability: 'manage-tenant',
      shape: {},
      response: z.object({ a: z.string(), b: z.string(), c: z.string() }),
      longText: ['a', 'b', 'c'],
    });
    const wide = { a: body.stylesheet, b: body.stylesheet, c: body.stylesheet };
    const result = await callTool(tool, respondingWith(wide), {});
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { type: 'mcp:result_too_large', detail: expect.stringContaining('console') as string },
    });
  });
});
