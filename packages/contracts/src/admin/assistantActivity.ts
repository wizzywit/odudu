import { z } from 'zod';
import { assistantStopReasonSchema } from '#/admin/assistant';
import { assistantModeSchema } from '#/admin/assistantStatus';
import { createdAtSchema, cursorQuerySchema, idSchema } from '#/admin/shared';

// The activity list narrows to conversations that had one of these: a change
// proposed for approval, a turn stopped by a budget level, a tool that failed.
export const ASSISTANT_ACTIVITY_KINDS = ['approval', 'budget_refusal', 'tool_error'] as const;
export const assistantActivityKindSchema = z.enum(ASSISTANT_ACTIVITY_KINDS);
export type AssistantActivityKind = z.infer<typeof assistantActivityKindSchema>;

// A tool's name as the catalogue spells it: lower-case words joined by underscores.
export const ASSISTANT_TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u;

export const listAssistantActivityQuerySchema = cursorQuerySchema
  .extend({
    person: z.uuid().optional(),
    conversation: z.uuid().optional(),
    tool: z.string().regex(ASSISTANT_TOOL_NAME_PATTERN).optional(),
    outcome: assistantStopReasonSchema.optional(),
    kind: assistantActivityKindSchema.optional(),
  })
  .strict();
export type ListAssistantActivityQuery = z.infer<typeof listAssistantActivityQuerySchema>;

// The most tool names a summary lists, and the most conversations reported
// kept past retention in one tenant.
export const ACTIVITY_TOOLS_MAX = 20;
export const ASSISTANT_REPORTED_MAX = 100;

const tokenCountSchema = z.number().int().nonnegative();
export const assistantTokensBySlotSchema = z.object({
  fast: tokenCountSchema,
  standard: tokenCountSchema,
  deep: tokenCountSchema,
});
export type AssistantTokensBySlot = z.infer<typeof assistantTokensBySlotSchema>;

export const assistantActivityConversationSchema = z.object({
  id: idSchema,
  person: idSchema,
  person_username: z.string().nullable(),
  profile: z.string(),
  mode: assistantModeSchema,
  title: z.string().nullable(),
  started_at: createdAtSchema,
  last_active_at: createdAtSchema,
  turns: z.number().int().nonnegative(),
  steps: z.number().int().nonnegative(),
  tokens: assistantTokensBySlotSchema,
  stop_reason: assistantStopReasonSchema.nullable(),
  tools: z.array(z.string()).max(ACTIVITY_TOOLS_MAX),
  report_old: z.boolean(),
  approvals: z.number().int().nonnegative(),
  reported_at: createdAtSchema.nullable(),
});
export type AssistantActivityConversation = z.infer<typeof assistantActivityConversationSchema>;

export const listAssistantActivityResponseSchema = z.object({
  items: z.array(assistantActivityConversationSchema),
  next: z.string().optional(),
});
export type ListAssistantActivityResponse = z.infer<typeof listAssistantActivityResponseSchema>;

export const ASSISTANT_EVENT_KINDS = [
  'model_call',
  'text',
  'tool_call',
  'tool_result',
  'tool_error',
  'error',
  'slot_chosen',
  'reservation',
  'narrowing',
  'policy',
  'trimming',
  'truncated',
] as const;
export const assistantEventKindSchema = z.enum(ASSISTANT_EVENT_KINDS);

export const assistantReplayAskedSchema = z.object({
  at: createdAtSchema,
  text: z.string(),
});

export const assistantReplayStepSchema = z.object({
  id: idSchema,
  parent_step_id: idSchema.nullable(),
  slot: z.enum(['fast', 'standard', 'deep']),
  model: z.string(),
  provider_request_id: z.string().nullable(),
  input_tokens: tokenCountSchema.nullable(),
  output_tokens: tokenCountSchema.nullable(),
  started_at: createdAtSchema,
  ended_at: createdAtSchema.nullable(),
});

export const assistantReplayEventSchema = z.object({
  seq: z.number().int().nonnegative(),
  step_id: idSchema.nullable(),
  kind: assistantEventKindSchema,
  at: createdAtSchema,
  payload: z.record(z.string(), z.unknown()),
});

