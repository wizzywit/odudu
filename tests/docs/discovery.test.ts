import { describe, expect, it } from 'vitest';
import { standardClaimMappers } from '../../packages/protocol-oidc/src/service/claims.js';
import { resolveDiscoveryDocument } from '../../packages/protocol-oidc/src/usecase/discovery.js';
import { jsonAfter, loadDocument } from './markdown.js';

// Both documents show the discovery response for this realm on this stack, so
// the document under test fixes the issuer the comparison is made against.
const REALM = 'demo';
const ISSUER_BASE = 'http://localhost:3000';
const CURL = `curl -sS ${ISSUER_BASE}/realms/${REALM}/.well-known/openid-configuration`;

async function serverDiscoveryDocument(): Promise<Record<string, unknown>> {
  const claimMappers = standardClaimMappers();
  const document = await resolveDiscoveryDocument(
    {
      findRealm: () =>
        Promise.resolve({ id: '01a096f4-0000-0000-0000-000000000000', enabled: true }),
      claimNames: () => claimMappers.claimNames(),
    },
    REALM,
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
    const counts = /^\((?<quoted>\w+) of the (?<total>\w+) members it returns/u.exec(prose.trim());
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
