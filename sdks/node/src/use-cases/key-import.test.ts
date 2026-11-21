import * as jose from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVerifier } from '#/use-cases/create-verifier';
import { fixtureCase, fixtureFetch } from '#/testing/fixtures';

vi.mock('jose', async (importOriginal) => {
  const original = await importOriginal<typeof jose>();
  return { ...original, importJWK: vi.fn(original.importJWK) };
});

afterEach(() => {
  vi.mocked(jose.importJWK).mockClear();
});

describe('the key a verified token is checked against', () => {
  it('is imported once for as many tokens as the key set holds it', async () => {
    const c = fixtureCase('a valid at+jwt');
    const verifier = createVerifier({
      issuers: [c.issuer],
      audience: c.audience,
      clock: () => c.now,
      fetch: fixtureFetch(c.issuer).fetch,
    });
    for (let i = 0; i < 25; i += 1) await verifier(c.token);
    expect(jose.importJWK).toHaveBeenCalledTimes(1);
  });

  it('is imported again when the key set is read again and replaced', async () => {
    const c = fixtureCase('a valid at+jwt');
    let now = c.now;
    const verifier = createVerifier({
      issuers: [c.issuer],
      audience: c.audience,
      clock: () => now,
      fetch: fixtureFetch(c.issuer).fetch,
      jwksTtlMs: 1000,
    });
    await verifier(c.token);
    await verifier(c.token);
    now += 5000;
    await verifier(c.token);
    expect(jose.importJWK).toHaveBeenCalledTimes(2);
  });
});
