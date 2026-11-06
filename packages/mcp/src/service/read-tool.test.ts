import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { TOOLS } from '#/service/catalogue';

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
