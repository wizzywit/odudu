import { describe, expect, it } from 'vitest';
import {
  alreadyAssigned,
  assignButtonText,
  moreScopes,
  scopeCount,
  scopeRefusal,
  SCOPES_PAGE,
  shownScopes,
} from '#/pages/clients/services/clientScopes';

const SCOPES = [
  { id: 's2', name: 'profile', assignment: 'default' as const },
  { id: 's1', name: 'billing', assignment: 'optional' as const },
  { id: 's3', name: 'email', assignment: 'default' as const },
];

describe('what a client is shown of its scopes', () => {
  it('lists them by name and shows only as many as asked', () => {
    expect(shownScopes(SCOPES, 2).map((each) => each.name)).toEqual(['billing', 'email']);
    expect(moreScopes(SCOPES, 2)).toBe(1);
    expect(moreScopes(SCOPES, SCOPES_PAGE)).toBe(0);
  });

  it('counts them in words', () => {
    expect(scopeCount(1)).toBe('1 scope assigned.');
    expect(scopeCount(0)).toBe('0 scopes assigned.');
    expect(scopeCount(1000)).toBe('1000 scopes assigned.');
  });
});

describe('assigning', () => {
  it('keeps a scope from being chosen twice, and says how it is held', () => {
    expect(alreadyAssigned({ id: 's1' }, SCOPES)).toBe('already assigned as optional');
    expect(alreadyAssigned({ id: 'other' }, SCOPES)).toBeNull();
  });

  it("words a refusal of the capability, and leaves the server's own reason for anything else", () => {
    expect(
      scopeRefusal({ type: 'about:blank', title: 'Forbidden', status: 403, detail: undefined }),
    ).toBe(
      'Refused: it needs the manage-tenant capability, or reaches a capability you do not hold.',
    );
    expect(
      scopeRefusal({ type: 'about:blank', title: 'Conflict', status: 409, detail: 'no' }),
    ).toBeNull();
  });
});

describe('the assign button', () => {
  it('names the scope chosen, once there is one', () => {
    expect(assignButtonText(null)).toBe('Assign scope');
    expect(assignButtonText('billing')).toBe('Assign scope billing');
  });
});
