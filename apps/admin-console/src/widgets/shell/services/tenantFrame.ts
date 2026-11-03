import { PRODUCT_NAME } from '#/shared/lib/services/product';
import { isTenantName } from '#/shared/lib/services/principal';

export function tenantFrame(tenant: string): { valid: boolean; productName: string } {
  return { valid: isTenantName(tenant), productName: PRODUCT_NAME };
}
