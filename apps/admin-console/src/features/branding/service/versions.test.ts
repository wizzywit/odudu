import { describe, expect, it } from 'vitest';
import {
  resetBody,
  restoreBody,
  restoreTitle,
  versionRows,
  versionsLead,
} from '#/features/branding/service';
import { VERSION_1, VERSION_2 } from '#/testing/brandingFixtures';

describe('versionRows', () => {
  const rows = versionRows([
    { ...VERSION_2, state: 'published' as const },
    { ...VERSION_1, state: 'archived' as const },
  ]);

  it('mark the published one, which cannot be restored', () => {
    expect(rows[0]).toMatchObject({ name: 'Version 2', tone: 'active', restorable: false });
    expect(rows[1]).toMatchObject({ name: 'Version 1', tone: 'neutral', restorable: true });
  });

  it('say what a restore does and does not touch', () => {
    const row = rows[1];
    if (row === undefined) throw new Error('no row');
    expect(restoreTitle(row)).toBe('Restore Version 1?');
    expect(restoreBody(row)).toMatch(/new version.*draft is not changed/u);
    expect(versionsLead()).toContain('19 before it');
  });
});

describe('reset', () => {
  it('says what it removes, and that the published version can be restored', () => {
    expect(resetBody({ kind: 'tenant' })).toMatch(/Instrument’s own pages.*stays in Versions/u);
    expect(resetBody({ kind: 'client', id: 'c' })).toMatch(/its tenant’s theme/u);
  });
});
