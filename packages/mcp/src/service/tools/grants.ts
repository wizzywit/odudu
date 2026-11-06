import { listGrantsResponseSchema } from '@odudu/contracts/admin';
import { idField, pageShape, pageTool, tenantGet } from '#/service/read-tool';

export const grantTools = [
  pageTool({
    name: 'list_subject_grants',
    description:
      'Lists the grants one subject has given to clients (the authorizations their tokens come from), ' +
      'one page at a time. Never includes a token.',
    routeKey: tenantGet('/subjects/:id/grants'),
    capability: 'manage-sessions',
    shape: { id: idField('subject'), ...pageShape },
    pathParams: ['id'],
    response: listGrantsResponseSchema,
  }),
];
