import { clientScopeSchema, DESCRIPTION_MAX, displayOrderSchema } from '@odudu/contracts/admin';
import { z } from 'zod';
import { descriptionField, contentWriteTool, localisedField } from '#/service/write-tool';

const SCOPE_NAME_MAX = 128;

// A scope name is one token of the space-separated `scope` parameter a client
// sends (RFC 6749 section 3.3): visible ASCII without a space, a quote or a
// backslash. The admin API accepts any text, so a name no client could ask for
// is refused here, before a call.
export const scopeNameField = z
  .string()
  .min(1)
  .max(SCOPE_NAME_MAX)
  .regex(/^[\x21-\x7E]+$/u, { message: 'must be visible ASCII without a space' })
  .regex(/^[^"\\]+$/u, { message: 'must not contain a quote or a backslash' })
  .describe(
    `The scope's name, as a client asks for it: up to ${String(SCOPE_NAME_MAX)} visible ASCII ` +
      'characters without a space, a quote or a backslash, such as orders:read.',
  );

export const displayOrderField = displayOrderSchema.describe(
  'Where the consent screen lists the scope among the others, lowest first: an integer from 0.',
);

export const createScopeTool = contentWriteTool({
  name: 'create_scope',
  description:
    'Creates a scope: a name, and optionally a description, its text in other languages and ' +
    'a display order. A new scope is assigned to no client and maps no role, and it has no ' +
    'consent text, so nothing asks for it until a person assigns it; the consent text, the ' +
    'claims it releases, the tokens it appears in and who is assigned it are not in this tool. ' +
    'Needs an idempotency_key of your own, the same on every retry of this create, so that one ' +
    'scope is made. A name already in use is refused with 409, and so is a tenant that holds ' +
    'its limit of scopes. Answers the scope and its etag, which update_scope_metadata takes as ' +
    'if_match.',
  routeKey: 'POST /admin/tenants/:tenant/scopes',
  capability: 'manage-tenant',
  what: 'scope',
  mode: 'create',
  fields: {
    name: scopeNameField,
    description: descriptionField.optional(),
    description_i18n: localisedField(DESCRIPTION_MAX, 'description').optional(),
    display_order: displayOrderField.optional(),
  },
  response: clientScopeSchema,
  refusal:
    'insufficient_scope: a token holding mcp:write may create a scope with a name, a description ' +
    'and a display order only; check the fields.',
});
