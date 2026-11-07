import { whoamiResponseSchema } from '@odudu/contracts/admin';
import { tenantGet, valueTool } from '#/service/read-tool';

export const whoamiTools = [
  valueTool({
    name: 'whoami',
    description:
      "Says who the calls are made for: the signed-in person's subject id, the tenant they belong to " +
      'and the admin capabilities they hold, which bound every other tool.',
    routeKey: tenantGet('/whoami'),
    capability: null,
    shape: {},
    response: whoamiResponseSchema,
  }),
];
