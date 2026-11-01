import { paletteSchema, themeBodySchema, themeLogoSchema } from '@odudu/contracts';
import { problemDetailsSchema } from '@odudu/contracts/admin';
import { documentedJsonSchema } from '@odudu/contracts/admin/docs';
import { ADMIN_API_AUDIENCE } from '@odudu/domain-tenant';
import { type FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { ADMIN_ROUTES, type AdminRoute } from '#/service/capability';
import { pathParameterNames, rowIdSchema } from '#/service/path-params';

type JsonSchema = z.core.JSONSchema.BaseSchema;

interface OpenApiParameter {
  readonly name: string;
  readonly in: 'path' | 'query';
  readonly required: boolean;
  readonly description?: string;
  readonly schema: JsonSchema;
}

type OpenApiParameterOrRef = { readonly $ref: string } | OpenApiParameter;

interface OpenApiResponse {
  readonly description: string;
  readonly content?: Readonly<Record<string, { readonly schema: JsonSchema }>>;
}

interface OpenApiOperation {
  readonly summary: string;
  readonly description?: string;
  readonly parameters: readonly OpenApiParameterOrRef[];
  readonly requestBody?: {
    readonly required: true;
    readonly content: Readonly<Record<string, { readonly schema: JsonSchema }>>;
  };
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
    readonly schemas: {
      readonly ProblemDetails: JsonSchema;
      readonly ThemeBody: JsonSchema;
      readonly Palette: JsonSchema;
      readonly Logo: JsonSchema;
    };
  };
}

function jsonSchemaFor(schema: z.ZodType): JsonSchema {
  return documentedJsonSchema(schema);
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

// Every template variable in the path, because OpenAPI requires each one to
// be declared and a generated client cannot fill one it was not told about.
// Derived from the same pattern `paramsSchemaFor` narrows, so the document
// and the check cannot describe different ids. A route with no `:tenant`
// segment administers the collection itself and carries none.
function pathParametersFor(pattern: string): OpenApiParameterOrRef[] {
  return pathParameterNames(pattern).map((name) =>
    name === 'tenant'
      ? { $ref: '#/components/parameters/tenant' }
      : {
          name,
          in: 'path' as const,
          required: true as const,
          description: 'A row id.',
          schema: jsonSchemaFor(rowIdSchema),
        },
  );
}

// One query parameter per property of the schema the router validates the
// querystring against, so the document and the check cannot disagree.
function queryParametersFor(schema: z.ZodType | undefined): OpenApiParameter[] {
  if (schema === undefined) return [];
  const json = jsonSchemaFor(schema);
  const required = new Set(json.required ?? []);
  return Object.entries(json.properties ?? {}).map(([name, property]) => ({
    name,
    in: 'query' as const,
    required: required.has(name),
    schema: typeof property === 'boolean' ? {} : property,
  }));
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function without(node: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(node).filter(([name]) => name !== key));
}

const COMPONENT_PREFIX = '#/components/schemas/';

// A shape that occurs more than once, in the theme view for the draft and for
// the published version, on every route that answers a theme, and for each of
// the two colour schemes, is written once under `components` and named
// wherever it occurs, with the field's own description beside the reference.
function sharing(node: unknown, shape: string, name: string): unknown {
  if (Array.isArray(node)) return node.map((child) => sharing(child, shape, name));
  if (!isJsonObject(node)) return node;
  if (JSON.stringify(without(node, 'description')) === shape) {
    return {
      $ref: `${COMPONENT_PREFIX}${name}`,
      ...(node.description === undefined ? {} : { description: node.description }),
    };
  }
  return Object.fromEntries(
    Object.entries(node).map(([key, child]) => [key, sharing(child, shape, name)]),
  );
}

function standalone(schema: z.ZodType): JsonSchema {
  return without(jsonSchemaFor(schema), '$schema');
}

function operationFor(route: AdminRoute): OpenApiOperation {
  const status = String(route.successStatus ?? 200);
  const responses: Record<string, OpenApiResponse> = {
    [status]: {
      description: status === '201' ? 'Created' : 'OK',
      content: {
        [route.successMediaType ?? 'application/json']: {
          schema: jsonSchemaFor(route.responseSchema),
        },
      },
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
        : route.alsoAdmits === undefined
          ? `Requires the "${route.capability}" capability.`
          : `Requires the "${route.capability}" capability, or ${route.alsoAdmits
              .map((also) => `"${also}"`)
              .join(' or ')}.`,
    ...(route.description === undefined ? {} : { description: route.description }),
    parameters: [
      ...pathParametersFor(route.pattern),
      ...queryParametersFor(route.querystringSchema),
    ],
    ...(route.bodySchema === undefined
      ? {}
      : {
          requestBody: {
            required: true as const,
            content: { 'application/json': { schema: jsonSchemaFor(route.bodySchema) } },
          },
        }),
    ...(route.rawBody === undefined
      ? {}
      : {
          requestBody: {
            required: true as const,
            content: Object.fromEntries(
              route.rawBody.contentTypes.map((type) => [
                type,
                { schema: { type: 'string', format: 'binary' } },
              ]),
            ),
          },
        }),
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

  const themeBody = standalone(themeBodySchema);
  const palette = JSON.stringify(standalone(paletteSchema));
  const logo = JSON.stringify(standalone(themeLogoSchema));
  const parts = (node: unknown): unknown =>
    sharing(sharing(node, palette, 'Palette'), logo, 'Logo');
  const shared = (node: unknown): unknown =>
    parts(sharing(node, JSON.stringify(themeBody), 'ThemeBody'));
  return {
    openapi: '3.1.0',
    info: { title: 'Odudu admin API', version: '0.0.0' },
    security: [{ bearerAuth: [] }],
    paths: shared(paths) as OpenApiDocument['paths'],
    components: {
      parameters: { tenant: TENANT_PARAMETER },
      securitySchemes: { bearerAuth: BEARER_SECURITY_SCHEME },
      schemas: {
        ProblemDetails: jsonSchemaFor(problemDetailsSchema),
        ThemeBody: parts(themeBody) as JsonSchema,
        Palette: standalone(paletteSchema),
        Logo: standalone(themeLogoSchema),
      },
    },
  };
}

export function registerOpenApiRoute(app: FastifyInstance): void {
  const document = buildAdminOpenApiDocument();
  // Readable from any origin so a viewer on another port can load it: the
  // document is public already, and no credential is ever allowed with it.
  app.get('/admin/openapi.json', (_request, reply) =>
    reply.code(200).header('access-control-allow-origin', '*').send(document),
  );
}
