import { describe, expect, it } from 'vitest';
import { ADMIN_ROUTES } from '#/service/capability';
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

  it('still documents a successful response as application/json', () => {
    const document = buildAdminOpenApiDocument();
    for (const route of ADMIN_ROUTES) {
      const path = route.pattern.replace(/:(\w+)/gu, '{$1}');
      const status = String(route.successStatus ?? 200);
      const response = document.paths[path]?.[route.method.toLowerCase()]?.responses[status];
      expect(response?.content, `${route.method} ${path} ${status}`).toHaveProperty(
        'application/json',
      );
    }
  });
});
