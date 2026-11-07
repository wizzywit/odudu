import { settingsSchema } from '@odudu/contracts/admin';
import { tenantGet, valueTool } from '#/service/read-tool';

export const settingsTools = [
  valueTool({
    name: 'get_settings',
    description:
      "Reads the tenant's settings: token and session lifetimes, sign-in and registration policy, " +
      'password and lockout rules, languages. Secrets are never part of them. The etag beside ' +
      'data is the if_match of update_tenant_text_settings.',
    routeKey: tenantGet('/settings'),
    capability: 'manage-tenant',
    shape: {},
    response: settingsSchema,
    etag: true,
  }),
];
