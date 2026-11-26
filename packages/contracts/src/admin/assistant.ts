import { z } from 'zod';

export const ASSISTANT_MODES = ['ask', 'act'] as const;
export const assistantModeSchema = z.enum(ASSISTANT_MODES);
export type AssistantMode = z.infer<typeof assistantModeSchema>;

// The model each slot runs, as the provider names it. `provider` describes the
// standard slot alone, so a fast or deep slot on another provider is not
// named there. `host` is the host of a self-hosted endpoint and is present
// only when the standard slot is `openai-compatible`.
export const assistantStatusSchema = z.discriminatedUnion('enabled', [
  z.object({ enabled: z.literal(false) }),
  z.object({
    enabled: z.literal(true),
    slots: z.object({ fast: z.string(), standard: z.string(), deep: z.string() }),
    modes: z.array(assistantModeSchema),
    defaultMode: assistantModeSchema,
    modelChoices: z.array(z.string()),
    provider: z.object({ kind: z.string(), host: z.string().optional() }),
  }),
]);
export type AssistantStatus = z.infer<typeof assistantStatusSchema>;

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
