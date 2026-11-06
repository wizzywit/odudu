import { listKeysQuerySchema, listKeysResponseSchema } from '@odudu/contracts/admin';
import { pageShape, pageTool, tenantGet } from '#/service/read-tool';

export const keyTools = [
  pageTool({
    name: 'list_keys',
    description:
      "Lists the tenant's signing keys by id, kid, algorithm, status and expiry, one page at a time. " +
      'Only metadata: never key material.',
    routeKey: tenantGet('/keys'),
    capability: 'manage-keys',
    shape: { ...listKeysQuerySchema.shape, ...pageShape },
    response: listKeysResponseSchema,
  }),
];
