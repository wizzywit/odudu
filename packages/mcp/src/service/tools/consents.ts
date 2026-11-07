import { listConsentsResponseSchema } from '@odudu/contracts/admin';
import { idField, pageShape, pageTool, tenantGet } from '#/service/read-tool';

export const consentTools = [
  pageTool({
    name: 'list_subject_consents',
    description: 'Lists what one subject has agreed to share with each client, one page at a time.',
    routeKey: tenantGet('/subjects/:id/consents'),
    capability: 'view-users',
    shape: { id: idField('subject'), ...pageShape },
    pathParams: ['id'],
    response: listConsentsResponseSchema,
  }),
];
