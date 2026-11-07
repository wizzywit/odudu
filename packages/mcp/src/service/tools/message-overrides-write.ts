import {
  MESSAGE_OVERRIDE_MAX_LENGTH,
  messageOverrideKeySchema,
  messageOverrideLocaleSchema,
  messageOverrideSchema,
} from '@odudu/contracts/admin';
import { z } from 'zod';
import { contentWriteTool, text } from '#/service/write-tool';

const locale = messageOverrideLocaleSchema.describe(
  'The language tag of the text, such as fr or pt-BR, as list_message_overrides takes it.',
);

const key = messageOverrideKeySchema.describe(
  'The key of a page or mail message, as get_message_catalogue lists it, such as login.title.',
);

const PARAMS = { locale, key };

const STALE =
  'The override changed since it was read, or one exists already for that language and key. ' +
  'Read it with list_message_overrides, then send its etag as if_match.';

export const setMessageOverrideTool = contentWriteTool({
  name: 'set_message_override',
  description:
    "Sets the tenant's own wording for one message in one language: the text that sign-in " +
    'pages and mail show in place of the default, at once and to every person who opens ' +
    'them, so write it as you would for them. A message is a key of get_message_catalogue; a ' +
    'text may use only the arguments the English text of that key reads, an unbalanced brace ' +
    'is refused, and markup is shown as text. Without if_match it creates, and is refused ' +
    '(412) when an override exists for that language and key; with the etag that ' +
    'list_message_overrides gave, it replaces. A tenant holds at most 500 overrides in all. ' +
    'Answers the override and its new etag. Each change is audited with the text before and ' +
    'after, and clear_message_override or this tool with the earlier text undoes it.',
  routeKey: 'PUT /admin/tenants/:tenant/message-overrides/:locale/:key',
  capability: 'manage-tenant',
  what: 'message override',
  mode: 'put',
  createsWithoutEtag: true,
  params: PARAMS,
  fields: {
    message: text(z.string().min(1).max(MESSAGE_OVERRIDE_MAX_LENGTH)).describe(
      `The text, 1 to ${String(MESSAGE_OVERRIDE_MAX_LENGTH)} characters.`,
    ),
  },
  response: messageOverrideSchema,
  refusal:
    'insufficient_scope: a token holding mcp:write may set a message override only through the ' +
    "tenant's MCP endpoint, signed in by a person and never as a service account; check the " +
    'language, the key and the text.',
  stale: STALE,
});

export const clearMessageOverrideTool = contentWriteTool({
  name: 'clear_message_override',
  description:
    'Removes the tenant’s own wording for one message in one language, so the sign-in pages ' +
    'and mail show the default text again. Needs the etag that list_message_overrides gave as if_match; ' +
    'answers that it is done, or a 412 when the override changed since and a 404 when there is ' +
    'none. The audit row keeps the text that was removed, and set_message_override with that ' +
    'text puts it back.',
  routeKey: 'DELETE /admin/tenants/:tenant/message-overrides/:locale/:key',
  capability: 'manage-tenant',
  what: 'message override',
  mode: 'delete',
  params: PARAMS,
  fields: {},
  response: z.void(),
  refusal:
    'insufficient_scope: a token holding mcp:write may clear a message override only through the ' +
    "tenant's MCP endpoint, signed in by a person and never as a service account; check the " +
    'language and the key.',
  stale: STALE,
});

export const messageOverrideWriteTools = [setMessageOverrideTool, clearMessageOverrideTool];
