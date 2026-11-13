import { describe, expect, it } from 'vitest';
import { acceptanceCursorOf, acceptanceFromCursor } from '#/service/terms-acceptance-cursor';

describe('the position of a page of acceptances', () => {
  it('reads back what it wrote, whatever the version holds', () => {
    const row = { acceptedAt: new Date('2026-11-12T10:00:00.123Z'), version: 'v|1\n"x"' };
    expect(acceptanceFromCursor(acceptanceCursorOf(row))).toEqual(row);
  });

  it('is none where there was no cursor, and refused where it is not ours', () => {
    expect(acceptanceFromCursor(undefined)).toBeUndefined();
    for (const bad of ['', 'x', '[]', '["a"]', '["2026-01-01T00:00:00Z", 2]', '["nope", "v"]']) {
      expect(acceptanceFromCursor(bad), bad).toBeUndefined();
    }
  });
});
