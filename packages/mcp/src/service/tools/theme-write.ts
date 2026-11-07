import {
  MAX_STYLESHEET_BYTES,
  MAX_TEMPLATE_BYTES,
  THEME_PAGE_KINDS,
  themeBodySchema,
  themeTokensSchema,
} from '@odudu/contracts';
import { fieldErrorSchema, themeSourcesSchema, themeViewSchema } from '@odudu/contracts/admin';
import type { AdminCapability } from '@odudu/protocol-admin';
import { z } from 'zod';
import { problemOf } from '#/service/call-tool';
import { defineTool } from '#/service/define-tool';
import { ETAG_PATTERN, isEtag } from '#/service/etag-shape';
import { DATA_NOTICE, idField } from '#/service/read-tool';
import { cleanData, type CleanStats } from '#/service/sanitize';
import { heldOf, mergedBody, THEME_WRITE_CAP_BYTES } from '#/service/theme-draft';
import {
  ToolProblem,
  type AdminCaller,
  type AdminRequestSpec,
  type AdminResult,
  type RegisteredTool,
} from '#/service/tool';
import { ifMatchField, text, UNKNOWN } from '#/service/write-tool';

// What one result carries of the draft: under the cap on a result with room for
// the rest of the answer. A larger draft is saved all the same and not echoed.
const ANSWER_BUDGET_BYTES = 200_000;

const TOKENS = themeTokensSchema.describe(
  'Colours of the light and dark schemes, as #rrggbb, and the font (IBM Plex Sans or IBM Plex Mono). ' +
    'Replaces every colour and the font held now.',
);

const STYLESHEET = text(z.string().max(MAX_STYLESHEET_BYTES))
  .nullable()
  .describe(
    `The stylesheet, at most ${String(MAX_STYLESHEET_BYTES / 1024)} KiB; null removes it. ` +
      'Only the classes, properties and values get_stylesheet_hooks lists are accepted.',
  );

const TEMPLATES = z
  .partialRecord(z.enum(THEME_PAGE_KINDS), text(z.string().max(MAX_TEMPLATE_BYTES)))
  .describe(
    `Page templates by page kind, each at most ${String(MAX_TEMPLATE_BYTES / 1024)} KiB. ` +
      'Replaces every template held now, so send each one that is to stay.',
  );

const NAMED = z.object({
  tokens: TOKENS.optional(),
  stylesheet: STYLESHEET.optional(),
  templates: TEMPLATES.optional(),
});

const IF_MATCH = ifMatchField
  .optional()
  .describe(
    'The etag that get_theme (get_client_theme for a client) returned beside the draft you are ' +
      'replacing, with its quotes. Leave it out only when that read says draft is null: the call ' +
      'then creates the first draft, and is refused when one exists.',
  );

const ANSWER = z.object({
  scope: z.enum(['tenant', 'client']),
  draft: themeBodySchema.nullable(),
  // The draft was saved and is not repeated, for it would not fit one result.
  draft_omitted: z.literal(true).optional(),
  draft_sources: themeSourcesSchema.nullable(),
  changed: themeViewSchema.shape.changed,
});

const LONG_TEXT = ['draft.stylesheet', 'draft.templates'] as const;

interface ThemeDraftConfig {
  readonly name: string;
  readonly capability: AdminCapability;
  readonly pattern: string;
  readonly client: boolean;
  readonly read: string;
  readonly subject: string;
  readonly refusal: string;
}

