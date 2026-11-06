import { CLIENT_NAME_MAX, clientRecordSchema, DESCRIPTION_MAX } from '@odudu/contracts/admin';
import { descriptionField, localisedField, metadataTool, nameField } from '#/service/write-tool';

export const clientMetadataTool = metadataTool({
  name: 'update_client_metadata',
  description:
    'Changes how a client is described: its name, its description and their per-language ' +
    'texts, and nothing else (not its redirect URIs, grants, scopes, secret or whether it is ' +
    'enabled). Needs the etag of a get_client read as if_match; answers the updated client ' +
    'and its new etag, or a 412 when the client changed since. A name is shown on the consent ' +
    "screen, and a built-in client's name is refused. Each change is audited, and sending the " +
    'earlier values back undoes it.',
  routeKey: 'PATCH /admin/tenants/:tenant/clients/:id',
  capability: 'manage-clients',
  what: 'client',
  fields: {
    name: nameField.optional(),
    description: descriptionField.optional(),
    name_i18n: localisedField(CLIENT_NAME_MAX, 'name').optional(),
    description_i18n: localisedField(DESCRIPTION_MAX, 'description').optional(),
  },
  response: clientRecordSchema,
});
