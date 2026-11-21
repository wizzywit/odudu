import { meAmendProfileRequestSchema } from '@odudu/contracts/me';
import { without } from '@odudu/contracts/openapi';
import { KERNEL_VERSION } from '@odudu/kernel';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildMeOpenApiDocument, registerMeOpenApiRoute } from '#/view/openapi';
import { ME_ROUTES } from '#/view/routes';

const document = buildMeOpenApiDocument();
const pathOf = (url: string) => url.replace(/:(\w+)/gu, '{$1}');

function operationOf(method: string, url: string) {
  const operation = document.paths[pathOf(url)]?.[method.toLowerCase()];
  if (operation === undefined) throw new Error(`no operation for ${method} ${url}`);
  return operation;
}

function lookup(ref: string): unknown {
  let node: unknown = document;
  for (const part of ref.replace(/^#\//u, '').split('/')) {
    node = typeof node === 'object' && node !== null ? Reflect.get(node, part) : undefined;
  }
  return node;
}

describe('buildMeOpenApiDocument', () => {
  it('has an operation for every route in the table, and no other', () => {
    const documented = Object.entries(document.paths).flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`),
    );
    expect(documented.sort()).toEqual(
      ME_ROUTES.map((route) => `${route.method} ${pathOf(route.url)}`).sort(),
    );
  });

  it('names the bearer scheme and the scope on every operation', () => {
    expect(document.components.securitySchemes.bearerAuth).toMatchObject({ scheme: 'bearer' });
    for (const route of ME_ROUTES) {
      expect(operationOf(route.method, route.url).security, route.url).toEqual([
        { bearerAuth: [route.scope] },
      ]);
    }
  });

  it('describes the body of PATCH /profile as the contract does', () => {
    const body = operationOf('PATCH', '/tenants/:tenant/me/profile').requestBody;
    const schema = body?.content['application/json']?.schema;
    const expected = without(
      z.toJSONSchema(meAmendProfileRequestSchema, { unrepresentable: 'any' }),
      '$schema',
    );
    expect(schema).toEqual(expected);
  });

  it('has no path for the document itself', () => {
    expect(Object.keys(document.paths).filter((path) => path.includes('openapi'))).toEqual([]);
  });

  it('names the server version in info.version', () => {
    expect(document.info.version).toBe(KERNEL_VERSION);
  });

  it('answers every error status with a reference to a shared response', () => {
    for (const route of ME_ROUTES) {
      const responses = operationOf(route.method, route.url).responses;
      for (const [status, response] of Object.entries(responses)) {
        if (Number(status) < 400) continue;
        const ref = '$ref' in response ? response.$ref : '';
        expect(ref, `${route.method} ${route.url} ${status}`).toMatch(
          /^#\/components\/responses\//u,
        );
        expect(lookup(ref)).toBeDefined();
      }
    }
  });

  it('answers 404 on every route, since an unknown or disabled tenant is refused with it', () => {
    for (const route of ME_ROUTES) {
      expect(Object.keys(operationOf(route.method, route.url).responses), route.url).toContain(
        '404',
      );
    }
  });

  it('says the bodiless refusals have no body, where the shared response also names a body', () => {
    const description = (name: string) => document.components.responses[name]?.description ?? '';
    expect(description('NotFound')).toMatch(/no body/iu);
    expect(description('Forbidden')).toMatch(/insufficient_scope/u);
    expect(description('Forbidden')).toMatch(/agent_not_permitted/u);
    expect(description('Forbidden')).toMatch(/no body/iu);
    expect(description('Forbidden')).toMatch(/no challenge/iu);
  });

  it('writes the error body once, as a component', () => {
    expect(JSON.stringify(document.paths)).not.toContain('error_description');
    expect(document.components.schemas.MeError).toMatchObject({
      properties: { error: { type: 'string' }, error_description: { type: 'string' } },
    });
  });

  it('declares the tenant path parameter on every operation', () => {
    for (const route of ME_ROUTES) {
      const names = operationOf(route.method, route.url).parameters.map((p) =>
        '$ref' in p ? p.$ref : p.name,
      );
      expect(names, route.url).toContain('#/components/parameters/tenant');
    }
  });

  it('takes the list query parameters from the contract', () => {
    const names = operationOf('GET', '/tenants/:tenant/me/sessions').parameters.flatMap((p) =>
      '$ref' in p ? [] : [p.name],
    );
    expect(names.sort()).toEqual(['cursor', 'limit']);
  });
});

describe('GET /me/openapi.json', () => {
  it('answers the document to any origin, with no credentials allowed', async () => {
    const app = Fastify();
    registerMeOpenApiRoute(app);
    const res = await app.inject({
      method: 'GET',
      url: '/me/openapi.json',
      headers: { origin: 'http://localhost:3001' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    expect(res.json()).toEqual(JSON.parse(JSON.stringify(document)));
    await app.close();
  });
});
