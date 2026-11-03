import { describe, expect, it } from 'vitest';
import { heldLines } from '#/features/subject-capabilities/services/heldLines';

describe('a holder in a list of administrators', () => {
  it('says what is held and whether directly, leaving out what another holding carries', () => {
    expect(
      heldLines([
        { name: 'tenant-admin', direct: true },
        { name: 'manage-users', direct: false },
        { name: 'view-users', direct: false },
      ]),
    ).toEqual([{ holding: 'tenant-admin', label: 'Full (tenant-admin)', how: 'directly' }]);
    expect(
      heldLines([
        { name: 'manage-users', direct: true },
        { name: 'view-users', direct: false },
        { name: 'view-audit', direct: false },
      ]),
    ).toEqual([
      { holding: 'manage-users', label: 'manage-users', how: 'directly' },
      { holding: 'view-audit', label: 'view-audit', how: 'through a group or role' },
    ]);
  });
});
