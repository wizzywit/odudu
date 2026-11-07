import { clientScopeSchema, DESCRIPTION_MAX } from '@odudu/contracts/admin';
import { displayOrderField } from '#/service/tools/scopes-write';
import { descriptionField, localisedField, metadataTool } from '#/service/write-tool';

export const scopeMetadataTool = metadataTool({
  name: 'update_scope_metadata',
  description:
    'Changes how a scope is described and ordered: its description, the per-language texts of ' +
    'it and its display order (where the consent screen lists it), and nothing else (not its ' +
    'name, the consent text, the claims it releases or who is assigned it), and never a built-in ' +
    'scope such as openid or mcp:write. Needs the etag of ' +
    'a get_scope read as if_match; answers the updated scope and its new etag, or a 412 when ' +
    'the scope changed since. Each change is audited, and sending the earlier values back ' +
    'undoes it.',
  routeKey: 'PATCH /admin/tenants/:tenant/scopes/:id',
  capability: 'manage-tenant',
  what: 'scope',
  fields: {
    description: descriptionField.optional(),
    description_i18n: localisedField(DESCRIPTION_MAX, 'description').optional(),
    display_order: displayOrderField.optional(),
  },
  response: clientScopeSchema,
  refusal:
    'insufficient_scope: a token holding mcp:write may change the description and display ' +
    'order of a scope a person made, and never of a built-in scope (openid, offline_access, ' +
    'mcp:read, mcp:write and the other standard ones); check the target and the fields.',
});
