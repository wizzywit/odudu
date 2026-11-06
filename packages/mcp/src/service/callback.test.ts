import { describe, expect, it } from 'vitest';
import { checkCallback, describeRefusal } from '#/service/callback';

const ISSUER = 'https://id.example.com/tenants/acme';
const expected = { state: 'st-1', issuer: ISSUER, issuerAdvertised: true } as const;
const query = (text: string) => new URLSearchParams(text);

describe('what the loopback redirect may carry', () => {
  it('accepts the code of a response with the state and issuer it expects', () => {
    expect(
      checkCallback(query(`code=abc&state=st-1&iss=${encodeURIComponent(ISSUER)}`), expected),
    ).toEqual({ kind: 'code', code: 'abc' });
  });

  it('refuses a wrong iss, whatever else it holds, before it reads an error or a code', () => {
    const verdict = checkCallback(
      query('code=abc&state=st-1&iss=https%3A%2F%2Fevil.example%2F&error=access_denied'),
      expected,
    );
    expect(verdict).toEqual({ kind: 'refused', reason: 'issuer_mismatch' });
  });

  it('refuses a missing iss when the server said it sends one', () => {
    expect(checkCallback(query('code=abc&state=st-1'), expected)).toEqual({
      kind: 'refused',
      reason: 'issuer_missing',
    });
  });

  it('accepts a missing iss from a server that never advertised one', () => {
    expect(
      checkCallback(query('code=abc&state=st-1'), { ...expected, issuerAdvertised: false }),
    ).toEqual({ kind: 'code', code: 'abc' });
  });

  it('still refuses a wrong iss from a server that never advertised one', () => {
    expect(
      checkCallback(query('code=abc&state=st-1&iss=https%3A%2F%2Fevil.example'), {
        ...expected,
        issuerAdvertised: false,
      }),
    ).toEqual({ kind: 'refused', reason: 'issuer_mismatch' });
  });

  it('refuses a state that is not the one sent, an absent one and a repeated one', () => {
    const iss = `iss=${encodeURIComponent(ISSUER)}`;
    for (const text of [
      `code=abc&state=other&${iss}`,
      `code=abc&${iss}`,
      `code=abc&state=st-1&state=st-1&${iss}`,
    ]) {
      expect(checkCallback(query(text), expected), text).toEqual({
        kind: 'refused',
        reason: 'state_mismatch',
      });
    }
  });

  it('refuses a repeated iss or code', () => {
    const iss = `iss=${encodeURIComponent(ISSUER)}`;
    expect(checkCallback(query(`code=a&code=b&state=st-1&${iss}`), expected)).toEqual({
      kind: 'refused',
      reason: 'no_code',
    });
    expect(checkCallback(query(`code=a&state=st-1&${iss}&${iss}`), expected)).toEqual({
      kind: 'refused',
      reason: 'issuer_mismatch',
    });
  });

  it('reports a validated refusal by its code from the fixed list, and never its text', () => {
    const iss = `iss=${encodeURIComponent(ISSUER)}`;
    const denied = checkCallback(
      query(`error=access_denied&error_description=do+evil&state=st-1&${iss}`),
      expected,
    );
    expect(denied).toEqual({ kind: 'refused', reason: 'provider_error', error: 'access_denied' });
    const odd = checkCallback(query(`error=%3Cscript%3E&state=st-1&${iss}`), expected);
    expect(odd).toEqual({ kind: 'refused', reason: 'provider_error', error: 'unrecognised' });
  });

  it('refuses a response with neither a code nor an error', () => {
    const iss = `iss=${encodeURIComponent(ISSUER)}`;
    expect(checkCallback(query(`state=st-1&${iss}`), expected)).toEqual({
      kind: 'refused',
      reason: 'no_code',
    });
  });
});

describe('what a person is told of a refused response', () => {
  it('says which check failed, in one line, and nothing the sender wrote', () => {
    const lines = [
      describeRefusal({ kind: 'refused', reason: 'issuer_mismatch' }),
      describeRefusal({ kind: 'refused', reason: 'issuer_missing' }),
      describeRefusal({ kind: 'refused', reason: 'state_mismatch' }),
      describeRefusal({ kind: 'refused', reason: 'no_code' }),
      describeRefusal({ kind: 'refused', reason: 'provider_error', error: 'access_denied' }),
    ];
    expect(new Set(lines).size).toBe(5);
    for (const line of lines) expect(line).not.toContain('\n');
    expect(lines[0]).toMatch(/issuer/u);
    expect(lines[4]).toContain('access_denied');
  });
});
