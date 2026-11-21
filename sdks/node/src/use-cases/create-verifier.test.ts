import { describe, expect, it } from 'vitest';
import { createVerifier } from '#/use-cases/create-verifier';
import { VerificationError } from '#/services/verification-error';
import { type FixtureCase, fixtureCase, fixtureCases, fixtureFetch } from '#/testing/fixtures';

function verifierFor(c: FixtureCase, requiredScope?: string) {
  const { fetch } = fixtureFetch(c.issuer);
  const scope = requiredScope ?? c.requiredScope;
  return createVerifier({
    issuers: [c.issuer],
    audience: c.audience,
    ...(scope === undefined ? {} : { requiredScope: scope }),
    clock: () => c.now,
    fetch,
  });
}

async function outcome(c: FixtureCase): Promise<unknown> {
  try {
    const verified = await verifierFor(c)(c.token);
    return { ok: true, scope: verified.scope };
  } catch (error) {
    if (!(error instanceof VerificationError)) throw error;
    return { ok: false, status: error.status, code: error.code, reason: error.reason };
  }
}

describe('the shared fixture cases', () => {
  for (const c of fixtureCases()) {
    it(c.name, async () => {
      expect(await outcome(c)).toEqual(c.expected);
    });
  }
});

describe('verifying an access token', () => {
  it('accepts a valid at+jwt', async () => {
    const c = fixtureCase('a valid at+jwt');
    const verified = await verifierFor(c)(c.token);
    expect(verified).toMatchObject({
      sub: 'subject-1',
      clientId: 'client-1',
      scope: ['openid', 'reports:read'],
      audience: [c.audience],
    });
    expect(verified.claims.iss).toBe(c.issuer);
  });

  it('refuses an ID token', async () => {
    expect(await outcome(fixtureCase('an ID token'))).toMatchObject({ ok: false, status: 401 });
  });

  it('refuses typ other than at+jwt', async () => {
    expect(await outcome(fixtureCase('typ other than at+jwt'))).toMatchObject({
      reason: 'wrong_type',
    });
  });

  it('refuses a wrong issuer', async () => {
    expect(await outcome(fixtureCase('a wrong issuer'))).toMatchObject({ reason: 'wrong_issuer' });
  });

  it('refuses a wrong audience', async () => {
    expect(await outcome(fixtureCase('a wrong audience'))).toMatchObject({
      reason: 'wrong_audience',
    });
  });

  it('refuses an expired token', async () => {
    expect(await outcome(fixtureCase('an expired token'))).toMatchObject({ reason: 'expired' });
  });

  it('refuses a not-yet-valid token', async () => {
    expect(await outcome(fixtureCase('a token not yet valid'))).toMatchObject({
      reason: 'not_yet_valid',
    });
  });

  it('refuses a token naming only the me audience at an API', async () => {
    expect(await outcome(fixtureCase('only the me audience'))).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it('refuses a token naming the me audience beside the API audience, by name', async () => {
    expect(await outcome(fixtureCase('the me audience beside the API audience'))).toMatchObject({
      reason: 'me_audience',
    });
  });

  it('refuses the me audience of any configured issuer', async () => {
    const c = fixtureCase('a valid at+jwt');
    const { fetch } = fixtureFetch(c.issuer);
    const verify = createVerifier({
      issuers: [c.issuer, 'https://id.example.test/tenants/other'],
      audience: c.audience,
      clock: () => c.now,
      fetch,
    });
    const me = fixtureCase('the me audience beside the API audience');
    await expect(verify(me.token)).rejects.toMatchObject({ reason: 'me_audience' });
  });

  it('403 insufficient_scope when the scope is missing', async () => {
    const c = fixtureCase('a missing scope');
    const error = await verifierFor(c)(c.token).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VerificationError);
    expect(error).toMatchObject({ status: 403, code: 'insufficient_scope' });
    expect((error as VerificationError).challenge).toBe(
      'Bearer error="insufficient_scope", error_description="The access token lacks the required scope", scope="reports:write"',
    );
  });

  it('answers 401 with an RFC 6750 challenge that says nothing sensitive', async () => {
    const c = fixtureCase('a wrong issuer');
    const error = (await verifierFor(c)(c.token).catch((e: unknown) => e)) as VerificationError;
    expect(error.challenge).toBe(
      'Bearer error="invalid_token", error_description="The access token is invalid"',
    );
    const expired = fixtureCase('an expired token');
    const late = (await verifierFor(expired)(expired.token).catch(
      (e: unknown) => e,
    )) as VerificationError;
    expect(late.challenge).toBe(
      'Bearer error="invalid_token", error_description="The access token expired"',
    );
  });

  it('honours exp and nbf with a tolerance of five seconds', async () => {
    const valid = fixtureCase('a valid at+jwt');
    const expAt = valid.now + 300_000;
    const verify = (now: number) => {
      const { fetch } = fixtureFetch(valid.issuer);
      return createVerifier({
        issuers: [valid.issuer],
        audience: valid.audience,
        clock: () => now,
        fetch,
      })(valid.token);
    };
    await expect(verify(expAt + 4_000)).resolves.toBeDefined();
    await expect(verify(expAt + 6_000)).rejects.toMatchObject({ reason: 'expired' });
    await expect(verify(valid.now - 60_000 - 4_000)).resolves.toBeDefined();
    await expect(verify(valid.now - 60_000 - 6_000)).rejects.toMatchObject({
      reason: 'not_yet_valid',
    });
  });

  it('refuses a configuration that is unsafe or ambiguous', () => {
    const audience = 'a';
    expect(() => createVerifier({ issuers: ['https://i.test/tenants/a/'], audience })).toThrow(
      /trailing slash/u,
    );
    expect(() => createVerifier({ issuers: ['http://i.test'], audience })).toThrow(/https/u);
    expect(() =>
      createVerifier({ issuers: ['http://127.0.0.1:1'], audience, allowInsecureIssuers: true }),
    ).not.toThrow();
    const many = Array.from({ length: 257 }, (_, i) => `https://i${String(i)}.test`);
    expect(() => createVerifier({ issuers: many, audience })).toThrow(TypeError);
  });

  it('refuses a configuration with no issuer or no audience', () => {
    expect(() => createVerifier({ issuers: [], audience: 'a' })).toThrow(TypeError);
    expect(() => createVerifier({ issuers: ['https://i.test'], audience: '' })).toThrow(TypeError);
  });

  it('never fetches keys for an issuer that is not configured', async () => {
    const c = fixtureCase('a wrong issuer');
    const { fetch, requests } = fixtureFetch(c.issuer);
    const verify = createVerifier({
      issuers: [c.issuer],
      audience: c.audience,
      clock: () => c.now,
      fetch,
    });
    await expect(verify(c.token)).rejects.toMatchObject({ reason: 'wrong_issuer' });
    expect(requests).toEqual([]);
  });
});
