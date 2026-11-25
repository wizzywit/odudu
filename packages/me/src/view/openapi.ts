import { meErrorSchema } from '@odudu/contracts/me';
import {
  bearerSecurityScheme,
  errorResponse,
  hoistRepeatedSchemas,
  queryParametersOf,
  without,
  type JsonSchema,
  type OpenApiOperation,
  type OpenApiParameter,
  type OpenApiParameterOrRef,
  type OpenApiResponse,
  type OpenApiResponseOrRef,
} from '@odudu/contracts/openapi';
import { KERNEL_VERSION } from '@odudu/kernel';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ME_ROUTES, type MeRoute } from '#/view/routes';

export interface MeOpenApiDocument {
  readonly openapi: '3.1.0';
  readonly info: { readonly title: string; readonly version: string };
  readonly security: readonly Readonly<Record<string, readonly string[]>>[];
  readonly paths: Readonly<Record<string, Readonly<Record<string, OpenApiOperation>>>>;
  readonly components: {
    readonly parameters: { readonly tenant: OpenApiParameter };
    readonly securitySchemes: { readonly bearerAuth: unknown };
    readonly responses: Readonly<Record<string, OpenApiResponse>>;
    readonly schemas: { readonly MeError: JsonSchema } & Readonly<Record<string, JsonSchema>>;
  };
}

function jsonSchemaFor(schema: z.ZodType): JsonSchema {
  return without(z.toJSONSchema(schema, { unrepresentable: 'any' }), '$schema');
}

const TENANT_PARAMETER: OpenApiParameter = {
  name: 'tenant',
  in: 'path',
  required: true,
  description: 'The tenant, addressed by name.',
  schema: { type: 'string' },
};

const CHALLENGE_HEADER = {
  'WWW-Authenticate': {
    description:
      'The Bearer challenge (RFC 6750), with the RFC 9470 step-up parameters when a recent sign-in is needed.',
    schema: { type: 'string' },
  },
};

// What each error status means across the me API. A refusal that needs no
// body, such as a missing token, is sent with none.
const ERROR_RESPONSES: Readonly<Record<number, readonly [string, OpenApiResponse]>> = {
  400: [
    'BadRequest',
    errorResponse('The request is malformed or fails validation.', 'MeError', 'application/json'),
  ],
  401: [
    'Unauthorized',
    {
      description:
        'No usable token, a session that has ended, or a sign-in too old for the change. No body; the challenge says which.',
      headers: CHALLENGE_HEADER,
    },
  ],
  403: [
    'Forbidden',
    {
      ...errorResponse(
        'Either the token lacks the scope (`insufficient_scope`: no body, with a `WWW-Authenticate` challenge) or it was issued to an agent for a change (`agent_not_permitted`: an error body, no challenge).',
        'MeError',
        'application/json',
      ),
      headers: CHALLENGE_HEADER,
    },
  ],
  404: [
    'NotFound',
    errorResponse(
      'The tenant is unknown or disabled (no body), or the addressed record does not exist (an error body).',
      'MeError',
      'application/json',
    ),
  ],
  409: [
    'Conflict',
    errorResponse('The change conflicts with the current state.', 'MeError', 'application/json'),
  ],
  429: [
    'TooManyRequests',
    {
      description: 'The origin is over its budget; `Retry-After` says how long to wait.',
      headers: { 'Retry-After': { schema: { type: 'integer' } } },
    },
  ],
  503: [
    'ServiceUnavailable',
    errorResponse('The server cannot carry the change now.', 'MeError', 'application/json'),
  ],
};

function pathParameters(route: MeRoute): OpenApiParameterOrRef[] {
  const members = route.params === undefined ? {} : (jsonSchemaFor(route.params).properties ?? {});
  return [
    { $ref: '#/components/parameters/tenant' },
    ...Object.entries(members).map(([name, schema]) => ({
      name,
      in: 'path' as const,
      required: true as const,
      schema: typeof schema === 'boolean' ? {} : schema,
    })),
  ];
}

function responseFor(status: number, answer: z.ZodType | 'error' | 'empty'): OpenApiResponseOrRef {
  if (answer === 'error') {
    const shared = ERROR_RESPONSES[status];
    if (shared === undefined) throw new Error(`no shared response for ${String(status)}`);
    return { $ref: `#/components/responses/${shared[0]}` };
  }
  const description = status === 202 ? 'Accepted' : status === 201 ? 'Created' : 'OK';
  if (answer === 'empty') return { description: 'No content' };
  return {
    description,
    content: { 'application/json': { schema: jsonSchemaFor(answer) } },
  };
}

function operationFor(route: MeRoute): OpenApiOperation {
  return {
    summary: route.summary,
    security: [{ bearerAuth: [route.scope] }],
    parameters: [
      ...pathParameters(route),
      ...(route.query === undefined ? [] : queryParametersOf(jsonSchemaFor(route.query))),
    ],
    ...(route.body === undefined
      ? {}
      : {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: jsonSchemaFor(route.body) } },
          },
        }),
    responses: Object.fromEntries(
      Object.entries(route.responses).map(([status, answer]) => [
        status,
        responseFor(Number(status), answer),
      ]),
    ),
  };
}

/**
 * Generated from `ME_ROUTES`. `/me/openapi.json` is absent from `paths`: it
 * is served outside the table, unauthenticated, so that a client can read it
 * before it has a token.
 */
export function buildMeOpenApiDocument(): MeOpenApiDocument {
  const paths: Record<string, Record<string, OpenApiOperation>> = {};
  for (const route of ME_ROUTES) {
    const path = route.url.replace(/:(\w+)/gu, '{$1}');
    const methods = paths[path] ?? {};
    methods[route.method.toLowerCase()] = operationFor(route);
    paths[path] = methods;
  }
  const hoisted = hoistRepeatedSchemas(paths, { MeError: jsonSchemaFor(meErrorSchema) }, [
    'tenants',
    'me',
  ]);
  return {
    openapi: '3.1.0',
    info: { title: 'Odudu me API', version: KERNEL_VERSION },
    security: [{ bearerAuth: [] }],
    paths: hoisted.paths as MeOpenApiDocument['paths'],
    components: {
      parameters: { tenant: TENANT_PARAMETER },
      securitySchemes: {
        bearerAuth: bearerSecurityScheme(
          'An access token whose "aud" claim is the tenant’s `/me` URL, with the scope the operation names. A token minted for another audience is refused with 401.',
        ),
      },
      responses: Object.fromEntries(Object.values(ERROR_RESPONSES)),
      schemas: hoisted.schemas as MeOpenApiDocument['components']['schemas'],
    },
  };
}

export function registerMeOpenApiRoute(app: FastifyInstance): void {
  const document = buildMeOpenApiDocument();
  // Readable from any origin so a viewer on another port can load it: the
  // document is public already, and no credential is ever allowed with it.
  app.get('/me/openapi.json', (_request, reply) =>
    reply.code(200).header('access-control-allow-origin', '*').send(document),
  );
}
