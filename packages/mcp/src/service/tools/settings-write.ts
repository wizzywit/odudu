import { LOCALISED_TEXT_ENTRIES_MAX } from '@odudu/contracts';
import { DISPLAY_NAME_MAX, settingsSchema } from '@odudu/contracts/admin';
import { z } from 'zod';
import { contentWriteTool, languageTagField, line } from '#/service/write-tool';

const DISPLAY_NAME_INPUT_MAX = 1_024;

export const updateTenantTextSettingsTool = contentWriteTool({
  name: 'update_tenant_text_settings',
  description:
    "Changes the tenant's display name and its languages, and nothing else (no other setting: " +
    'not registration, sign-in, password, lockout, session or token rules, and not whether the ' +
    'tenant is on). The display name is shown to people on sign-in pages and in mail, so write ' +
    'it as you would for them. Needs the etag of a get_settings read as if_match, and at least ' +
    'one of display_name, supported_locales (the languages the pages are offered in, replacing ' +
    'the list) and default_locale (one of those languages, or an empty string for none); ' +
    'answers the settings and the new etag, or a 412 when they changed since. An empty ' +
    'display_name clears it, and the tenant name stands in. Each change is audited with the ' +
    'values before and after, and sending the earlier values back undoes it. A language removed ' +
    'from the list keeps its message overrides.',
  routeKey: 'PATCH /admin/tenants/:tenant/settings',
  capability: 'manage-tenant',
  what: 'settings',
  mode: 'amend',
  params: {},
  fields: {
    // The admin API counts the limit after the trim, so the schema takes spaces around
    // a name within its own, larger, cap and judges the trimmed length itself.
    display_name: line(z.string().max(DISPLAY_NAME_INPUT_MAX))
      .refine((name) => name.trim().length <= DISPLAY_NAME_MAX, {
        error: `at most ${String(DISPLAY_NAME_MAX)} characters after the trim`,
      })
      .optional()
      .describe(
        `The name shown to people, at most ${String(DISPLAY_NAME_MAX)} characters after surrounding ` +
          `spaces are trimmed (the input is at most ${String(DISPLAY_NAME_INPUT_MAX)}); empty clears it.`,
      ),
    supported_locales: z
      .array(languageTagField)
      .min(1)
      .max(LOCALISED_TEXT_ENTRIES_MAX)
      .optional()
      .describe(
        `The languages the pages are offered in, 1 to ${String(LOCALISED_TEXT_ENTRIES_MAX)} ` +
          'language tags, replacing the list held now.',
      ),
    default_locale: z
      .union([languageTagField, z.literal('')])
      .optional()
      .describe('The language used when a request names none: one of supported_locales, or empty.'),
  },
  response: settingsSchema,
  refusal:
    'insufficient_scope: a token holding mcp:write may change only the display name and the ' +
    'languages of the tenant settings; check the fields.',
  stale:
    'The settings changed since they were read. Read them again with get_settings, ' +
    'then send the etag that read returned as if_match.',
});

export const settingsWriteTools = [updateTenantTextSettingsTool];
