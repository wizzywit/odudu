import { describe, expect, it, vi } from 'vitest';
import {
  MAX_CLAIMS_PARAMETER_BYTES,
  parseClaimsRequest,
  type ClaimsRequest,
  type ClaimsRequestOutcome,
} from '#/service/claims-request';

function okRequest(outcome: ClaimsRequestOutcome): ClaimsRequest {
  if (outcome.kind !== 'ok') throw new Error('expected the parameter to parse');
  return outcome.request;
}

describe('parseClaimsRequest', () => {
  it('is empty for an absent parameter', () => {
    expect(parseClaimsRequest(undefined)).toEqual({
      kind: 'ok',
      request: { idToken: {}, userinfo: {} },
    });
  });

  it('reads an essential claim in the id_token member', () => {
    const request = okRequest(parseClaimsRequest('{"id_token":{"auth_time":{"essential":true}}}'));
    expect(request.idToken.auth_time).toEqual({ essential: true });
  });

  it('reads a claim requested with a specific value', () => {
    const request = okRequest(parseClaimsRequest('{"id_token":{"sub":{"value":"subject-1"}}}'));
    expect(request.idToken.sub).toEqual({ essential: false, value: 'subject-1' });
  });

  it('reads a claim requested with a set of acceptable values', () => {
    const request = okRequest(
      parseClaimsRequest('{"userinfo":{"acr":{"values":["gold","silver"]}}}'),
    );
    expect(request.userinfo.acr).toEqual({ essential: false, values: ['gold', 'silver'] });
  });

  it('reads a null entry as a voluntary request for the claim', () => {
    const request = okRequest(parseClaimsRequest('{"userinfo":{"email":null}}'));
    expect(request.userinfo.email).toEqual({ essential: false });
  });

  it('refuses a parameter that is not an object', () => {
    expect(parseClaimsRequest('"nope"').kind).toBe('invalid');
  });

  it('refuses a parameter that is not JSON at all', () => {
    expect(parseClaimsRequest('{').kind).toBe('invalid');
  });

  it('refuses a parameter larger than the cap, without parsing it', () => {
    const huge = `{"id_token":{${'"x":null,'.repeat(200000)}"y":null}}`;
    expect(parseClaimsRequest(huge)).toEqual({ kind: 'invalid', reason: 'too_large' });
  });

  it('refuses a deeply nested parameter', () => {
    const deep = '{"id_token":{"sub":' + '{"value":'.repeat(200) + '"x"' + '}'.repeat(200) + '}}';
    expect(parseClaimsRequest(deep).kind).toBe('invalid');
  });

  it('never calls JSON.parse on a parameter over the size cap', () => {
    const huge = `{"id_token":{${'"x":null,'.repeat(200000)}"y":null}}`;
    const parseSpy = vi.spyOn(JSON, 'parse');
    parseClaimsRequest(huge);
    expect(parseSpy).not.toHaveBeenCalled();
    parseSpy.mockRestore();
  });

  it('does call JSON.parse on a parameter within the size cap', () => {
    const parseSpy = vi.spyOn(JSON, 'parse');
    parseClaimsRequest('{"userinfo":{"email":null}}');
    expect(parseSpy).toHaveBeenCalledTimes(1);
    parseSpy.mockRestore();
  });

  it('refuses the deeply nested parameter after JSON.parse succeeds, not because it throws', () => {
    const deep = '{"id_token":{"sub":' + '{"value":'.repeat(200) + '"x"' + '}'.repeat(200) + '}}';
    expect(() => {
      JSON.parse(deep);
    }).not.toThrow();
    expect(parseClaimsRequest(deep)).toEqual({ kind: 'invalid', reason: 'invalid_shape' });
  });

  it('treats an empty entry object the same as a null entry', () => {
    const request = okRequest(parseClaimsRequest('{"userinfo":{"email":{}}}'));
    expect(request.userinfo.email).toEqual({ essential: false });
  });

  it('treats essential: false the same as essential absent', () => {
    const request = okRequest(parseClaimsRequest('{"userinfo":{"email":{"essential":false}}}'));
    expect(request.userinfo.email).toEqual({ essential: false });
  });

  it('accepts a parameter at exactly the cap and refuses one byte past it', () => {
    const base = '{"userinfo":{}}';
    const atCap = ' '.repeat(MAX_CLAIMS_PARAMETER_BYTES - base.length) + base;
    const overCap = ' '.repeat(MAX_CLAIMS_PARAMETER_BYTES - base.length + 1) + base;
    expect(Buffer.byteLength(atCap, 'utf8')).toBe(MAX_CLAIMS_PARAMETER_BYTES);
    expect(parseClaimsRequest(atCap)).toEqual({
      kind: 'ok',
      request: { idToken: {}, userinfo: {} },
    });
    expect(parseClaimsRequest(overCap)).toEqual({ kind: 'invalid', reason: 'too_large' });
  });
});
