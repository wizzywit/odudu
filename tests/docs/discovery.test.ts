import { describe, expect, it } from 'vitest';
import { JWE_ALGS_PERMITTED } from '../../packages/crypto/src/index.js';
import { TENANT_DEFAULT_SCOPE_NAMES } from '../../packages/domain-tenant/src/usecase/provision-defaults.js';
import { standardClaimMappers } from '../../packages/protocol-oidc/src/service/claims.js';
import { USERINFO_ENCRYPTION_ENCS_PERMITTED } from '../../packages/protocol-oidc/src/service/client-metadata.js';
import { resolveDiscoveryDocument } from '../../packages/protocol-oidc/src/usecase/discovery.js';
import { jsonAfter, loadDocument } from './markdown.js';

// Both documents show the discovery response for this tenant on this stack, so
// the document under test fixes the issuer the comparison is made against.
const TENANT = 'demo';
const ISSUER_BASE = 'http://localhost:3000';
const CURL = `curl -sS ${ISSUER_BASE}/tenants/${TENANT}/.well-known/openid-configuration`;

async function serverDiscoveryDocument(): Promise<Record<string, unknown>> {
  const claimMappers = standardClaimMappers();
  const document = await resolveDiscoveryDocument(
    {
      findTenant: () =>
        Promise.resolve({
          id: '01a096f4-0000-0000-0000-000000000000',
          enabled: true,
          verifyEmail: false,
          ssoSessionMaxSeconds: 36_000,
          ssoSessionIdleSeconds: 1_800,
          rememberMeIdleSeconds: 604_800,
          rememberMeMaxSeconds: 2_592_000,
          rememberMeAllowed: false,
          maxSessionsPerBrowser: 25,
          clientRegistrationPolicy: 'disabled',
        }),
      claimNames: () => Promise.resolve(claimMappers.claimNames()),
      // What `seed tenant` puts in a tenant, so the document is checked against
      // the vocabulary a freshly seeded stack actually serves.
      scopesForTenant: () => Promise.resolve(TENANT_DEFAULT_SCOPE_NAMES),
      // `seed bootstrap` generates a tenant's first signing key as RS256
      // (apps/server/src/cli/seed.ts) — the same key a freshly seeded
      // stack's `/userinfo` would sign with.
      algorithmsAvailable: () => Promise.resolve(['RS256']),
      // Fixed by the installed jose, not by anything `seed` writes — the
      // same two call sites `usecase/discovery.ts`'s own reading note names.
      userinfoEncryptionAlgSupported: JWE_ALGS_PERMITTED,
      userinfoEncryptionEncSupported: USERINFO_ENCRYPTION_ENCS_PERMITTED,
      // ODUDU_TRUST_PROXY defaults false, and docs/request-paths.md's own
      // transcript was captured against a stack that never set it — see
      // this same value's effect on token_endpoint_auth_methods_supported.
      trustProxy: false,
    },
    TENANT,
    ISSUER_BASE,
  );
  if (document === null) throw new Error('the discovery usecase returned no document');
  return { ...document };
}

const NUMBER_WORDS: ReadonlyMap<string, number> = new Map([
  ['five', 5],
  ['ten', 10],
  ['eleven', 11],
  ['twelve', 12],
  ['thirteen', 13],
  ['fourteen', 14],
  ['fifteen', 15],
  ['sixteen', 16],
  ['seventeen', 17],
  ['eighteen', 18],
  ['twenty', 20],
  ['twenty-one', 21],
  ['twenty-two', 22],
  ['twenty-three', 23],
  ['twenty-four', 24],
  ['twenty-five', 25],
  ['twenty-six', 26],
  ['twenty-seven', 27],
  ['twenty-eight', 28],
]);

function spelled(word: string, context: string): number {
  const value = NUMBER_WORDS.get(word.toLowerCase());
  if (value === undefined) throw new Error(`${context} spells a number this check cannot read`);
  return value;
}

describe('the discovery document the guide publishes is the one the server produces', () => {
  it('matches docs/request-paths.md member for member', async () => {
    const shown = jsonAfter(loadDocument('docs/request-paths.md'), CURL);

    expect(
      shown,
      'docs/request-paths.md shows a discovery response the server no longer produces',
    ).toEqual(await serverDiscoveryDocument());
  });

  it("matches the five members README.md quotes, and README's count of the rest", async () => {
    const readme = loadDocument('README.md');
    const quoted = jsonAfter(readme, CURL);
    const actual = await serverDiscoveryDocument();

    // README quotes an excerpt deliberately, so only the members it shows are
    // compared — but every one of them must still be exactly what is served.
    for (const [member, value] of Object.entries(quoted)) {
      expect(value, `README.md misquotes ${member} in the discovery document`).toEqual(
        actual[member],
      );
    }

    const prose = readme.lines.find((line) => line.includes('members it returns'));
    if (prose === undefined) {
      throw new Error(
        'README.md no longer says how many discovery members it is quoting out of how many',
      );
    }
    const counts = /^\((?<quoted>[\w-]+) of the (?<total>[\w-]+) members it returns/u.exec(
      prose.trim(),
    );
    if (counts === null) throw new Error(`README.md's count of discovery members reads: ${prose}`);

    expect(
      spelled(counts.groups?.quoted ?? '', 'README.md'),
      "README.md's count of the members it quotes",
    ).toBe(Object.keys(quoted).length);
    expect(
      spelled(counts.groups?.total ?? '', 'README.md'),
      "README.md's count of the members discovery returns",
    ).toBe(Object.keys(actual).length);
  });
});
