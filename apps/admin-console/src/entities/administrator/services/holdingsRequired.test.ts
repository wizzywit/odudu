import { describe, expect, it } from 'vitest';
import {
  HOLDINGS_REQUIRED,
  holdingsProblem,
} from '#/entities/administrator/services/holdingsRequired';

describe('the holdings an administrator is given', () => {
  it('must name Full or at least one capability', () => {
    expect(holdingsProblem([])).toBe(HOLDINGS_REQUIRED);
    expect(HOLDINGS_REQUIRED).toBe('Choose Full, or at least one capability.');
    expect(holdingsProblem(['tenant-admin'])).toBeNull();
    expect(holdingsProblem(['view-audit'])).toBeNull();
  });
});
