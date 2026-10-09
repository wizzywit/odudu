import { describe, expect, it } from 'vitest';
import {
  deleteConsequence,
  moveConfirmation,
  rolesConfirmation,
  subtreeDeletedText,
} from '#/features/groups/service/confirm.ts';

describe('what a group write asks first', () => {
  const certain = { kind: 'certain', lost: ['view-audit'] } as const;
  it('says what a move and a delete come to, with the loss appended', () => {
    expect(moveConfirmation('/eng', certain)).toEqual({
      title: 'Move a group your own access runs through?',
      consequence:
        '/eng would no longer receive what the groups above it hand down. You hold view-audit through the groups above it, so this takes it from you, and this console with it.',
    });
    expect(deleteConsequence('/eng', { kind: 'none' })).toBe(
      'Deleting /eng deletes every group beneath it too, with every membership and role mapping of each, so their members lose the roles these groups gave them. It cannot be undone.',
    );
    expect(deleteConsequence('/eng', certain)).toContain(
      ' You hold view-audit through these groups, so this takes it from you',
    );
    expect(subtreeDeletedText('/eng')).toBe('/eng and every group beneath it were deleted.');
  });

  it('says what taking roles off comes to', () => {
    expect(rolesConfirmation('/eng', certain)).toEqual({
      title: 'Take roles your own access runs through?',
      consequence:
        'Taking them off the group takes them from its members. You hold view-audit through /eng, so this takes it from you, and this console with it. You may not be able to give it back yourself.',
    });
  });
});
