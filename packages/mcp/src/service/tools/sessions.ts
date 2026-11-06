import {
  countResponseSchema,
  countSessionsQuerySchema,
  listSessionsResponseSchema,
  listTenantSessionsResponseSchema,
} from '@odudu/contracts/admin';
import { idField, pageShape, pageTool, tenantGet, valueTool } from '#/service/read-tool';

export const sessionTools = [
  pageTool({
    name: 'list_client_sessions',
    description:
      'Lists the live sign-in sessions that hold a grant for one client, one page at a time.',
    routeKey: tenantGet('/clients/:id/sessions'),
    capability: 'manage-sessions',
    shape: { id: idField('client'), ...pageShape },
    pathParams: ['id'],
    response: listTenantSessionsResponseSchema,
  }),
  pageTool({
    name: 'list_sessions',
    description:
      "Lists the tenant's live sign-in sessions, one page at a time, optionally for one client.",
    routeKey: tenantGet('/sessions'),
    capability: 'manage-sessions',
    shape: { ...countSessionsQuerySchema.shape, ...pageShape },
    response: listTenantSessionsResponseSchema,
  }),
  valueTool({
    name: 'count_sessions',
    description:
      'Counts the tenant\'s live sessions, optionally for one client; "capped" is true when the ' +
      'real number is larger.',
    routeKey: tenantGet('/sessions/count'),
    capability: 'manage-sessions',
    shape: countSessionsQuerySchema.shape,
    response: countResponseSchema,
  }),
  pageTool({
    name: 'list_subject_sessions',
    description: "Lists one subject's live sign-in sessions, one page at a time.",
    routeKey: tenantGet('/subjects/:id/sessions'),
    capability: 'manage-sessions',
    shape: { id: idField('subject'), ...pageShape },
    pathParams: ['id'],
    response: listSessionsResponseSchema,
  }),
];
