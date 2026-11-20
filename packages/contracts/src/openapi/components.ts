import { COMPONENT_PREFIX, type JsonSchema } from '#/openapi/schema';

export interface OpenApiParameter {
  readonly name: string;
  readonly in: 'path' | 'query' | 'header';
  readonly required: boolean;
  readonly description?: string;
  readonly schema: JsonSchema;
}

export type OpenApiParameterOrRef = { readonly $ref: string } | OpenApiParameter;

export interface OpenApiResponse {
  readonly description: string;
  readonly content?: Readonly<Record<string, { readonly schema: JsonSchema }>>;
  readonly headers?: Readonly<Record<string, unknown>>;
}

export type OpenApiResponseOrRef = { readonly $ref: string } | OpenApiResponse;

export interface OpenApiOperation {
  readonly summary: string;
  readonly description?: string;
  readonly security?: readonly Readonly<Record<string, readonly string[]>>[];
  readonly parameters: readonly OpenApiParameterOrRef[];
  readonly requestBody?: {
    readonly required: boolean;
    readonly content: Readonly<Record<string, { readonly schema: JsonSchema }>>;
  };
  readonly responses: Readonly<Record<string, OpenApiResponseOrRef>>;
}

export function bearerSecurityScheme(description: string) {
  return { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description };
}

// A shared error response: the body is the component named `schemaName`, sent
// as `mediaType`, the one the server really sends so a generated client picks
// the right decoder.
export function errorResponse(
  description: string,
  schemaName: string,
  mediaType: string,
): OpenApiResponse {
  return {
    description,
    content: { [mediaType]: { schema: { $ref: `${COMPONENT_PREFIX}${schemaName}` } } },
  };
}

// One query parameter per property of the schema a route validates its
// querystring against, so the document and the check cannot disagree.
export function queryParametersOf(json: JsonSchema): OpenApiParameter[] {
  const required = new Set(json.required ?? []);
  return Object.entries(json.properties ?? {}).map(([name, property]) => ({
    name,
    in: 'query' as const,
    required: required.has(name),
    schema: typeof property === 'boolean' ? {} : property,
  }));
}
