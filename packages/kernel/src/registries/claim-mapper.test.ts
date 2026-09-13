import { describe, expect, it } from 'vitest';
import { OduduError } from '#/errors';
import { ClaimMapperRegistry, type ClaimMapper } from '#/registries/claim-mapper';

interface TestContext {
  readonly value: string;
}

function mapper(
  name: string,
  scopes: readonly string[],
  claims: Record<string, unknown>,
): ClaimMapper<TestContext> {
  return {
    name,
    scopes,
    claims: Object.keys(claims),
    map: () => Promise.resolve(claims),
  };
}

describe('ClaimMapperRegistry', () => {
  it('runs only mappers whose scopes were granted', async () => {
    const registry = new ClaimMapperRegistry<TestContext>()
      .register(mapper('a', ['scope-a'], { a: 1 }))
      .register(mapper('b', ['scope-b'], { b: 2 }));

    const claims = await registry.assemble(['scope-a'], { value: 'x' });

    expect(claims).toEqual({ a: 1 });
  });

  it('runs a mapper when any one of its declared scopes was granted', async () => {
    const registry = new ClaimMapperRegistry<TestContext>().register(
      mapper('a', ['scope-a', 'scope-c'], { a: 1 }),
    );

    expect(await registry.assemble(['scope-c'], { value: 'x' })).toEqual({ a: 1 });
  });

  it('rejects a duplicate mapper name rather than silently replacing it', () => {
    const registry = new ClaimMapperRegistry<TestContext>();
    const m = mapper('a', ['scope-a'], { a: 1 });

    expect(() => registry.register(m).register(m)).toThrow(/already registered/);
    expect(() => registry.register(m)).toThrow(OduduError);
  });

  it('lets a later mapper add claims without dropping an earlier one', async () => {
    const registry = new ClaimMapperRegistry<TestContext>()
      .register(mapper('a', ['scope-a'], { a: 1 }))
      .register(mapper('b', ['scope-b'], { b: 2 }));

    const claims = await registry.assemble(['scope-a', 'scope-b'], { value: 'x' });

    expect(claims).toEqual({ a: 1, b: 2 });
  });

  it('exposes the union of every registered mapper claim name, regardless of scope', () => {
    const registry = new ClaimMapperRegistry<TestContext>()
      .register(mapper('a', ['scope-a'], { a: 1 }))
      .register(mapper('b', ['scope-b'], { b: 2, c: 3 }));

    expect([...registry.claimNames()].sort()).toEqual(['a', 'b', 'c']);
  });
});