function descriptionOf(cfg: ThemeDraftConfig): string {
  return (
    `Changes ${cfg.subject}, which nothing shows until a person publishes it in the console: ` +
    'this tool cannot publish, restore, discard or reset a theme. Name at least one of tokens, ' +
    'stylesheet (null removes it) and templates; each named part replaces that part whole, and ' +
    'a part left out stays as the draft holds it (as the published theme holds it when there is ' +
    'no draft). Images are never changed here. The tool reads the draft itself and writes the ' +
    `parts you did not name exactly as stored. Send as if_match the etag ${cfg.read} returned ` +
    'beside the draft; leave it out only when that read says draft is null, which creates the ' +
    'first draft and is refused (412) when one exists. A stylesheet or template that fails the ' +
    'checks is a 400 that lists each problem under errors. At most 512 KiB in all. What ' +
    `${cfg.read} returns is cleaned (invisible, control and bidirectional characters removed) ` +
    'and may be cut (truncated: true), so never send text read from it back as a stylesheet or ' +
    'template unless you have checked it. Answers the draft cleaned (draft_omitted when it is too ' +
    'large for one result), which parts differ from the published theme and the new etag.'
  );
}

function staleOf(cfg: ThemeDraftConfig): ToolProblem {
  return new ToolProblem(
    'about:blank',
    'Precondition Failed',
    412,
    `The draft changed since it was read, or is not the one you named. Read it again with ${cfg.read}, ` +
      'then send the etag that read returned as if_match (none when it says draft is null).',
  );
}

function tooLargeToRead(): ToolProblem {
  return new ToolProblem(
    'mcp:theme_too_large',
    'The theme is too large for this tool to read',
    413,
    'The draft and the published theme together are larger than one admin answer this tool reads, ' +
      'so nothing was changed. Change this theme in the console.',
  );
}

function sentButUnread(cfg: ThemeDraftConfig): ToolProblem {
  return new ToolProblem(
    'mcp:outcome_unknown',
    'The draft was sent and the answer was too large to read, so whether it was saved is not known',
    504,
    `Read the draft again with ${cfg.read} before sending it again. ${UNKNOWN}`,
  );
}

function isTooLarge(error: unknown): boolean {
  return error instanceof ToolProblem && error.problemType === 'mcp:result_too_large';
}

function failed(result: AdminResult, cfg: ThemeDraftConfig): ToolProblem {
  const problem = problemOf(result);
  if (result.status === 403 && problem.detail === 'insufficient_scope') {
    return new ToolProblem(problem.problemType, problem.title, 403, cfg.refusal);
  }
  if (result.status !== 400) return problem;
  const body: unknown = result.body;
  const listed = z
    .array(fieldErrorSchema)
    .safeParse(typeof body === 'object' && body !== null ? Reflect.get(body, 'errors') : undefined);
  return new ToolProblem(
    problem.problemType,
    problem.title,
    400,
    problem.detail,
    listed.success ? listed.data : undefined,
  );
}

function paramsOf(cfg: ThemeDraftConfig, args: object): Record<string, string> {
  if (!cfg.client) return {};
  const id: unknown = Reflect.get(args, 'id');
  if (typeof id !== 'string') throw new Error('id is a string once validated');
  return { id };
}

async function readHeld(
  caller: AdminCaller,
  cfg: ThemeDraftConfig,
  params: Record<string, string>,
) {
  let result: AdminResult;
  try {
    result = await caller.call({
      method: 'GET',
      pattern: cfg.pattern,
      params,
      query: {},
      asWriter: true,
    });
  } catch (error) {
    if (isTooLarge(error)) throw tooLargeToRead();
    throw error;
  }
  if (result.status < 200 || result.status >= 300) throw failed(result, cfg);
  return heldOf(result.body, result.headers.etag);
}

// The answer to the model, cleaned as every read is. It is made from what the
// admin API answered to the write and is never an input to one.
function answerOf(answer: unknown): { data: z.infer<typeof ANSWER>; truncated?: true } {
  const view = themeViewSchema.parse(answer);
  const stats: CleanStats = { truncated: false };
  const cleaned = ANSWER.parse(
    cleanData(
      {
        scope: view.scope,
        draft: view.draft,
        draft_sources: view.draft_sources,
        changed: view.changed,
      },
      stats,
      { longText: LONG_TEXT },
    ),
  );
  const fits = Buffer.byteLength(JSON.stringify(cleaned)) <= ANSWER_BUDGET_BYTES;
  return {
    data: fits ? cleaned : { ...cleaned, draft: null, draft_omitted: true },
    ...(stats.truncated ? { truncated: true as const } : {}),
  };
}

