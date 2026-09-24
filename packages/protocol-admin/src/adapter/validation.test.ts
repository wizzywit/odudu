import { cursorQuerySchema } from '@odudu/contracts/admin';
import Fastify from 'fastify';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { compileSchema, installAdminValidator } from '#/adapter/validation';

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

describe('the admin validator wired into a real Fastify request', () => {
  it('coerces a querystring limit into the page size a handler returns', async () => {
    const app = Fastify();
    installAdminValidator(app);
    app.get<{ Querystring: { limit?: number } }>(
      '/paged',
      { schema: { querystring: cursorQuerySchema } },
      (request, reply) => reply.send({ items: new Array(request.query.limit ?? 0).fill(null) }),
    );

    // Fastify hands every querystring value to ajv as a string; only
    // `coerceTypes` on the admin ajv instance turns "10" into the number
    // `cursorQuerySchema` declares, rather than refusing the request.
    const response = await app.inject({ method: 'GET', url: '/paged?limit=10' });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ items: unknown[] }>().items).toHaveLength(10);
  });

  it('refuses a mistyped JSON body rather than coercing it into shape', async () => {
    const app = Fastify();
    installAdminValidator(app);
    app.post('/tenants', { schema: { body: z.object({ name: z.string() }) } }, (request, reply) =>
      reply.send(request.body),
    );

    // JSON carries its own types, so coercion here is loss, not repair: a
    // number becomes the string "123" and a tenant is created under a name
    // its caller never sent.
    const response = await app.inject({
      method: 'POST',
      url: '/tenants',
      payload: { name: 123 },
    });

    expect(response.statusCode).toBe(400);
  });

  it('leaves the numbers 0 and 1 in a body as numbers', async () => {
    const app = Fastify();
    installAdminValidator(app);
    const body = z.record(z.string(), z.union([z.boolean(), z.number(), z.string()]));
    app.post('/settings', { schema: { body } }, (request, reply) => reply.send(request.body));

    // Where a union puts `boolean` first, coercion answers `false` and
    // `true` for these two — and an integer setting then refuses its own
    // caller's perfectly good value.
    const response = await app.inject({
      method: 'POST',
      url: '/settings',
      payload: { password_history_depth: 0, max_sessions_per_browser: 1 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ password_history_depth: 0, max_sessions_per_browser: 1 });
  });
});
