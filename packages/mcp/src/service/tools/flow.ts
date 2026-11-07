import { listExecutionsResponseSchema } from '@odudu/contracts/admin';
import { tenantGet, valueTool } from '#/service/read-tool';

export const flowTools = [
  valueTool({
    name: 'get_flow_executions',
    description:
      "Reads the tenant's sign-in flow: the authenticators it runs in order, each required or " +
      'alternative, and the authenticators that could be added.',
    routeKey: tenantGet('/flow/executions'),
    capability: 'manage-tenant',
    shape: {},
    response: listExecutionsResponseSchema,
  }),
];
