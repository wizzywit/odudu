import { LOCALISED_TEXT_ENTRIES_MAX, noBidiControls } from '@odudu/contracts';
import { CLIENT_NAME_MAX, DESCRIPTION_MAX } from '@odudu/contracts/admin';
import type { AdminCapability } from '@odudu/protocol-admin';
import { z } from 'zod';
import { problemOf } from '#/service/call-tool';
import { defineTool } from '#/service/define-tool';
import { IDEMPOTENCY_KEY_PATTERN } from '#/service/admin-request';
import { ETAG_MAX_LENGTH, ETAG_PATTERN, isEtag } from '#/service/etag-shape';
import { cleanData, type CleanStats } from '#/service/sanitize';
import { jsonOf } from '#/service/json-value';
import { DATA_NOTICE, idField } from '#/service/read-tool';
import {
  ToolProblem,
  type AdminCaller,
  type AdminMethod,
  type AdminRequestSpec,
  type AdminResult,
  type JsonObject,
  type JsonValue,
  type RegisteredTool,
} from '#/service/tool';

// Under the in-process caller's own cap on a body, so a combination of fields
// each within bounds is refused as an argument and never as a failure.
const BODY_BUDGET_BYTES = 60_000;

// Characters nobody can see or that move the line: C0 and C1 controls but tab and
// line feed, DEL, soft hyphen, zero-width characters, the word joiner, the byte
// order mark and the line and paragraph separators.
const UNSEEN =
  '\\u0000-\\u0008\\u000b-\\u001f\\u007f-\\u009f\\u00ad\\u200b-\\u200d\\u2028\\u2029\\u2060\\ufeff';
const NO_UNSEEN = new RegExp(`^[^${UNSEEN}]*$`, 'u');
const NO_UNSEEN_OR_BREAK = new RegExp(`^[^${UNSEEN}\\t\\n]*$`, 'u');
const UNSEEN_REFUSED = 'holds a control or an invisible character';

// Text a person reads, which may run over lines: no bidirectional control, no NUL
// (a text column cannot hold one) and nothing unseen. A pattern, so the schema a
// client lists carries it.
export function text(schema: z.ZodString): z.ZodString {
  return noBidiControls(schema).regex(NO_UNSEEN, { error: `text ${UNSEEN_REFUSED}` });
}

// The same for one line, such as a name: no tab or line feed either.
export function line(schema: z.ZodString): z.ZodString {
  return noBidiControls(schema).regex(NO_UNSEEN_OR_BREAK, {
    error: `text ${UNSEEN_REFUSED}, or a line break`,
  });
}

const TAG_PATTERN = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8}){0,4}$/;

export const languageTagField = z
  .string()
  .max(35)
  .regex(TAG_PATTERN, { message: 'must be a language tag' });

export const ifMatchField = z
  .string()
  .max(ETAG_MAX_LENGTH)
  .regex(ETAG_PATTERN, { message: 'must be one quoted ETag, as the read returned it' })
  .describe('The etag of the previous read of this resource, with its quotes.');

export const nameField = line(z.string().min(1).max(CLIENT_NAME_MAX)).describe(
  `The display name, at most ${String(CLIENT_NAME_MAX)} characters.`,
);

// The admin API stores an empty description apart from null, and its client
// and scope amendments both accept one, so the tools do too: an earlier value
// of "" can then be put back.
export const descriptionField = text(z.string().max(DESCRIPTION_MAX))
  .nullable()
  .describe(
    `The description, at most ${String(DESCRIPTION_MAX)} characters; null clears it, ` +
      'and an empty string sets it to empty.',
  );

