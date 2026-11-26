import { z } from 'zod';
import { assistantConversationSchema, assistantMessageSchema } from '#/admin/assistant';
import { assistantModeSchema } from '#/admin/assistantStatus';
import { booleanFlagSchema, createdAtSchema, cursorQuerySchema, idSchema } from '#/admin/shared';

// A person's own conversations: listing them, reopening the latest, hiding one,
// exporting one and deleting one. Every route here answers for the caller's own
// conversations and for nobody else's.

// `archived=true` lists the ones the person hid; the default lists the rest.
export const listAssistantConversationsQuerySchema = cursorQuerySchema
  .extend({ archived: booleanFlagSchema.optional() })
  .strict();
export type ListAssistantConversationsQuery = z.infer<typeof listAssistantConversationsQuerySchema>;

export const assistantConversationSummarySchema = z.object({
  id: idSchema,
  title: z.string().nullable(),
  profile: z.string(),
  mode: assistantModeSchema,
  created_at: createdAtSchema,
  last_active_at: createdAtSchema,
  archived: z.boolean(),
  archived_at: createdAtSchema.nullable(),
  reported: z.boolean(),
  target_tenant_id: idSchema.nullable(),
});
export type AssistantConversationSummary = z.infer<typeof assistantConversationSummarySchema>;

export const listAssistantConversationsResponseSchema = z.object({
  items: z.array(assistantConversationSummarySchema),
  next: z.string().optional(),
});
export type ListAssistantConversationsResponse = z.infer<
  typeof listAssistantConversationsResponseSchema
>;

// The conversation as it is reopened: its messages, whether it is hidden, and
// whether the sign-in it acts under is still the one the caller holds.
export const assistantResumedConversationSchema = assistantConversationSchema.extend({
  archived: z.boolean(),
  continuable: z.boolean(),
});
export type AssistantResumedConversation = z.infer<typeof assistantResumedConversationSchema>;

export const lastAssistantConversationResponseSchema = z.object({
  conversation: assistantResumedConversationSchema.nullable(),
});
export type LastAssistantConversationResponse = z.infer<
  typeof lastAssistantConversationResponseSchema
>;

export const setConversationArchivedRequestSchema = z.strictObject({ archived: z.boolean() });
export type SetConversationArchivedRequest = z.infer<typeof setConversationArchivedRequestSchema>;

export const setConversationArchivedResponseSchema = z.object({
  archived: z.boolean(),
  archived_at: createdAtSchema.nullable(),
});
export type SetConversationArchivedResponse = z.infer<typeof setConversationArchivedResponseSchema>;

// What an export holds of a message: who said it, when, the text with secrets
// hidden and, for an answer, the names of the tools it called. Never a tool's
// input or result.
export const EXPORT_MESSAGES_MAX = 500;
export const assistantExportMessageSchema = z.object({
  role: assistantMessageSchema.shape.role,
  at: createdAtSchema,
  text: z.string(),
  tools: z.array(z.string()),
});

export const assistantExportedConversationSchema = z.object({
  id: idSchema,
  title: z.string().nullable(),
  profile: z.string(),
  mode: assistantModeSchema,
  created_at: createdAtSchema,
  last_active_at: createdAtSchema,
});

export const assistantConversationExportSchema = z.object({
  exported_at: createdAtSchema,
  conversation: assistantExportedConversationSchema,
  messages: z.array(assistantExportMessageSchema).max(EXPORT_MESSAGES_MAX),
  truncated: z.boolean(),
});
export type AssistantConversationExport = z.infer<typeof assistantConversationExportSchema>;
