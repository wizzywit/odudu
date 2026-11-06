import { LOCALISED_TEXT_ENTRIES_MAX, noBidiControls, NUL_REFUSED_MESSAGE } from '@odudu/contracts';
import { CLIENT_NAME_MAX, DESCRIPTION_MAX } from '@odudu/contracts/admin';
import type { AdminCapability } from '@odudu/protocol-admin';
import { z } from 'zod';
import { problemOf } from '#/service/call-tool';
import { defineTool } from '#/service/define-tool';
import { ETAG_MAX_LENGTH, ETAG_PATTERN, isEtag } from '#/service/etag-shape';
import { cleanData, type CleanStats } from '#/service/sanitize';
import { DATA_NOTICE, idField } from '#/service/read-tool';
import {
  ToolProblem,
  type AdminCaller,
  type JsonObject,
  type JsonValue,
  type RegisteredTool,
} from '#/service/tool';

// Under the in-process caller's own cap on a body, so a combination of fields
// each within bounds is refused as an argument and never as a failure.
const BODY_BUDGET_BYTES = 60_000;

// Text a person reads: no bidirectional control and no NUL, which a text column
// cannot hold. A pattern, so the schema a client lists carries it.
function text(schema: z.ZodString): z.ZodString {
  return noBidiControls(schema).regex(/^[^\u0000]*$/u, { error: `text ${NUL_REFUSED_MESSAGE}` });
}

const TAG_PATTERN = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8}){0,4}$/;

export const ifMatchField = z
  .string()
  .max(ETAG_MAX_LENGTH)
  .regex(ETAG_PATTERN, { message: 'must be one quoted ETag, as the read returned it' })
  .describe('The etag of the previous read of this resource, with its quotes.');

export const nameField = text(z.string().min(1).max(CLIENT_NAME_MAX)).describe(
  `The display name, at most ${String(CLIENT_NAME_MAX)} characters.`,
);

export const descriptionField = text(z.string().min(1).max(DESCRIPTION_MAX))
  .nullable()
  .describe(`The description, at most ${String(DESCRIPTION_MAX)} characters; null clears it.`);

// Text by language tag, replacing the whole map. The admin API also holds it
// to the tenant's languages, which only it knows.
export function localisedField(max: number, what: string): z.ZodType<Record<string, string>> {
  return z
    .record(
      z.string().max(35).regex(TAG_PATTERN, { message: 'must be a language tag' }),
      text(z.string().min(1).max(max)),
    )
    .refine((map) => Object.keys(map).length <= LOCALISED_TEXT_ENTRIES_MAX, {
      message: `at most ${String(LOCALISED_TEXT_ENTRIES_MAX)} languages`,
    })
    .describe(`The ${what} by language tag, replacing every language held now.`);
}

const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
} as const;

function jsonOf(value: unknown): JsonValue {
  if (value === null || typeof value === 'string') return value;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]): [string, JsonValue] => [key, jsonOf(item)]),
    );
  }
  throw new Error('a write tool sends strings, null and records of them');
}

function bodyOf(fields: readonly string[], input: object): JsonObject {
  return Object.fromEntries(
    fields.flatMap((field): [string, JsonValue][] => {
      const value: unknown = Reflect.get(input, field);
      return value === undefined ? [] : [[field, jsonOf(value)]];
    }),
  );
}

function stringOf(input: object, field: string): string {
  const value: unknown = Reflect.get(input, field);
  if (typeof value !== 'string') throw new Error(`${field} is a string once validated`);
  return value;
}

// Why the tools are hinted as not destructive though they overwrite: what is
// replaced is a line of text, kept in the audit row, and putting it back is the
// same call. A client that asks before every write can still ask.
const CLEARS =
  'Sending null for a description, or an empty map for a language text, clears what was there; ' +
  'the audit row keeps the earlier text, so it can be put back.';

const REFUSED =
  'insufficient_scope: a token holding mcp:write may change only the descriptive fields of a client ' +
  'or a scope, never the name of a built-in client; check the target and the fields.';

const STALE =
  'The resource changed since it was read. Read it again with the matching get tool, ' +
  'then send the etag that read returned as if_match.';

export interface MetadataToolConfig<F extends z.ZodRawShape> {
  readonly name: string;
  readonly description: string;
  readonly routeKey: string;
  readonly capability: AdminCapability;
  readonly what: string;
  // The admitted body fields, as the admin API's agent allowlist names them.
  readonly fields: F;
  readonly response: z.ZodType;
}

// A PATCH of descriptive fields under the optimistic lock: the id, the etag of
// the read it is based on, and at least one of the fields. Nothing else is
// accepted, so the schema is the second line behind the admin API's own
// allowlist, and a stale etag is the admin API's 412, said as one.
export function metadataTool<F extends z.ZodRawShape>(cfg: MetadataToolConfig<F>): RegisteredTool {
  const names = Object.keys(cfg.fields);
  const pattern = cfg.routeKey.slice(cfg.routeKey.indexOf(' ') + 1);
  const input = z
    .strictObject({ id: idField(cfg.what), if_match: ifMatchField, ...cfg.fields })
    .superRefine((value, ctx) => {
      const body = bodyOf(names, value);
      if (Object.keys(body).length === 0) {
        ctx.addIssue({ code: 'custom', message: `name at least one of ${names.join(', ')}` });
      } else if (Buffer.byteLength(JSON.stringify(body)) > BODY_BUDGET_BYTES) {
        ctx.addIssue({ code: 'custom', message: 'the text is too long in all' });
      }
    });
  return defineTool({
    name: cfg.name,
    description: `${cfg.description} ${CLEARS} ${DATA_NOTICE}`,
    routeKey: cfg.routeKey,
    capability: cfg.capability,
    access: 'write',
    bodyFields: names,
    annotations: WRITE_ANNOTATIONS,
    input,
    response: cfg.response,
    output: z.object({
      data: cfg.response,
      etag: z.string().regex(ETAG_PATTERN).optional(),
      truncated: z.literal(true).optional(),
    }),
    run: async (caller: AdminCaller, args) => {
      const id = stringOf(args, 'id');
      const ifMatch = stringOf(args, 'if_match');
      const result = await caller.call({
        method: 'PATCH',
        pattern,
        params: { id },
        query: {},
        body: bodyOf(names, args),
        ifMatch,
      });
      if (result.status === 412) {
        const problem = problemOf(result);
        throw new ToolProblem(problem.problemType, problem.title, 412, STALE);
      }
      if (result.status === 403) {
        const problem = problemOf(result);
        if (problem.detail !== 'insufficient_scope') throw problem;
        throw new ToolProblem(problem.problemType, problem.title, 403, REFUSED);
      }
      if (result.status < 200 || result.status >= 300) throw problemOf(result);
      const stats: CleanStats = { truncated: false };
      const data = cfg.response.parse(cleanData(cfg.response.parse(result.body), stats));
      const etag = result.headers.etag;
      return {
        data,
        ...(isEtag(etag) ? { etag } : {}),
        ...(stats.truncated ? { truncated: true as const } : {}),
      };
    },
  });
}
