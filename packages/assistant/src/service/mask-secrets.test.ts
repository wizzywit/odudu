import type { JsonValue } from '@odudu/mcp';
import { describe, expect, it } from 'vitest';
import { createMasker, MASKED, maskSecrets } from '#/service/mask-secrets';

const SECRET = 'q7Zk3vN0pX2mB9sT4wY8uR1eC6hJ5aLdF0gHiKoPz_-';
const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhZGEifQ.c2lnbmF0dXJlLXBhcnQ';

describe('maskSecrets', () => {
  it('masks a member that holds a secret, at any depth', () => {
    const out = maskSecrets({
      data: { client_id: 'c1', client_secret: SECRET, nested: [{ password_hash: 'x' }] },
    });
    expect(out).toEqual({
      data: { client_id: 'c1', client_secret: MASKED, nested: [{ password_hash: MASKED }] },
    });
  });

  it.each([
    'client_secret',
    'client_secrets',
    'registration_access_token',
    'access_token',
    'refresh_token',
    'id_token',
    'password',
    'password_hash',
    'secret_hash',
    'previous_secret_hash',
    'private_jwk_encrypted',
    'recovery_codes',
    'totp_secret',
    'api_key',
    'Authorization',
    'set-cookie',
  ])('masks the member %s whatever it holds', (key) => {
    expect(maskSecrets({ [key]: { a: ['one', 2] } })).toEqual({ [key]: MASKED });
    expect(maskSecrets({ [key]: 'value-here' })).toEqual({ [key]: MASKED });
  });

  it('masks the private members of a JWK and keeps the public ones', () => {
    const jwk: JsonValue = {
      kty: 'RSA',
      kid: 'k1',
      n: 'abc',
      e: 'AQAB',
      d: 'priv',
      p: 'p',
      qi: 'q',
    };
    expect(maskSecrets(jwk)).toEqual({
      kty: 'RSA',
      kid: 'k1',
      n: 'abc',
      e: 'AQAB',
      d: MASKED,
      p: MASKED,
      qi: MASKED,
    });
  });

  it('masks the private members of a JWK held in JSON text, and only in the key', () => {
    const text =
      '<tool-data>{"d":"day","keys":[{"kid":"k1","kty":"RSA","n":"mod","e":"AQAB","d":"priv-d",' +
      '"p":"priv-p","dq":"priv-dq"},{"kty":"EC","crv":"P-256","x":"px","d":"ec-d"}],"q":"quick"}</tool-data>';
    const out = maskSecrets(text);
    expect(out).toBe(
      '<tool-data>{"d":"day","keys":[{"kid":"k1","kty":"RSA","n":"mod","e":"AQAB","d":"[masked]",' +
        '"p":"[masked]","dq":"[masked]"},{"kty":"EC","crv":"P-256","x":"px","d":"[masked]"}],"q":"quick"}</tool-data>',
    );
  });

  it('leaves a member named d alone when the object is not a key', () => {
    expect(maskSecrets({ d: 'day' })).toEqual({ d: 'day' });
  });

  it('masks a secret held in JSON text, plain and escaped', () => {
    const plain = `<data>{"client_id":"c1","client_secret":"${SECRET}","n":1}</data>`;
    const escaped = `{"text":"{\\"client_secret\\":\\"${SECRET}\\"}"}`;
    expect(maskSecrets(plain)).toBe(
      `<data>{"client_id":"c1","client_secret":"${MASKED}","n":1}</data>`,
    );
    expect(maskSecrets(escaped)).not.toContain(SECRET);
  });

  it('masks a whole array held under a secret member of JSON text', () => {
    const text = `{"client_secrets":[{"client_id":"a","client_secret":"zzzzzzzz1"}],"after":true}`;
    expect(maskSecrets(text)).toBe(`{"client_secrets":"${MASKED}","after":true}`);
  });

  it.each([
    ['a bearer token', 'curl -H "Authorization: Bearer abc.def-ghi_jkl123456"'],
    ['a JWT', `the token ${JWT} was issued`],
    ['a PEM block', '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----'],
    ['an argon2 hash', 'hash $argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$aGFzaGhhc2hoYXNo'],
    ['a bcrypt hash', 'hash $2b$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234'],
    ['a long random token', `it is ${SECRET} now`],
  ])('masks %s in free text', (_name, text) => {
    const out = maskSecrets(text);
    expect(typeof out).toBe('string');
    expect(out).toContain(MASKED);
    expect(out).not.toMatch(
      /Bearer abc|eyJhbGci|MIIEvQ|aGFzaGhhc2g|abcdefghijklmnopqrstuu|q7Zk3v/u,
    );
  });

  it.each([
    ['client_secret=hunter2hunter2 and more', 'client_secret=[masked] and more'],
    ['failed with password: "pa ss" now', 'failed with password: "[masked]" now'],
    ["api-key = 'k-1234567'", "api-key = '[masked]'"],
    ['Set-Cookie: sid=abc123def; Path=/', 'Set-Cookie: [masked]; Path=/'],
  ])('masks the value of a secret named in an error or a header: %s', (text, expected) => {
    expect(maskSecrets(text)).toBe(expected);
  });

  it('keeps ordinary text, identifiers and hex digests', () => {
    const text = 'Client 6f1e2d3c-1111-4222-8333-944455556666 uses sha256 ' + 'ab12'.repeat(16);
    expect(maskSecrets(text)).toBe(text);
  });

  it('does not change a value with nothing to hide', () => {
    const value: JsonValue = { a: [1, true, null, 'x'], b: { c: 'd' } };
    expect(maskSecrets(value)).toEqual(value);
  });

  it('cuts a document nested beyond reason instead of walking it', () => {
    let deep: JsonValue = 'leaf';
    for (let i = 0; i < 100; i += 1) deep = { next: deep };
    expect(JSON.stringify(maskSecrets(deep))).toContain(MASKED);
  });
});

describe('createMasker', () => {
  it('masks a value it saw under a secret member wherever it turns up later', () => {
    const masker = createMasker({ emails: false });
    masker.mask({ client_secret: 'short-secret-1' });
    expect(masker.mask('Your secret is short-secret-1, keep it safe')).toBe(
      `Your secret is ${MASKED}, keep it safe`,
    );
    expect(masker.mask({ input: { note: 'short-secret-1' } })).toEqual({ input: { note: MASKED } });
  });

  it('learns from JSON text too', () => {
    const masker = createMasker({ emails: false });
    masker.mask('{"client_secret":"abc-learned-9"}');
    expect(masker.mask('the model said abc-learned-9')).toBe(`the model said ${MASKED}`);
  });

  it('learns each value of an array held under a secret member of JSON text', () => {
    const masker = createMasker({ emails: false });
    masker.mask('{"recovery_codes":["rc-abc-123456","rc-def-654321"]}');
    expect(masker.mask('codes rc-abc-123456 and rc-def-654321')).toBe(
      `codes ${MASKED} and ${MASKED}`,
    );
  });

  it('masks email addresses when the tenant masks them, and only then', () => {
    const on = createMasker({ emails: true });
    const off = createMasker({ emails: false });
    expect(on.mask({ who: 'ada@example.com' })).toEqual({ who: 'a***@example.com' });
    expect(off.mask({ who: 'ada@example.com' })).toEqual({ who: 'ada@example.com' });
  });
});
