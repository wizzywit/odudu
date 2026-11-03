import { PRODUCT_NAME } from '#/shared/services/product';
import { isTenantName } from '#/shared/services/principal';

export function useTenantFrame(tenant: string): { valid: boolean; productName: string } {
  return { valid: isTenantName(tenant), productName: PRODUCT_NAME };
}
