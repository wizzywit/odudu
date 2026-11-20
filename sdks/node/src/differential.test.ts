import { describe, expect, it } from 'vitest';
import { verifyWithReference } from '../test/reference-verifier.js';
import { VerificationError } from '#/services/verification-error';
import { createVerifier } from '#/use-cases/create-verifier';
import { type FixtureCase, fixtureCases, fixtureFetch } from '#/testing/fixtures';

type Verdict = { ok: true } | { ok: false; status: 401 | 403 };

async function viaSdk(c: FixtureCase): Promise<Verdict> {
  const verify = createVerifier({
    issuers: [c.issuer],
    audience: c.audience,
    ...(c.requiredScope === undefined ? {} : { requiredScope: c.requiredScope }),
    clock: () => c.now,
    fetch: fixtureFetch(c.issuer).fetch,
  });
  try {
    await verify(c.token);
    return { ok: true };
  } catch (error) {
    if (error instanceof VerificationError) return { ok: false, status: error.status };
    throw error;
  }
}

const viaReference = (c: FixtureCase): Promise<Verdict> =>
  verifyWithReference(c.token, {
    issuer: c.issuer,
    audience: c.audience,
    ...(c.requiredScope === undefined ? {} : { requiredScope: c.requiredScope }),
    now: c.now,
  });

describe('the differential: the reference verifier and createVerifier', () => {
  it('has cases to compare', () => {
    expect(fixtureCases().length).toBeGreaterThan(20);
  });

  for (const c of fixtureCases()) {
    it(`agree on ${c.name}`, async () => {
      const sdk = await viaSdk(c);
      const reference = await viaReference(c);
      expect(reference).toEqual(sdk);
      expect(sdk).toEqual(c.expected.ok ? { ok: true } : { ok: false, status: c.expected.status });
    });
  }
});