export const assistantWhyModelSchema = z.object({
  slot: z.string().nullable(),
  reason: z.string().nullable(),
  model: z.string().nullable(),
});

export const assistantReplayTurnSchema = z.object({
  id: idSchema,
  prompt_hash: z.string(),
  started_at: createdAtSchema,
  ended_at: createdAtSchema.nullable(),
  stop_reason: assistantStopReasonSchema.nullable(),
  why_model: z.array(assistantWhyModelSchema),
  why_stopped: z.string(),
  steps: z.array(assistantReplayStepSchema),
  events: z.array(assistantReplayEventSchema),
});

export const ASSISTANT_APPROVAL_STATES = [
  'pending',
  'approved',
  'denied',
  'expired',
  'consumed',
] as const;
export const assistantReplayApprovalSchema = z.object({
  id: idSchema,
  tool_call_id: z.string(),
  tool: z.string(),
  title: z.string().nullable(),
  target: z.string().nullable(),
  state: z.enum(ASSISTANT_APPROVAL_STATES),
  decided_at: createdAtSchema.nullable(),
});

// What a replay holds at most: the latest turns of a conversation and the
// latest messages the person sent.
export const REPLAY_TURNS_MAX = 25;
export const REPLAY_ASKED_MAX = 100;

// The conversation a replay is of: who, what kind and when. The list carries
// its counts, and a replay holds the turns they count.
export const assistantReplayConversationSchema = z.object({
  id: idSchema,
  person: idSchema,
  person_username: z.string().nullable(),
  profile: z.string(),
  mode: assistantModeSchema,
  started_at: createdAtSchema,
  last_active_at: createdAtSchema,
  reported_at: createdAtSchema.nullable(),
});

export const assistantActivityReplaySchema = z.object({
  conversation: assistantReplayConversationSchema,
  asked: z.array(assistantReplayAskedSchema).max(REPLAY_ASKED_MAX),
  turns: z.array(assistantReplayTurnSchema).max(REPLAY_TURNS_MAX),
  turns_omitted: z.number().int().nonnegative(),
  text_visible: z.boolean(),
  approvals: z.array(assistantReplayApprovalSchema).max(200),
});
export type AssistantActivityReplay = z.infer<typeof assistantActivityReplaySchema>;

export const PROMPTFOO_CASE_VERSION = 1;
export const assistantPromptfooMessageSchema = z.strictObject({
  role: z.literal('user'),
  content: z.string(),
});
export const assistantPromptfooVarsSchema = z.strictObject({
  profile: z.string(),
  mode: assistantModeSchema,
  prompt: z.string(),
  messages: z.array(assistantPromptfooMessageSchema),
});
export const assistantPromptfooToolCallSchema = z.strictObject({
  tool: z.string(),
  input: z.unknown(),
});
export const assistantPromptfooObservedSchema = z.strictObject({
  stop_reasons: z.array(assistantStopReasonSchema.nullable()),
  tool_calls: z.array(assistantPromptfooToolCallSchema),
  answers: z.array(z.string()),
});
export const assistantPromptfooMetadataSchema = z.strictObject({
  source: z.literal('odudu-assistant-trace'),
  version: z.literal(PROMPTFOO_CASE_VERSION),
  conversation: idSchema,
  turns: z.number().int().nonnegative(),
  contains: z.array(z.string()),
  excludes: z.array(z.string()),
  observed: assistantPromptfooObservedSchema,
});
export const assistantPromptfooCaseSchema = z.strictObject({
  description: z.string(),
  vars: assistantPromptfooVarsSchema,
  assert: z.array(z.record(z.string(), z.unknown())),
  metadata: assistantPromptfooMetadataSchema,
});
export type AssistantPromptfooCase = z.infer<typeof assistantPromptfooCaseSchema>;

// A tenant is warned from this many reported conversations on, and a report older
// than this many days is flagged in the list. Nothing removes either.
export const REPORTED_WARN_AT = 80;
export const REPORTED_OLD_DAYS = 180;

export const reportConversationResponseSchema = z.object({
  reported_at: createdAtSchema,
  reported_count: z.number().int().nonnegative(),
  near_limit: z.boolean(),
});
export type ReportConversationResponse = z.infer<typeof reportConversationResponseSchema>;
