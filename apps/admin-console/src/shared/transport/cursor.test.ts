import { describe, expect, it } from 'vitest';
import { nextCursor } from '#/shared/transport/cursor.ts';

const CURSOR = 'eyJhZnRlciI6IjAxYTBlNzJkIn0.wxCYgMzM9KahHxwDlrS6SAK5sacypLuVFOf9quYa9S8';

describe('nextCursor', () => {
  it('reads the cursor from the rel="next" target the gateway rewrote', () => {
    const link = `</console/api/admin/tenants/console-paths/subjects?limit=1&cursor=${CURSOR}>; rel="next"`;

    expect(nextCursor(link)).toBe(CURSOR);
  });

  it('is null when there is no Link header', () => {
    expect(nextCursor(null)).toBeNull();
  });

  it('ignores link-values whose relation is not next', () => {
    const link = '</console/api/admin/tenants/t/subjects?cursor=abc>; rel="prev"';

    expect(nextCursor(link)).toBeNull();
  });

  it('finds next among several link-values and relation types', () => {
    const link = [
      '</console/api/admin/tenants/t/subjects?cursor=before>; rel="prev"',
      '</console/api/admin/tenants/t/subjects?cursor=after>; rel="next last"',
    ].join(', ');

    expect(nextCursor(link)).toBe('after');
  });

  it('accepts an unquoted rel and any case', () => {
    expect(nextCursor('</console/api/admin/x?cursor=c1>; REL=Next')).toBe('c1');
  });

  it('is null when the next target carries no cursor', () => {
    expect(nextCursor('</console/api/admin/tenants/t/subjects?limit=1>; rel="next"')).toBeNull();
  });

  it('is null for a header it cannot read', () => {
    expect(nextCursor('rel="next"')).toBeNull();
  });
});
