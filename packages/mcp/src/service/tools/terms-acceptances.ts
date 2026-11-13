import { listTermsAcceptancesResponseSchema } from '@odudu/contracts/admin';
import { idField, pageShape, pageTool, tenantGet } from '#/service/read-tool';

export const termsAcceptanceTools = [
  pageTool({
    name: 'list_subject_terms_acceptances',
    description:
      'Lists the versions of the tenant’s terms one subject accepted and when, newest first, one page at a time.',
    routeKey: tenantGet('/subjects/:id/terms-acceptances'),
    capability: 'view-users',
    shape: { id: idField('subject'), ...pageShape },
    pathParams: ['id'],
    response: listTermsAcceptancesResponseSchema,
  }),
];
