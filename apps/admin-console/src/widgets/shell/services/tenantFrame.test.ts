import { describe, expect, it } from 'vitest';
import { tenantFrame } from '#/widgets/shell/services/tenantFrame';
import { PRODUCT_NAME } from '#/shared/services/product';

describe('the frame of a tenant address', () => {
  it('is valid for a tenant name and names the product', () => {
    expect(tenantFrame('acme')).toEqual({ valid: true, productName: PRODUCT_NAME });
  });

  it('is not valid for something that is no tenant name', () => {
    expect(tenantFrame('Not A Tenant!').valid).toBe(false);
  });
});
