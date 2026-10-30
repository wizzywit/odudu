import { z } from 'zod';
import { noBidiControls } from '#/bidi';
import { LOCALE_PATTERN } from '#/profile-claims';
import { createdAtSchema, cursorQuerySchema } from '#/admin/shared';
import { THEME_PAGE_KINDS } from '#/theme-body';

// A tenant holds at most this many overrides, across every locale.
export const MESSAGE_OVERRIDE_LIMIT = 500;
// The longest key an override may name, in characters.
export const MESSAGE_OVERRIDE_KEY_MAX_LENGTH = 128;
// The longest message an override may hold, in characters.
export const MESSAGE_OVERRIDE_MAX_LENGTH = 2000;

export const messageOverrideLocaleSchema = z.string().regex(new RegExp(LOCALE_PATTERN, 'u'));
// The key of a catalogue message; whether it names one is the server's to say.
export const messageOverrideKeySchema = z.string().min(1).max(MESSAGE_OVERRIDE_KEY_MAX_LENGTH);

export const messageOverrideSchema = z.object({
  locale: messageOverrideLocaleSchema,
  key: messageOverrideKeySchema,
  message: z.string(),
  updated_at: createdAtSchema,
  etag: z.string(),
});
export type MessageOverride = z.infer<typeof messageOverrideSchema>;

// One override as a tenant document carries it, at most MESSAGE_OVERRIDE_LIMIT
// of them across every locale.
export const exportedMessageOverrideSchema = z.strictObject({
  locale: messageOverrideLocaleSchema,
  key: messageOverrideKeySchema,
  message: noBidiControls(z.string().min(1).max(MESSAGE_OVERRIDE_MAX_LENGTH)),
});
export type ExportedMessageOverride = z.infer<typeof exportedMessageOverrideSchema>;

export const listMessageOverridesQuerySchema = cursorQuerySchema
  .extend({ locale: messageOverrideLocaleSchema })
  .strict();
export type ListMessageOverridesQuery = z.infer<typeof listMessageOverridesQuerySchema>;

export const listMessageOverridesResponseSchema = z.object({
  items: z.array(messageOverrideSchema),
  next: z.string().optional(),
});
export type ListMessageOverridesResponse = z.infer<typeof listMessageOverridesResponseSchema>;

export const putMessageOverrideRequestSchema = z.strictObject({
  message: noBidiControls(z.string().min(1).max(MESSAGE_OVERRIDE_MAX_LENGTH)),
});
export type PutMessageOverrideRequest = z.infer<typeof putMessageOverrideRequestSchema>;

// The messages the pages of one group of page kinds are filled from, in key
// order, with the English text a key stands for.
export const messageCatalogueEntrySchema = z.object({
  key: messageOverrideKeySchema,
  en: z.string(),
});

export const messageCatalogueSectionSchema = z.object({
  kinds: z.array(z.enum(THEME_PAGE_KINDS)),
  messages: z.array(messageCatalogueEntrySchema),
});
export type MessageCatalogueSection = z.infer<typeof messageCatalogueSectionSchema>;

export const messageCatalogueResponseSchema = z.object({
  sections: z.array(messageCatalogueSectionSchema),
});
export type MessageCatalogueResponse = z.infer<typeof messageCatalogueResponseSchema>;
