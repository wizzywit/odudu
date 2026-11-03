import { describe, expect, it } from 'vitest';
import { defaultBlock, reachLines } from '#/pages/groups/services/groupReach';
import { group } from '#/testing/groupAnswers';
import { reach } from '#/testing/roleAnswers';

describe('what a group hands out', () => {
  const record = (extra: Record<string, unknown> = {}) => ({
    ...group('g-mid', '/top/mid'),
    admin_reach: reach('view-audit'),
    subtree_admin_reach: reach('manage-keys', 'view-audit'),
    holds_default_group: false,
    ...extra,
  });
  it('says what the caller may not do, beside what holds it back', () => {
    expect(reachLines(record(), ['manage-users'], ['view-audit'])).toEqual({
      move: 'The groups above /top/mid hand out manage-users, which you do not hold, so you cannot move it: its members would lose that.',
      remove:
        'Its members hold manage-keys through it, which you do not hold, so you cannot delete it.',
    });
    expect(reachLines(record(), [], ['view-audit', 'manage-keys'])).toEqual({
      move: null,
      remove: null,
    });
  });
  it('holds a default back while what it hands out reaches an admin capability', () => {
    expect(defaultBlock(record())).toBe(
      'Every new subject would join it and so receive view-audit, and a group every new subject joins may reach no admin capability. Take those roles off it, or off the groups above it, first.',
    );
    expect(defaultBlock(record({ admin_reach: [] }))).toBeNull();
    // Turning it off is never refused.
    expect(defaultBlock(record({ default_for_new_subjects: true }))).toBeNull();
  });
});
