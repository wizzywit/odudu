import { describe, expect, it } from 'vitest';
import { isFiltered } from '#/pages/audit/services/auditFilters';

describe('the filters held', () => {
  it('says whether any filter is held', () => {
    expect(isFiltered({})).toBe(false);
    expect(isFiltered({ action: 'x' })).toBe(true);
  });
});
