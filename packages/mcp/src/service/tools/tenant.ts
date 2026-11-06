import { tenantSchema } from '@odudu/contracts/admin';
import { valueTool } from '#/service/read-tool';

// The signed-in tenant's own record. The tool takes no argument, so there is
// nothing an agent could name to read another tenant's: the door fills in the
// tenant of the token.
export const ownTenantTool = valueTool({
  name: 'get_tenant',
  description:
    'Reads the tenant you act in: its name, display name, whether it is enabled and when it was created. It takes no argument and never opens another tenant.',
  routeKey: 'GET /admin/tenants/:tenant',
  capability: 'manage-tenant',
  shape: {},
  response: tenantSchema,
});
