import {
  clientInstallationSchema,
  clientRecordSchema,
  countClientsQuerySchema,
  countResponseSchema,
  listClientsResponseSchema,
} from '@odudu/contracts/admin';
import { idField, pageShape, pageTool, tenantGet, valueTool } from '#/service/read-tool';

export const clientTools = [
  pageTool({
    name: 'list_clients',
    description:
      "Lists the tenant's OAuth clients, one page at a time, optionally filtered by client_id or " +
      'name prefix, exact client_id, type, enabled or counts_toward_max_clients. Never includes a ' +
      'client secret.',
    routeKey: tenantGet('/clients'),
    capability: 'manage-clients',
    shape: { ...countClientsQuerySchema.shape, ...pageShape },
    response: listClientsResponseSchema,
  }),
  valueTool({
    name: 'count_clients',
    description:
      'Counts the tenant\'s clients under the same filters as list_clients; "capped" is true when ' +
      'the real number is larger.',
    routeKey: tenantGet('/clients/count'),
    capability: 'manage-clients',
    shape: countClientsQuerySchema.shape,
    response: countResponseSchema,
  }),
  valueTool({
    name: 'get_client',
    description:
      'Reads one client: its type, redirect URIs, grants, scopes, lifetimes and display text. ' +
      "Never includes the client's secret. The etag beside data is the if_match of " +
      'update_client_metadata.',
    routeKey: tenantGet('/clients/:id'),
    capability: 'manage-clients',
    shape: { id: idField('client') },
    pathParams: ['id'],
    response: clientRecordSchema,
    etag: true,
  }),
  valueTool({
    name: 'get_client_installation',
    description:
      "Reads what a relying party is configured with for one client: the tenant's issuer and " +
      'discovery address, and the client id, type, authentication method, redirect URIs, grants and ' +
      "default scope. Never includes the client's secret.",
    routeKey: tenantGet('/clients/:id/installation'),
    capability: 'manage-clients',
    shape: { id: idField('client') },
    pathParams: ['id'],
    response: clientInstallationSchema,
  }),
];
