import { describe, expect, it } from 'vitest';
import { compile } from '#/service/json-schema';

const parse = (schema: unknown, value: unknown) => compile(schema).parse(value);

describe('reading an answer against its JSON Schema', () => {
  const user = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      note: { type: ['string', 'null'] },
      age: { type: 'integer', minimum: 0 },
    },
    required: ['id'],
    additionalProperties: false,
  };

  it('keeps the members the schema names and leaves out the rest', () => {
    expect(parse(user, { id: 'a', note: null, secret: 'x' })).toEqual({
      ok: true,
      value: { id: 'a', note: null },
    });
  });

  it('refuses a missing required member and a member of the wrong kind', () => {
    expect(parse(user, {}).ok).toBe(false);
    expect(parse(user, { id: 1 }).ok).toBe(false);
    expect(parse(user, { id: 'a', age: -1 }).ok).toBe(false);
  });

  it('refuses what is not an object, and an array for an object', () => {
    for (const value of [null, 'text', 4, []]) expect(parse(user, value).ok).toBe(false);
  });

  it('reads an array element by element, within its bounds', () => {
    const list = { type: 'array', items: user, maxItems: 2 };
    expect(parse(list, [{ id: 'a', extra: 1 }])).toEqual({ ok: true, value: [{ id: 'a' }] });
    expect(parse(list, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]).ok).toBe(false);
    expect(parse(list, [{ nope: 1 }]).ok).toBe(false);
    expect(parse(list, 'text').ok).toBe(false);
  });

  it('takes the first alternative that reads', () => {
    const either = { anyOf: [user, { type: 'object', properties: { other: { type: 'string' } } }] };
    expect(parse(either, { other: 'x', id: 'a' })).toEqual({ ok: true, value: { id: 'a' } });
    expect(parse(either, { other: 'x' })).toEqual({ ok: true, value: { other: 'x' } });
    expect(parse(either, 4).ok).toBe(false);
  });

  it('reads an open record by its key and value schemas, and its size', () => {
    const record = {
      type: 'object',
      propertyNames: { type: 'string', pattern: '^[a-z]+$' },
      additionalProperties: { type: 'string' },
      maxProperties: 2,
    };
    expect(parse(record, { a: 'x' })).toEqual({ ok: true, value: { a: 'x' } });
    expect(parse(record, { A: 'x' }).ok).toBe(false);
    expect(parse(record, { a: 1 }).ok).toBe(false);
    expect(parse(record, { a: 'x', b: 'y', c: 'z' }).ok).toBe(false);
  });

  it('hands a scalar to the schema reader for its constraints', () => {
    const word = { type: 'string', enum: ['one', 'two'] };
    expect(parse(word, 'one')).toEqual({ ok: true, value: 'one' });
    expect(parse(word, 'three').ok).toBe(false);
    expect(parse({ const: 1 }, 1).ok).toBe(true);
  });
});
