import { z } from 'zod';

import { assistantModeSchema } from '#/admin/assistantStatus';

// The ranges the server holds each setting to. The database repeats them as
// CHECK constraints; the console reads them to say what a field accepts.
const TOKENS_RANGE = { min: 0, max: 1_000_000_000 } as const;
export const ASSISTANT_SETTING_RANGES = {
  assistant_trace_retention_days: { min: 1, max: 365 },
  assistant_monthly_tokens_fast: TOKENS_RANGE,
  assistant_monthly_tokens_standard: TOKENS_RANGE,
  assistant_monthly_tokens_deep: TOKENS_RANGE,
  assistant_max_concurrent: { min: 1, max: 50 },
  assistant_max_steps_per_turn: { min: 1, max: 100 },
} as const;

const tokenLimit = z.number().int().min(TOKENS_RANGE.min).max(TOKENS_RANGE.max);

// What one tenant has chosen for its assistant. A tenant that has chosen
// nothing reads the defaults: on, Ask first, addresses unmasked, traces kept
// 30 days, conversations visible to auditors. The three token limits are a
// month's allowance for each model slot.
export const assistantSettingsSchema = z.object({
  assistant_enabled: z.boolean(),
  assistant_default_mode: assistantModeSchema,
  assistant_mask_emails: z.boolean(),
  assistant_trace_retention_days: z
    .number()
    .int()
    .min(ASSISTANT_SETTING_RANGES.assistant_trace_retention_days.min)
    .max(ASSISTANT_SETTING_RANGES.assistant_trace_retention_days.max),
  assistant_auditor_visible: z.boolean(),
  assistant_monthly_tokens_fast: tokenLimit,
  assistant_monthly_tokens_standard: tokenLimit,
  assistant_monthly_tokens_deep: tokenLimit,
  assistant_max_concurrent: z
    .number()
    .int()
    .min(ASSISTANT_SETTING_RANGES.assistant_max_concurrent.min)
    .max(ASSISTANT_SETTING_RANGES.assistant_max_concurrent.max),
  assistant_max_steps_per_turn: z
    .number()
    .int()
    .min(ASSISTANT_SETTING_RANGES.assistant_max_steps_per_turn.min)
    .max(ASSISTANT_SETTING_RANGES.assistant_max_steps_per_turn.max),
});
export type AssistantSettings = z.infer<typeof assistantSettingsSchema>;

// Open defaults, conservative on purpose: a deployment that wants more raises
// them per tenant. The migration's column defaults repeat these.
export const ASSISTANT_SETTING_DEFAULTS: AssistantSettings = {
  assistant_enabled: true,
  assistant_default_mode: 'ask',
  assistant_mask_emails: false,
  assistant_trace_retention_days: 30,
  assistant_auditor_visible: true,
  assistant_monthly_tokens_fast: 2_000_000,
  assistant_monthly_tokens_standard: 5_000_000,
  assistant_monthly_tokens_deep: 1_000_000,
  assistant_max_concurrent: 5,
  assistant_max_steps_per_turn: 20,
};

// A full replace, so a setting a later release adds is never changed by a
// caller that has not heard of it.
export const putAssistantSettingsRequestSchema = assistantSettingsSchema.strict();
export type PutAssistantSettingsRequest = z.infer<typeof putAssistantSettingsRequestSchema>;
// Where the administrator is when a conversation starts: three short values
// the console derives from its own router, never text a person typed, so
// nothing a browser sends reaches the model as free text.
export const PAGE_ROUTE_MAX = 200;
export const PAGE_OBJECT_ID_MAX = 128;
export const assistantPageContextSchema = z.strictObject({
  route: z
    .string()
    .max(PAGE_ROUTE_MAX)
    .regex(/^\/[A-Za-z0-9._~/-]*$/u),
  objectType: z
    .string()
    .regex(/^[a-z][a-z-]{0,31}$/u)
    .optional(),
  objectId: z
    .string()
    .max(PAGE_OBJECT_ID_MAX)
    .regex(/^[A-Za-z0-9._:-]+$/u)
    .optional(),
});
export type AssistantPageContext = z.infer<typeof assistantPageContextSchema>;

// `profile` and `mode` are optional on the wire, and the server fills in free
// chat in Ask mode: the schema is also the published JSON Schema, which has no
// defaults to apply.
export const createConversationRequestSchema = z.strictObject({
  profile: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,63}$/u)
    .optional(),
  mode: assistantModeSchema.optional(),
  page_context: assistantPageContextSchema,
});
export type CreateConversationRequest = z.infer<typeof createConversationRequestSchema>;