// Text by language tag, replacing the whole map. The admin API also holds it
// to the tenant's languages, which only it knows.
export function localisedField(max: number, what: string): z.ZodType<Record<string, string>> {
  return z
    .record(languageTagField, text(z.string().min(1).max(max)))
    .refine((map) => Object.keys(map).length <= LOCALISED_TEXT_ENTRIES_MAX, {
      message: `at most ${String(LOCALISED_TEXT_ENTRIES_MAX)} languages`,
    })
    .describe(`The ${what} by language tag, replacing every language held now.`);
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
export const UNKNOWN =
  'An mcp:outcome_unknown answer means the call ran out of time and the change may still have been ' +
  'made: read the resource with the get tool before sending it again.';

const REFUSED =
  'insufficient_scope: a token holding mcp:write may change only what this tool names; ' +
  'check the target and the fields.';

const STALE =
  'The resource changed since it was read. Read it again with the matching get tool, ' +
  'then send the etag that read returned as if_match.';

const KEY_ADVICE =
  'Choose a key of your own for this change, up to 255 letters, digits and _ . : -, and send ' +
  'the same key if you send the change again, so that it is made once.';

export const idempotencyKeyField = z
  .string()
  .max(255)
  .regex(IDEMPOTENCY_KEY_PATTERN, { message: 'must be 1 to 255 letters, digits and _ . : -' })
  .describe(KEY_ADVICE);

const RESERVED_ARGUMENTS = ['id', 'if_match', 'idempotency_key'];

export type ContentWriteMode = 'amend' | 'create' | 'put' | 'delete';

export interface ContentWriteConfig<F extends z.ZodRawShape> {
  readonly name: string;
  readonly description: string;
  readonly routeKey: string;
  readonly capability: AdminCapability;
  readonly what: string;
  // What the call does to the resource: amend its named fields under an etag,
  // create one under a key the client chose, replace one wholesale, or delete one.
  readonly mode: ContentWriteMode;
  // The admitted body fields, as the admin API's agent allowlist names them.
  readonly fields: F;
  readonly response: z.ZodType;
  // Path parameters other than the id an amend takes: a put and a delete name
  // the resource by these.
  readonly params?: z.ZodRawShape;
  // The bytes the body may take, when more than a line of text.
  readonly bodyCap?: number;
  // What a refusal by the door says, where the tool can say more than this.
  readonly refusal?: string;
  // A put with no etag asks to create and is refused for what exists (sent as
  // If-None-Match: *). Left out, a put without an etag sends no precondition.
  readonly createsWithoutEtag?: true;
  // What a 412 says, where the resource was not necessarily read first: a put
  // that creates is refused for a resource that exists.
  readonly stale?: string;
}

const ETAG_REQUIRED: Record<ContentWriteMode, boolean> = {
  amend: true,
  create: false,
  put: false,
  delete: true,
};

function annotationsOf(mode: ContentWriteMode) {
  return {
    readOnlyHint: false,
    destructiveHint: mode === 'delete',
    idempotentHint: mode !== 'create',
  } as const;
}

function pathParams(mode: ContentWriteMode, what: string, params?: z.ZodRawShape): z.ZodRawShape {
  if (mode === 'create') return {};
  if (params !== undefined) return params;
  return { id: idField(what) };
}

function inputShape<F extends z.ZodRawShape>(cfg: ContentWriteConfig<F>): z.ZodRawShape {
  const etag = ETAG_REQUIRED[cfg.mode] ? ifMatchField : ifMatchField.optional();
  return {
    ...(cfg.mode === 'create' ? { idempotency_key: idempotencyKeyField } : {}),
    ...pathParams(cfg.mode, cfg.what, cfg.params),
    ...(cfg.mode === 'create' ? {} : { if_match: etag }),
    ...cfg.fields,
  };
}

function checked(names: readonly string[], mode: ContentWriteMode, cap: number) {
  return (value: object, ctx: z.RefinementCtx): void => {
    const body = bodyOf(names, value);
    if (mode === 'amend' && Object.keys(body).length === 0) {
      ctx.addIssue({ code: 'custom', message: `name at least one of ${names.join(', ')}` });
    } else if (Buffer.byteLength(JSON.stringify(body)) > cap) {
      ctx.addIssue({ code: 'custom', message: 'the text is too long in all' });
    }
  };
}

function requestOf<F extends z.ZodRawShape>(
  cfg: ContentWriteConfig<F>,
  names: readonly string[],
  pattern: string,
  args: object,
): AdminRequestSpec {
  const method = cfg.routeKey.slice(0, cfg.routeKey.indexOf(' '));
  const params = Object.fromEntries(
    Object.keys(pathParams(cfg.mode, cfg.what, cfg.params)).map((name) => [
      name,
      stringOf(args, name),
    ]),
  );
  const ifMatch: unknown = Reflect.get(args, 'if_match');
  return {
    method: methodOf(method),
    pattern,
    params,
    query: {},
    ...(cfg.mode === 'delete' ? {} : { body: bodyOf(names, args) }),
    ...(typeof ifMatch === 'string' ? { ifMatch } : {}),
    ...(cfg.mode === 'put' && cfg.createsWithoutEtag === true && typeof ifMatch !== 'string'
      ? { createOnly: true as const }
      : {}),
    ...(cfg.mode === 'create' ? { idempotencyKey: stringOf(args, 'idempotency_key') } : {}),
    ...(cfg.bodyCap === undefined ? {} : { bodyCap: cfg.bodyCap }),
  };
}

function methodOf(method: string): AdminMethod {
  if (method === 'PATCH' || method === 'POST' || method === 'PUT' || method === 'DELETE') {
    return method;
  }
  throw new Error(`a content write tool is a PATCH, POST, PUT or DELETE, not ${method}`);
}

function refusedAs(result: AdminResult, advice: string, stale: string): ToolProblem {
  const problem = problemOf(result);
  if (result.status === 412) return new ToolProblem(problem.problemType, problem.title, 412, stale);
  if (result.status === 403 && problem.detail === 'insufficient_scope') {
    return new ToolProblem(problem.problemType, problem.title, 403, advice);
  }
  return problem;
}

// A put that creates when it names no etag adds a row, so that call spends a place
// of the create allowance too; one with an etag replaces.
function createsWhenUnmatched<F extends z.ZodRawShape>(cfg: ContentWriteConfig<F>) {
  if (cfg.mode !== 'put' || cfg.createsWithoutEtag !== true) return {};
  return {
    createsWhen: (input: unknown): boolean =>
      typeof Reflect.get(input as object, 'if_match') !== 'string',
  };
}

// A write of descriptive content, by one of four modes: the id and the etag of
// the read it is based on and at least one field to amend; a key the client
// chose and the fields to create; the parameters, an etag where there is one to
// replace (none asks to create, and is refused for what exists) and the fields
// to put; or the parameters and the etag to delete. The
// schema is the second line behind the admin API's own allowlist, and a stale
// etag is the admin API's 412, said as one.
export function contentWriteTool<F extends z.ZodRawShape>(
  cfg: ContentWriteConfig<F>,
): RegisteredTool {
  const names = Object.keys(cfg.fields);
  if (names.some((name) => RESERVED_ARGUMENTS.includes(name))) {
    throw new Error(`a field is named as a reserved argument (${RESERVED_ARGUMENTS.join(', ')})`);
  }
  const shared = Object.keys(cfg.params ?? {}).filter(
    (name) => names.includes(name) || (RESERVED_ARGUMENTS.includes(name) && name !== 'id'),
  );
  if (shared.length > 0) {
    throw new Error(`an argument is named twice or as a reserved one: ${shared.join(', ')}`);
  }
  const pattern = cfg.routeKey.slice(cfg.routeKey.indexOf(' ') + 1);
  const input = z
    .strictObject(inputShape(cfg))
    .superRefine(checked(names, cfg.mode, cfg.bodyCap ?? BODY_BUDGET_BYTES));
  const output = z.object({
    data: cfg.mode === 'delete' ? z.object({ deleted: z.literal(true) }) : cfg.response,
    etag: z.string().regex(ETAG_PATTERN).optional(),
    truncated: z.literal(true).optional(),
  });
  return defineTool({
    name: cfg.name,
    description: `${cfg.description} ${UNKNOWN} ${DATA_NOTICE}`,
    routeKey: cfg.routeKey,
    capability: cfg.capability,
    access: 'write',
    spends: cfg.mode === 'create' ? 'create' : 'mutating',
    ...createsWhenUnmatched(cfg),
    bodyFields: names,
    annotations: annotationsOf(cfg.mode),
    input,
    response: cfg.response,
    output,
    run: async (caller: AdminCaller, args) => {
      const result = await caller.call(requestOf(cfg, names, pattern, args));
      if (result.status < 200 || result.status >= 300) {
        throw refusedAs(result, cfg.refusal ?? REFUSED, cfg.stale ?? STALE);
      }
      if (cfg.mode === 'delete') return { data: { deleted: true as const } };
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

export interface MetadataToolConfig<F extends z.ZodRawShape> {
  readonly name: string;
  readonly description: string;
  readonly routeKey: string;
  readonly capability: AdminCapability;
  readonly what: string;
  // The admitted body fields, as the admin API's agent allowlist names them.
  readonly fields: F;
  readonly response: z.ZodType;
  // What a refusal by the door says, where the tool can say more than the default.
  readonly refusal?: string;
}

const CLEARS =
  'Sending null for a description, or an empty map for a language text, clears what was there; ' +
  'the audit row keeps the earlier text, so it can be put back.';

const CLEARS_TEXT =
  'Sending null for the description clears it; the audit row keeps the earlier text, ' +
  'so it can be put back.';

const METADATA_REFUSED =
  'insufficient_scope: a token holding mcp:write may change only the descriptive fields of a client ' +
  'or a scope, never the name of a built-in client; check the target and the fields.';

// A PATCH of descriptive fields under the optimistic lock: the id, the etag of
// the read it is based on, and at least one of the fields.
export function metadataTool<F extends z.ZodRawShape>(cfg: MetadataToolConfig<F>): RegisteredTool {
  const localised = Object.keys(cfg.fields).some((field) => field.endsWith('_i18n'));
  return contentWriteTool({
    ...cfg,
    description: `${cfg.description} ${localised ? CLEARS : CLEARS_TEXT}`,
    mode: 'amend',
    refusal: cfg.refusal ?? METADATA_REFUSED,
  });
}
