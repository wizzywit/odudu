import { describe, expect, it } from 'vitest';
import { heldElsewhere, elsewhereText } from '#/pages/subjects/services/heldElsewhere';

describe('what is held elsewhere', () => {
  const held = new Map([
    ['view-audit' as const, { direct: true, through: [] }],
    ['manage-keys' as const, { direct: false, through: ['through group /ops'] }],
  ]);

  it('names what is held only through a group or role, and by which', () => {
    expect(heldElsewhere(held, [])).toEqual([
      { label: 'manage-keys', through: 'through group /ops' },
    ]);
    expect(heldElsewhere(held, ['tenant-admin'])).toEqual([]);
  });

  it('says what is held through a group or role, and that only it takes it away', () => {
    expect(
      elsewhereText('ada', [
        { label: 'A', through: 'through g' },
        { label: 'B', through: 'within A' },
      ]),
    ).toBe('A through g and B within A: only that group or role takes it away, on ada’s ');
  });
});
