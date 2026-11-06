import {
  countResponseSchema,
  countTenantsQuerySchema,
  listTenantsResponseSchema,
} from '@odudu/contracts/admin';
import { pageShape, pageTool, valueTool } from '#/service/read-tool';

// The two reads that span tenants, so they have no `:tenant` in their route:
// they answer for the whole instance to an agent of the system tenant whose
// owner holds `manage-tenants`, and the admin API refuses everyone else. They
// take no tenant argument and open no tenant's content.
export const tenantTools = [
  pageTool({
    name: 'list_tenants',
    description:
      "Lists the instance's tenants (name, display name, whether enabled), one page at a time, " +
      'optionally filtered by name or display name prefix. It opens no tenant: only the list.',
    routeKey: 'GET /admin/tenants',
    capability: 'manage-tenants',
    shape: { ...countTenantsQuerySchema.shape, ...pageShape },
    response: listTenantsResponseSchema,
  }),
  valueTool({
    name: 'count_tenants',
    description:
      'Counts the instance\'s tenants under the same filters as list_tenants; "capped" is true ' +
      'when the real number is larger.',
    routeKey: 'GET /admin/tenants/count',
    capability: 'manage-tenants',
    shape: countTenantsQuerySchema.shape,
    response: countResponseSchema,
  }),
];
