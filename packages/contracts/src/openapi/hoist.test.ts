import { describe, expect, it } from 'vitest';
import { hoistRepeatedSchemas } from '#/openapi/hoist';

const SHAPE = { type: 'object', properties: { id: { type: 'string' } } };
const operation = { responses: { '200': { content: { 'application/json': { schema: SHAPE } } } } };

describe('hoistRepeatedSchemas', () => {
  it('moves a shape that occurs three times into the components and names it', () => {
    const paths = {
      '/me/a': { get: operation },
      '/me/b': { get: operation },
      '/me/c': { get: operation },
    };
    const { paths: out, schemas } = hoistRepeatedSchemas(paths, {}, ['me']);
    expect(Object.keys(schemas)).toEqual(['AGetResponse']);
    expect(JSON.stringify(out)).toContain('#/components/schemas/AGetResponse');
    expect(schemas.AGetResponse).toEqual(SHAPE);
  });

  it('leaves a shape that occurs twice where it is', () => {
    const paths = { '/me/a': { get: operation }, '/me/b': { get: operation } };
    const { paths: out, schemas } = hoistRepeatedSchemas(paths, {}, ['me']);
    expect(schemas).toEqual({});
    expect(out).toEqual(paths);
  });

  it('names a component from the path less the ignored segments', () => {
    const paths = {
      '/x/a': { get: operation },
      '/x/b': { get: operation },
      '/x/c': { get: operation },
    };
    expect(Object.keys(hoistRepeatedSchemas(paths, {}, []).schemas)).toEqual(['XAGetResponse']);
  });
});

describe('hoistRepeatedSchemas and literal values', () => {
  const schemaLookalike = { type: 'object', properties: { id: { type: 'string' } } };
  const withLiteral = (key: string): unknown => ({
    responses: {
      '200': {
        content: { 'application/json': { schema: { type: 'string', [key]: schemaLookalike } } },
      },
    },
  });

  it.each(['example', 'default', 'const', 'enum'])(
    'does not read the value of %s as a schema',
    (key) => {
      const paths = {
        '/a': { get: withLiteral(key) },
        '/b': { get: withLiteral(key) },
        '/c': { get: withLiteral(key) },
      };
      const { paths: out, schemas } = hoistRepeatedSchemas(paths, {}, []);
      expect(schemas).toEqual({});
      expect(out).toEqual(paths);
    },
  );

  it('does not read the entries of examples as schemas', () => {
    const op = {
      responses: {
        '200': {
          content: { 'application/json': { examples: { one: { value: schemaLookalike } } } },
        },
      },
    };
    const paths = { '/a': { get: op }, '/b': { get: op }, '/c': { get: op } };
    const { paths: out, schemas } = hoistRepeatedSchemas(paths, {}, []);
    expect(schemas).toEqual({});
    expect(out).toEqual(paths);
  });

  it('still hoists a schema held by a property that is named like a literal keyword', () => {
    const holder = {
      type: 'object',
      properties: { example: schemaLookalike, default: schemaLookalike },
    };
    const op = { responses: { '200': { content: { 'application/json': { schema: holder } } } } };
    const paths = { '/a': { get: op }, '/b': { get: op }, '/c': { get: op } };
    const { schemas } = hoistRepeatedSchemas(paths, {}, []);
    expect(Object.keys(schemas).length).toBeGreaterThan(0);
  });
});