// A person's message: text parts only. Files, tool parts and data parts are
// the engine's to write, so a browser cannot plant one in the history.
export const MESSAGE_TEXT_MAX = 20_000;
export const MESSAGE_PARTS_MAX = 8;
export const assistantTextPartSchema = z.strictObject({
  type: z.literal('text'),
  text: z.string().min(1).max(MESSAGE_TEXT_MAX),
});
export const assistantUserMessageSchema = z.strictObject({
  id: z.string().min(1).max(128),
  role: z.literal('user'),
  parts: z.array(assistantTextPartSchema).min(1).max(MESSAGE_PARTS_MAX),
});
export const sendMessageRequestSchema = z.strictObject({ message: assistantUserMessageSchema });
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

// Eight parts of the text cap, at up to six bytes a character (JSON writes a
// control character as `\u0001`), with room for the JSON around them.
export const SEND_MESSAGE_BODY_LIMIT = MESSAGE_TEXT_MAX * MESSAGE_PARTS_MAX * 6 + 4_096;

// A stored message as the console renders it. `parts` are the AI SDK's UI
// message parts, which the contract does not restate.
export const assistantMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  parts: z.array(z.record(z.string(), z.unknown())),
});

export const assistantConversationSchema = z.object({
  id: z.string(),
  profile: z.string(),
  mode: assistantModeSchema,
  title: z.string().nullable(),
  created_at: z.string(),
  last_active_at: z.string(),
  messages: z.array(assistantMessageSchema),
});
export type AssistantConversation = z.infer<typeof assistantConversationSchema>;

// What a person is shown for one change the assistant proposes, written by the
// server from the stored call and the state it read, never from the model's
// words. `before` is the target as the server read it (null for one that does
// not exist yet) and `after` what the call would set. Each value is shown whole
// as text, at most CARD_FIELD_MAX characters: a call with a longer value is not
// proposed, so a card never shows a prefix of what is approved.
export const CARD_FIELD_MAX = 2_000;
export const assistantApprovalTargetSchema = z.object({
  type: z.string(),
  id: z.string().optional(),
  name: z.string().optional(),
});
const cardFieldsSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);
export const assistantApprovalCardSchema = z.object({
  approval_id: z.string(),
  tool_call_id: z.string(),
  tool: z.string(),
  title: z.string(),
  target: assistantApprovalTargetSchema,
  before: cardFieldsSchema.nullable(),
  after: cardFieldsSchema.nullable(),
  // Server time: the client counts down to it and never extends it.
  expires_at: z.string(),
});
export type AssistantApprovalCard = z.infer<typeof assistantApprovalCardSchema>;

// The owner's own cap on pending approvals (P5) is 20 and nothing here raises it.
export const CONVERSATION_APPROVALS_MAX = 20;
export const assistantApprovalListSchema = z.object({
  items: z.array(assistantApprovalCardSchema).max(CONVERSATION_APPROVALS_MAX),
});
export type AssistantApprovalList = z.infer<typeof assistantApprovalListSchema>;

export const decideApprovalRequestSchema = z.strictObject({ approve: z.boolean() });
export type DecideApprovalRequest = z.infer<typeof decideApprovalRequestSchema>;

export const decideApprovalResponseSchema = z.object({ state: z.enum(['approved', 'denied']) });
export type DecideApprovalResponse = z.infer<typeof decideApprovalResponseSchema>;

// The mode is the person's to switch, from the console, per conversation.
export const setConversationModeRequestSchema = z.strictObject({ mode: assistantModeSchema });
export type SetConversationModeRequest = z.infer<typeof setConversationModeRequestSchema>;
export const setConversationModeResponseSchema = z.object({ mode: assistantModeSchema });

// The vocabulary of a streamed turn's closing and warning parts, the one the
// panel reads: the limits a turn is counted against, and why a turn ended.
export const ASSISTANT_BUDGET_LEVELS = [
  'tenant_month',
  'admin_day',
  'conversation',
  'turn',
] as const;
export const assistantBudgetLevelSchema = z.enum(ASSISTANT_BUDGET_LEVELS);
export type AssistantBudgetLevel = z.infer<typeof assistantBudgetLevelSchema>;

export const ASSISTANT_STOP_REASONS = [
  'done',
  'step_cap',
  'awaiting_approval',
  'budget_turn',
  'budget_conversation',
  'budget_admin',
  'budget_tenant',
  'aborted',
  'error',
] as const;
export const assistantStopReasonSchema = z.enum(ASSISTANT_STOP_REASONS);
export type AssistantStopReason = z.infer<typeof assistantStopReasonSchema>;

// The data parts of a turn's stream: `data-turn_end` closes every turn, and
// `data-budget_warning` is sent once per level that passed the warning share.
export const assistantTurnEndSchema = z.object({ stopReason: assistantStopReasonSchema });
export const assistantBudgetWarningSchema = z.object({
  level: assistantBudgetLevelSchema,
  percent: z.number().min(0).max(100),
  slot: z.enum(['fast', 'standard', 'deep']),
});
export type AssistantBudgetWarning = z.infer<typeof assistantBudgetWarningSchema>;
