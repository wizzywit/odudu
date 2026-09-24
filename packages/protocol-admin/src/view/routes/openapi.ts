import { problemDetailsSchema } from '@odudu/contracts/admin';
import { ADMIN_API_AUDIENCE } from '@odudu/domain-tenant';
import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ADMIN_ROUTES, type AdminRoute } from '#/service/capability';

type JsonSchema = z.core.JSONSchema.BaseSchema;

interface OpenApiParameterRef {
  readonly $ref: string;
}

interface OpenApiResponse {
  readonly description: string;
  readonly content?: Readonly<Record<string, { readonly schema: JsonSchema }>>;
}

interface OpenApiOperation {
  readonly summary: string;
  readonly parameters: readonly OpenApiParameterRef[];
  readonly responses: Readonly<Record<string, OpenApiResponse>>;
}

export interface OpenApiDocument {
  readonly openapi: '3.1.0';
  readonly info: { readonly title: string; readonly version: string };
  readonly security: readonly Readonly<Record<string, readonly string[]>>[];
  readonly paths: Readonly<Record<string, Readonly<Record<string, OpenApiOperation>>>>;
  readonly components: {
    readonly parameters: { readonly tenant: unknown };
    readonly securitySchemes: { readonly bearerAuth: unknown };
    readonly schemas: { readonly ProblemDetails: JsonSchema };
  };
}

function jsonSchemaFor(schema: z.ZodType): JsonSchema {
  return z.toJSONSchema(schema, { unrepresentable: 'any' });
}

const TENANT_PARAMETER = {
  name: 'tenant',
  in: 'path',
  required: true,
  description: 'The tenant being administered, addressed by name.',
  schema: { type: 'string' },
};

const BEARER_SECURITY_SCHEME = {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description:
    `An access token whose "aud" claim names ${ADMIN_API_AUDIENCE}. ` +
    'A token minted for another audience, including the protocol surface itself, is refused with 401.',
};

// sendProblem (#/view/problem) sends RFC 9457 bodies as
// application/problem+json, never application/json — a client generated
// from this document has to pick that decoder for 401 and 403.
const PROBLEM_DETAILS_RESPONSE: OpenApiResponse = {
  description: 'RFC 9457 problem details',
  content: { 'application/problem+json': { schema: jsonSchemaFor(problemDetailsSchema) } },
};

function operationFor(route: AdminRoute): OpenApiOperation {
  const status = String(route.successStatus ?? 200);
  const responses: Record<string, OpenApiResponse> = {
    [status]: {
      description: status === '201' ? 'Created' : 'OK',
      content: { 'application/json': { schema: jsonSchemaFor(route.responseSchema) } },
    },
    '401': PROBLEM_DETAILS_RESPONSE,
  };
  if (route.capability !== null) {
    responses['403'] = PROBLEM_DETAILS_RESPONSE;
  }

  return {
    summary:
      route.capability === null
        ? 'Requires an authenticated admin caller.'
        : `Requires the "${route.capability}" capability.`,
    // A route with no `:tenant` segment administers the collection itself,
    // not one tenant's data, so it carries no tenant path parameter.
    parameters: route.pattern.includes(':tenant')
      ? [{ $ref: '#/components/parameters/tenant' }]
      : [],
    responses,
  };
}

/**
 * Generated from `ADMIN_ROUTES`, never hand-maintained: a route the router
 * serves and this omits, or the reverse, is what `openapi.int.test.ts`
 * checks for. `/admin/openapi.json` itself is deliberately absent from
 * `paths` — it is served outside `ADMIN_ROUTES`, unauthenticated, because a
 * client that cannot read it cannot generate against it.
 */
export function buildAdminOpenApiDocument(): OpenApiDocument {
  const paths: Record<string, Record<string, OpenApiOperation>> = {};
  for (const route of ADMIN_ROUTES) {
    const path = route.pattern.replace(/:(\w+)/gu, '{$1}');
    const methods = paths[path] ?? {};
    methods[route.method.toLowerCase()] = operationFor(route);
    paths[path] = methods;
  }

  return {
    openapi: '3.1.0',
    info: { title: 'Odudu admin API', version: '0.0.0' },
    security: [{ bearerAuth: [] }],
    paths,
    components: {
      parameters: { tenant: TENANT_PARAMETER },
      securitySchemes: { bearerAuth: BEARER_SECURITY_SCHEME },
      schemas: { ProblemDetails: jsonSchemaFor(problemDetailsSchema) },
    },
  };
}

export function registerOpenApiRoute(app: FastifyInstance): void {
  const document = buildAdminOpenApiDocument();
  app.get('/admin/openapi.json', (_request, reply) => reply.code(200).send(document));
}
