import { describe, expect, it } from 'vitest';
import { discoveryView } from '#/features/overview/service/discovery.ts';

describe('the discovery document, as the page lays it out', () => {
  const view = discoveryView({
    issuer: 'https://id.example/tenants/acme',
    authorization_endpoint: 'https://id.example/tenants/acme/auth',
    jwks_uri: 'https://id.example/tenants/acme/certs',
    token_endpoint: 'https://id.example/tenants/acme/token',
    grant_types_supported: ['authorization_code', 'refresh_token'],
    claims_parameter_supported: true,
    frontchannel_logout_supported: false,
    scopes_supported: ['openid'],
    service_documentation: 'https://id.example/docs',
  });

  it('keeps the issuer apart, with the address of the document it publishes', () => {
    expect(view.issuer).toBe('https://id.example/tenants/acme');
    expect(view.document).toBe('https://id.example/tenants/acme/.well-known/openid-configuration');
  });

  it('keeps the whole document, laid out, for the raw view', () => {
    expect(view.raw).toContain('\n  "service_documentation": "https://id.example/docs"');
    expect(JSON.parse(view.raw)).toMatchObject({ scopes_supported: ['openid'] });
  });

  it("lists every endpoint and the JWKS address, in the document's order", () => {
    expect(view.endpoints).toEqual([
      { name: 'authorization_endpoint', url: 'https://id.example/tenants/acme/auth' },
      { name: 'jwks_uri', url: 'https://id.example/tenants/acme/certs' },
      { name: 'token_endpoint', url: 'https://id.example/tenants/acme/token' },
    ]);
  });

  it('lists each _supported member, lists and flags apart', () => {
    expect(view.lists).toEqual([
      { name: 'grant_types_supported', values: ['authorization_code', 'refresh_token'] },
      { name: 'scopes_supported', values: ['openid'] },
    ]);
    expect(view.flags).toEqual([
      { name: 'claims_parameter_supported', value: true },
      { name: 'frontchannel_logout_supported', value: false },
    ]);
  });
});
