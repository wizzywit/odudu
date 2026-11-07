import { describe, expect, it } from 'vitest';
import {
  decideConsentGate,
  type ConsentContext,
  type ConsentGateDeps,
} from '#/usecase/login-submission';

const OPENID_ID = 'scope-openid';

// Two clients under the same name and an approval recorded for the first
// only, keyed the way the grants table is: by tenant, subject and client.
function gate(approved: ReadonlySet<string>): ConsentGateDeps {
  const context = (): ConsentContext => ({
    clientName: 'Same Name',
    clientPages: { clientUri: null, policyUri: null, tosUri: null, source: null },
    scopeLabels: {},
    i18n: { clientName: {}, scopeLabels: {} },
    consentRequired: false,
    approvalRequired: true,
    defaultScopes: ['openid'],
    optionalScopes: [],
    scopeIdByName: new Map([['openid', OPENID_ID]]),
  });
  return {
    consentContext: () => Promise.resolve(context()),
    grantedScopeIds: (_tenant, _subject, clientId) =>
      Promise.resolve(approved.has(clientId) ? new Set([OPENID_ID]) : new Set<string>()),
  };
}

describe('decideConsentGate for a client the person must approve', () => {
  it('asks until that exact client id has a grant, then stops asking', async () => {
    const before = await decideConsentGate(
      gate(new Set()),
      't',
      'client-a',
      'subject',
      'openid',
      undefined,
    );
    expect(before.kind).toBe('ask');
    const after = await decideConsentGate(
      gate(new Set(['client-a'])),
      't',
      'client-a',
      'subject',
      'openid',
      undefined,
    );
    expect(after).toEqual({ kind: 'not_required' });
  });

  it("does not let another client's approval stand for it, whatever its name", async () => {
    const deps = gate(new Set(['client-a']));
    const other = await decideConsentGate(deps, 't', 'client-b', 'subject', 'openid', undefined);
    expect(other.kind).toBe('ask');
  });

  it('asks again for a request that names nothing the grant can cover', async () => {
    const deps = gate(new Set(['client-a']));
    const bare = await decideConsentGate(deps, 't', 'client-b', 'subject', '', undefined);
    expect(bare.kind).toBe('ask');
  });
});
