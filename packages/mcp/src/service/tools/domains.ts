import {
  domainSchema,
  listDomainsResponseSchema,
  passkeyImpactQuerySchema,
  passkeyImpactResponseSchema,
} from '@odudu/contracts/admin';
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
  valueTool({
    name: 'get_passkey_impact',
    description:
      'Counts the subjects whose passkeys would be hidden if the tenant moved its canonical ' +
      'address to the one named (a path, or a host of its own domains): "capped" is true when the ' +
      'real number is larger. It changes nothing.',
    routeKey: tenantGet('/domains/passkey-impact'),
    capability: 'view-domains',
    shape: passkeyImpactQuerySchema.shape,
    response: passkeyImpactResponseSchema,
  }),
];
