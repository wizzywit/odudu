import { PRODUCT_NAME } from '#/shared/services/product';
import { isTenantName } from '#/shared/services/principal';

export function tenantFrame(tenant: string): { valid: boolean; productName: string } {
  return { valid: isTenantName(tenant), productName: PRODUCT_NAME };
}
