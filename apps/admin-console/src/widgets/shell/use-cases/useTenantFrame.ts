import { tenantFrame } from '#/widgets/shell/services/tenantFrame';

export function useTenantFrame(tenant: string): ReturnType<typeof tenantFrame> {
  return tenantFrame(tenant);
}
