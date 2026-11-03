import { describe, expect, it } from 'vitest';
import { discoveryView } from '#/features/overview/services/discovery';
import { TRANSCRIPT_DISCOVERY } from '#/testing/overviewFixtures';

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
      { name: 'claims_parameter_supported', value: true, text: 'yes' },
      { name: 'frontchannel_logout_supported', value: false, text: 'no' },
    ]);
  });
});

describe('the discovery document a running server published', () => {
  const view = discoveryView(TRANSCRIPT_DISCOVERY);

  it('keeps the issuer and the address of the document it publishes', () => {
    expect(view.issuer).toBe('http://localhost:3082/tenants/system');
    expect(view.document).toBe(
      'http://localhost:3082/tenants/system/.well-known/openid-configuration',
    );
  });

  it('lists the seven endpoints and the JWKS address in the document order', () => {
    expect(view.endpoints.map((endpoint) => endpoint.name)).toEqual([
      'authorization_endpoint',
      'token_endpoint',
      'introspection_endpoint',
      'revocation_endpoint',
      'userinfo_endpoint',
      'jwks_uri',
      'end_session_endpoint',
    ]);
  });

  it('keeps the lists and the flags apart, and leaves out what is neither', () => {
    expect(view.flags.map((flag) => flag.name)).toEqual([
      'authorization_response_iss_parameter_supported',
      'claims_parameter_supported',
      'backchannel_logout_supported',
      'backchannel_logout_session_supported',
      'frontchannel_logout_supported',
      'frontchannel_logout_session_supported',
    ]);
    expect(view.lists.map((list) => list.name)).not.toContain('claims_parameter_supported');
    expect(view.lists.find((list) => list.name === 'scopes_supported')?.values).toContain('openid');
  });
});