function themeDraftTool(cfg: ThemeDraftConfig): RegisteredTool {
  const shape = {
    ...(cfg.client ? { id: idField('client') } : {}),
    if_match: IF_MATCH,
    tokens: TOKENS.optional(),
    stylesheet: STYLESHEET.optional(),
    templates: TEMPLATES.optional(),
  };
  const input = z.strictObject(shape).superRefine((value, ctx) => {
    // The parts are checked field by field first; this judges the three together.
    const parsed = NAMED.safeParse(value);
    if (!parsed.success) return;
    const named = parsed.data;
    if (Object.values(named).every((part) => part === undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'name at least one of tokens, stylesheet, templates',
      });
    } else if (Buffer.byteLength(JSON.stringify(named)) > THEME_WRITE_CAP_BYTES) {
      ctx.addIssue({ code: 'custom', message: 'the parts are over 512 KiB in all' });
    }
  });
  return defineTool({
    name: cfg.name,
    description: `${descriptionOf(cfg)} ${UNKNOWN} ${DATA_NOTICE}`,
    routeKey: `PUT ${cfg.pattern}`,
    capability: cfg.capability,
    access: 'write',
    spends: 'mutating',
    createsWhen: (value: unknown): boolean =>
      typeof Reflect.get(value as object, 'if_match') !== 'string',
    bodyFields: ['tokens', 'stylesheet', 'templates', 'assets'],
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    input,
    response: themeViewSchema,
    output: z.object({
      data: ANSWER,
      etag: z.string().regex(ETAG_PATTERN).optional(),
      truncated: z.literal(true).optional(),
    }),
    run: async (caller, args) => {
      const params = paramsOf(cfg, args);
      const held = await readHeld(caller, cfg, params);
      const named: unknown = Reflect.get(args, 'if_match');
      if ((typeof named === 'string' ? named : null) !== held.etag) throw staleOf(cfg);
      const request: AdminRequestSpec = {
        method: 'PUT',
        pattern: cfg.pattern,
        params,
        query: {},
        body: mergedBody(held.base, NAMED.parse(args)),
        ...(held.etag === null ? {} : { ifMatch: held.etag }),
        bodyCap: THEME_WRITE_CAP_BYTES,
      };
      let result: AdminResult;
      try {
        result = await caller.call(request);
      } catch (error) {
        if (isTooLarge(error)) throw sentButUnread(cfg);
        throw error;
      }
      if (result.status === 412 || result.status === 428) throw staleOf(cfg);
      if (result.status < 200 || result.status >= 300) throw failed(result, cfg);
      const etag = result.headers.etag;
      return { ...answerOf(result.body), ...(isEtag(etag) ? { etag } : {}) };
    },
  });
}

export const updateThemeDraftTool = themeDraftTool({
  name: 'update_theme_draft',
  capability: 'manage-tenant',
  pattern: '/admin/tenants/:tenant/theme',
  client: false,
  read: 'get_theme',
  subject: "the tenant's theme draft",
  refusal:
    'insufficient_scope: a token holding mcp:write may save a theme draft only through the ' +
    "tenant's MCP endpoint, signed in by a person and never as a service account, and may never " +
    'publish, restore, discard or reset a theme; check the parts.',
});

export const updateClientThemeDraftTool = themeDraftTool({
  name: 'update_client_theme_draft',
  capability: 'manage-clients',
  pattern: '/admin/tenants/:tenant/clients/:id/theme',
  client: true,
  read: 'get_client_theme',
  subject: "one client's theme draft",
  refusal:
    "insufficient_scope: a token holding mcp:write may save a client's theme draft only through " +
    "the tenant's MCP endpoint, signed in by a person and never as a service account, never for " +
    'a built-in client (the admin console or the MCP client), and may never publish, restore, ' +
    'discard or reset a theme; check the client and the parts.',
});

export const themeWriteTools = [updateThemeDraftTool, updateClientThemeDraftTool];
