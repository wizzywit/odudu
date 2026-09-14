import { describe, expect, it } from 'vitest';
import { discoveryDocument } from '../../packages/contracts/src/discovery.js';
import { standardClaimMappers } from '../../packages/protocol-oidc/src/service/claims.js';

const opts = {
  issuer: 'http://localhost:3000/realms/demo',
  scopesSupported: ['openid'],
  claimsSupported: standardClaimMappers().claimNames(),
};

describe('claims_supported is honest about what the registry can produce', () => {
  it('advertises exactly the claims the registry can produce', () => {
    const advertised = new Set(discoveryDocument({ ...opts }).claims_supported);
    const producible = new Set(standardClaimMappers().claimNames());

    expect([...advertised].sort()).toEqual([...producible].sort());
  });

  it('does not advertise entitlements', () => {
    expect(discoveryDocument({ ...opts }).claims_supported).not.toContain('entitlements');
  });
});
