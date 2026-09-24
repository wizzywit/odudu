import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { compileSchema } from '#/adapter/validation';

describe('compileSchema', () => {
  it('accepts a body matching the schema', () => {
    const validate = compileSchema(z.object({ name: z.string() }));
    expect(validate({ name: 'acme' })).toBe(true);
  });

  it('rejects an unknown property, because Zod emits additionalProperties false', () => {
    const validate = compileSchema(z.object({ name: z.string() }));
    expect(validate({ name: 'acme', sneaky: 1 })).toBe(false);
  });

  it('compiles a 2020-12 schema without falling back to draft-07 semantics', () => {
    // prefixItems is 2020-12; draft-07's ajv ignores it and would accept
    // anything, so this is what tells the two dialects apart.
    const validate = compileSchema(z.tuple([z.string(), z.number()]));
    expect(validate(['a', 1])).toBe(true);
    expect(validate([1, 'a'])).toBe(false);
  });
});
