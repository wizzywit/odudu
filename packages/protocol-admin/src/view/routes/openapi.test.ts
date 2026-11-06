import { assignScopeToClientResponseSchema } from '@odudu/contracts/admin';
import { documentedJsonSchema } from '@odudu/contracts/admin/docs';
import { describe, expect, it } from 'vitest';
import { ADMIN_ROUTES } from '#/service/capability';
import { idempotentMethod } from '#/service/idempotency';
import { buildAdminOpenApiDocument } from '#/view/routes/openapi';

describe('buildAdminOpenApiDocument', () => {
  it('documents every problem-details response as application/problem+json', () => {
    const document = buildAdminOpenApiDocument();
    for (const route of ADMIN_ROUTES) {
      const path = route.pattern.replace(/:(\w+)/gu, '{$1}');
      const operation = document.paths[path]?.[route.method.toLowerCase()];
      expect(operation, `${route.method} ${path}`).toBeDefined();
      const responses = operation?.responses ?? {};

      // sendProblem (#/view/problem) sends every RFC 9457 body as
      // application/problem+json, never application/json — a generated
      // client has to see that media type to pick the right decoder.
      for (const status of ['401', '403']) {
        const response = responses[status];
        if (response === undefined) continue;
        expect(response.content, `${route.method} ${path} ${status}`).toHaveProperty(
          'application/problem+json',
        );
        expect(response.content, `${route.method} ${path} ${status}`).not.toHaveProperty(
          'application/json',
        );
      }
    }
  });

  it('documents the refusals of the Idempotency-Key on the routes that take it, and 400 on those that refuse it', () => {
    const document = buildAdminOpenApiDocument();
    for (const route of ADMIN_ROUTES) {
      if (!idempotentMethod(route.method)) continue;
      const path = route.pattern.replace(/:(\w+)/gu, '{$1}');
      const responses = document.paths[path]?.[route.method.toLowerCase()]?.responses ?? {};
      const statuses =
        route.noIdempotency === undefined ? ['400', '409', '422', '429', '503'] : ['400'];
      for (const status of statuses) {
        expect(responses[status]?.content, `${route.method} ${path} ${status}`).toHaveProperty(
          'application/problem+json',
        );
      }
    }
  });

  it('documents a successful response as application/json unless the route names its own type', () => {
    const document = buildAdminOpenApiDocument();
    for (const route of ADMIN_ROUTES) {
      const path = route.pattern.replace(/:(\w+)/gu, '{$1}');
      const status = String(route.successStatus ?? 200);
      const response = document.paths[path]?.[route.method.toLowerCase()]?.responses[status];
      expect(response?.content, `${route.method} ${path} ${status}`).toHaveProperty([
        route.successMediaType ?? 'application/json',
      ]);
    }
  });

  it('documents the tenant export as its own media type', () => {
    const response =
      buildAdminOpenApiDocument().paths['/admin/tenants/{tenant}/export']?.get?.responses['200'];
    expect(Object.keys(response?.content ?? {})).toEqual(['application/vnd.odudu.tenant+json']);
  });

  // The route answers the client's scope assignments, never the client,
  // which reading takes a stronger capability than this route asks for.
  it('documents a scope assignment as the assignments the route answers', () => {
    const response =
      buildAdminOpenApiDocument().paths['/admin/tenants/{tenant}/scopes/{id}/clients/{clientId}']
        ?.put?.responses['200'];
    expect(response?.content?.['application/json']?.schema).toEqual(
      documentedJsonSchema(assignScopeToClientResponseSchema),
    );
  });

  it('writes the theme body once and names it, with the palette, wherever a theme answers', () => {
    const document = buildAdminOpenApiDocument();
    const schemas = document.components.schemas;
    expect(Object.keys(schemas)).toEqual(
      expect.arrayContaining(['ThemeBody', 'Palette', 'Logo', 'ProblemDetails']),
    );
    const view =
      document.paths['/admin/tenants/{tenant}/theme']?.get?.responses['200']?.content?.[
        'application/json'
      ]?.schema;
    const text = JSON.stringify(view);
    expect(text).toContain('#/components/schemas/ThemeBody');
    expect(text).not.toContain('surfacePage');
    expect(JSON.stringify(schemas.ThemeBody)).toContain('#/components/schemas/Palette');
    expect(JSON.stringify(schemas.ThemeBody)).not.toContain('surfacePage');
  });
});
