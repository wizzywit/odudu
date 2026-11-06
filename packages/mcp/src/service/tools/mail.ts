import {
  listLogoutDeliveriesQuerySchema,
  listLogoutDeliveriesResponseSchema,
  listMailQuerySchema,
  listMailResponseSchema,
} from '@odudu/contracts/admin';
import { idField, pageShape, pageTool, tenantGet } from '#/service/read-tool';

export const mailTools = [
  pageTool({
    name: 'list_client_logout_deliveries',
    description:
      'Lists the back-channel logout notices queued for one client and whether each was delivered, ' +
      'one page at a time. Never includes the logout token.',
    routeKey: tenantGet('/clients/:id/logout-deliveries'),
    capability: 'manage-clients',
    shape: { id: idField('client'), ...listLogoutDeliveriesQuerySchema.shape, ...pageShape },
    pathParams: ['id'],
    response: listLogoutDeliveriesResponseSchema,
  }),
  pageTool({
    name: 'list_mail',
    description:
      "Lists the tenant's outgoing mail and its delivery status (queued, retrying, sent, failed), one " +
      'page at a time. Never includes a message body, which carries a sign-in link.',
    routeKey: tenantGet('/mail'),
    capability: 'manage-tenant',
    shape: { ...listMailQuerySchema.shape, ...pageShape },
    response: listMailResponseSchema,
  }),
];
