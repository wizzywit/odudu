import { describe, expect, it } from 'vitest';
import { readMetadata } from '#/service/metadata';
import { stdioTarget } from '#/service/stdio-target';

const target = stdioTarget('https://id.example.com', 'acme');
const ISSUER = target.issuer;
const document = (over: Record<string, unknown> = {}) => ({
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`,
  token_endpoint: `${ISSUER}/protocol/openid-connect/token`,
  authorization_response_iss_parameter_supported: true,
  code_challenge_methods_supported: ['S256'],
  ...over,
});

describe('the authorization server metadata of a tenant', () => {
  it('is read once its issuer is the tenant the command was given', () => {
    expect(readMetadata(document(), target)).toEqual({
      issuer: ISSUER,
      authorizationEndpoint: `${ISSUER}/protocol/openid-connect/auth`,
      tokenEndpoint: `${ISSUER}/protocol/openid-connect/token`,
      issuerAdvertised: true,
    });
  });

  it('is refused for an issuer that is not base URL plus tenant', () => {
    expect(() =>
      readMetadata(document({ issuer: 'https://id.example.com/tenants/other' }), target),
    ).toThrow(/issuer/u);
    expect(() => readMetadata(document({ issuer: `${ISSUER}/` }), target)).toThrow(/issuer/u);
  });

  it('is refused for an endpoint on another origin', () => {
    expect(() =>
      readMetadata(document({ token_endpoint: 'https://evil.example/token' }), target),
    ).toThrow(/token_endpoint/u);
    expect(() =>
      readMetadata(document({ authorization_endpoint: 'https://evil.example/auth' }), target),
    ).toThrow(/authorization_endpoint/u);
  });

  it('is refused when it does not offer S256', () => {
    expect(() =>
      readMetadata(document({ code_challenge_methods_supported: ['plain'] }), target),
    ).toThrow(/S256/u);
    expect(() =>
      readMetadata(document({ code_challenge_methods_supported: undefined }), target),
    ).toThrow(/S256/u);
  });

  it('records that the server does not advertise iss when it does not', () => {
    expect(
      readMetadata(document({ authorization_response_iss_parameter_supported: undefined }), target)
        .issuerAdvertised,
    ).toBe(false);
  });

  it.each([null, 'x', [], 3])('refuses a document that is %j', (body) => {
    expect(() => readMetadata(body, target)).toThrow();
  });

  describe('at a tenant own domain', () => {
    const domain = stdioTarget('https://id.example.com', 'acme', 'https://login.acme.org');
    const form = domain.forms[0];
    const docFor = (issuer: string, over: Record<string, unknown> = {}) => ({
      issuer,
      authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
      token_endpoint: `${issuer}/protocol/openid-connect/token`,
      code_challenge_methods_supported: ['S256'],
      ...over,
    });

    it('accepts an issuer that is exactly the origin it was given', () => {
      if (form === undefined) throw new Error('no domain form');
      expect(readMetadata(docFor('https://login.acme.org'), domain, form).issuer).toBe(
        'https://login.acme.org',
      );
    });

    it('still refuses another host, a path under the domain and endpoints elsewhere', () => {
      if (form === undefined) throw new Error('no domain form');
      for (const issuer of ['https://other.example', 'https://login.acme.org/tenants/acme']) {
        expect(() => readMetadata(docFor(issuer), domain, form), issuer).toThrow(/issuer/u);
      }
      expect(() =>
        readMetadata(
          docFor('https://login.acme.org', { token_endpoint: 'https://evil.example/token' }),
          domain,
          form,
        ),
      ).toThrow(/token_endpoint/u);
    });
  });
});
