import { assignScopeToClientResponseSchema } from '@odudu/contracts/admin';
import { documentedJsonSchema } from '@odudu/contracts/admin/docs';
import { KERNEL_VERSION } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { ADMIN_ROUTES } from '#/service/capability';
import { idempotentMethod } from '#/service/idempotency';
import { buildAdminOpenApiDocument } from '#/view/routes/openapi';

// The pretty-printed size before problem responses and repeated schemas were
// shared, and a ceiling over the size now plus 5 per cent, rounded up to a whole
// kilobyte. Measured at 837,042 bytes with the assistant's settings and chat
// routes in; the ceiling was 815,104 before those routes were added and the
// document then measured 817,624, so it is raised to 859,136, 2.6 per cent over.
const ADMIN_DOCUMENT_BASELINE_BYTES = 2_304_007;
const ADMIN_DOCUMENT_MAX_BYTES = 859_136;

type Document = ReturnType<typeof buildAdminOpenApiDocument>;

function lookup(document: Document, ref: string): unknown {
  let node: unknown = document;
  for (const part of ref.replace(/^#\//u, '').split('/')) {
    node = typeof node === 'object' && node !== null ? Reflect.get(node, part) : undefined;
  }
  return node;
}

// The node with every `$ref` replaced by the component it names; the
// description beside a reference wins over the component's own.
function inlined(document: Document, node: unknown): unknown {
  if (Array.isArray(node)) return node.map((child) => inlined(document, child));
  if (typeof node !== 'object' || node === null) return node;
  const { $ref: ref, ...rest } = node as Record<string, unknown>;
  const own = Object.fromEntries(
    Object.entries(rest).map(([key, child]) => [key, inlined(document, child)]),
  );
  return typeof ref === 'string'
    ? { ...(inlined(document, lookup(document, ref)) as object), ...own }
    : own;
}

function withoutDialect(schema: unknown): unknown {
  return Object.fromEntries(
    Object.entries(schema as Record<string, unknown>).filter(([key]) => key !== '$schema'),
  );
}

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
        const response = inlined(document, responses[status]) as
          { content?: Record<string, unknown> } | undefined;
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
        const response = inlined(document, responses[status]) as
          { content?: Record<string, unknown> } | undefined;
        expect(response?.content, `${route.method} ${path} ${status}`).toHaveProperty(
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
      if (status === '204') continue;
      const response = document.paths[path]?.[route.method.toLowerCase()]?.responses[status] as
        { content?: object } | undefined;
      expect(response?.content, `${route.method} ${path} ${status}`).toHaveProperty([
        route.successMediaType ?? 'application/json',
      ]);
    }
  });

  it('documents a 204 as No Content, with no body', () => {
    const document = buildAdminOpenApiDocument();
    let seen = 0;
    for (const route of ADMIN_ROUTES) {
      if (route.successStatus !== 204) continue;
      const path = route.pattern.replace(/:(\w+)/gu, '{$1}');
      const response = document.paths[path]?.[route.method.toLowerCase()]?.responses['204'];
      expect(response, `${route.method} ${path}`).toEqual({ description: 'No Content' });
      seen += 1;
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('documents the tenant export as its own media type', () => {
    const response =
      buildAdminOpenApiDocument().paths['/admin/tenants/{tenant}/export']?.get?.responses['200'];
    expect(Object.keys((response as { content?: object }).content ?? {})).toEqual([
      'application/vnd.odudu.tenant+json',
    ]);
  });

  // The route answers the client's scope assignments, never the client,
  // which reading takes a stronger capability than this route asks for.
  it('documents a scope assignment as the assignments the route answers', () => {
    const document = buildAdminOpenApiDocument();
    const response = document.paths['/admin/tenants/{tenant}/scopes/{id}/clients/{clientId}']?.put
      ?.responses['200'] as { content?: Record<string, { schema: unknown }> };
    expect(
      withoutDialect(inlined(document, response.content?.['application/json']?.schema)),
    ).toEqual(withoutDialect(documentedJsonSchema(assignScopeToClientResponseSchema)));
  });

  it('writes the theme body once and names it, with the palette, wherever a theme answers', () => {
    const document = buildAdminOpenApiDocument();
    const schemas = document.components.schemas;
    expect(Object.keys(schemas)).toEqual(
      expect.arrayContaining(['ThemeBody', 'Palette', 'Logo', 'ProblemDetails']),
    );
    const response = document.paths['/admin/tenants/{tenant}/theme']?.get?.responses['200'] as {
      content?: Record<string, { schema: { $ref: string } }>;
    };
    const view = lookup(document, response.content?.['application/json']?.schema.$ref ?? '');
    const text = JSON.stringify(view);
    expect(text).toContain('#/components/schemas/ThemeBody');
    expect(text).not.toContain('surfacePage');
    expect(JSON.stringify(schemas)).toContain('#/components/schemas/Palette');
    expect(JSON.stringify(schemas.ThemeBody)).not.toContain('surfacePage');
  });

  it('names the server version in info.version', () => {
    expect(buildAdminOpenApiDocument().info.version).toBe(KERNEL_VERSION);
  });

  it('answers every error status with a reference to a shared problem response', () => {
    const document = buildAdminOpenApiDocument();
    const named = Object.keys(document.components.responses);
    for (const [path, methods] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        for (const [status, response] of Object.entries(operation.responses)) {
          if (Number(status) < 400) continue;
          expect(response, `${method} ${path} ${status}`).toHaveProperty('$ref');
          const name = JSON.stringify(response).replace(
            /^.*#\/components\/responses\/(\w+).*$/u,
            '$1',
          );
          expect(named, `${method} ${path} ${status}`).toContain(name);
        }
      }
    }
    for (const name of [
      'BadRequest',
      'Unauthorized',
      'Forbidden',
      'NotFound',
      'Conflict',
      'PreconditionFailed',
      'TooManyRequests',
    ]) {
      const response = document.components.responses[name];
      expect(response?.content, name).toHaveProperty('application/problem+json');
      expect(JSON.stringify(response)).toContain('#/components/schemas/ProblemDetails');
    }
  });

  it('writes an object schema that occurs three or more times once, as a component', () => {
    const document = buildAdminOpenApiDocument();
    const counts = new Map<string, number>();
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (typeof node !== 'object' || node === null) return;
      const shape = Object.fromEntries(
        Object.entries(node).filter(([key]) => key !== '$schema' && key !== 'description'),
      );
      if ('properties' in shape) {
        const key = JSON.stringify(shape);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      Object.values(node).forEach(visit);
    };
    visit(document.paths);
    visit(document.components.schemas);
    const repeated = [...counts].filter(([, count]) => count >= 3);
    expect(repeated.map(([key, count]) => `${String(count)}x ${key.slice(0, 80)}`)).toEqual([]);
  });

  it('is smaller than it was before the shared components, and stays under its ceiling', () => {
    const size = JSON.stringify(buildAdminOpenApiDocument(), null, 2).length;
    expect(size).toBeLessThan(ADMIN_DOCUMENT_BASELINE_BYTES);
    expect(size).toBeLessThanOrEqual(ADMIN_DOCUMENT_MAX_BYTES);
  });
});
