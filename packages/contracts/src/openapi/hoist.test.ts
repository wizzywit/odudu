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
