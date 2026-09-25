import { z } from 'zod';

// Deliberately generic: the setting names and their types are
// `@odudu/domain-tenant`'s `SETTINGS` map, the one authority for both.
// Restating them here as a literal-keyed schema would be a second list a
// new setting could be added to without.
const settingValueSchema = z.union([z.boolean(), z.number(), z.string()]);

export const amendSettingsRequestSchema = z.record(z.string(), settingValueSchema);
export type AmendSettingsRequest = z.infer<typeof amendSettingsRequestSchema>;

// A read additionally answers `null` for `display_name`, the one text
// setting with no default — nothing a caller ever writes accepts it back.
export const settingsSchema = z.record(z.string(), settingValueSchema.nullable());
export type Settings = z.infer<typeof settingsSchema>;
