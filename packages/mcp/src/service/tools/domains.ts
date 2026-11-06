import { domainSchema, listDomainsResponseSchema } from '@odudu/contracts/admin';
import { idField, pageShape, pageTool, tenantGet, valueTool } from '#/service/read-tool';

export const domainTools = [
  pageTool({
    name: 'list_domains',
    description:
      "Lists the tenant's custom domains and where each stands in verification, one page at a time.",
    routeKey: tenantGet('/domains'),
    capability: 'view-domains',
    shape: pageShape,
    response: listDomainsResponseSchema,
  }),
  valueTool({
    name: 'get_domain',
    description:
      'Reads one custom domain: its host, verification state and the DNS record that proves it.',
    routeKey: tenantGet('/domains/:id'),
    capability: 'view-domains',
    shape: { id: idField('domain') },
    pathParams: ['id'],
    response: domainSchema,
  }),
];
