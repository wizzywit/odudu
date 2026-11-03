import { describe, expect, it } from 'vitest';
import {
  administratorProblem,
  choosesHoldings,
  holdsText,
  systemHoldsText,
} from '#/features/tenants/services/administratorHoldings';

describe('the guided administrator step', () => {
  it('offers the choice of holdings only to a further administrator not yet given them', () => {
    expect(choosesHoldings({ origin: 'existing', granted: false })).toBe(true);
    expect(choosesHoldings({ origin: 'existing', granted: true })).toBe(false);
    expect(choosesHoldings({ origin: 'created', granted: false })).toBe(false);
    expect(choosesHoldings({ origin: 'imported', granted: false })).toBe(false);
  });

  it('asks for a username before holdings, and each under its own field', () => {
    expect(administratorProblem({ username: '', holdings: [] })).toEqual({
      username: 'Enter a username for the administrator.',
    });
    expect(administratorProblem({ username: ' ', holdings: ['tenant-admin'] })).toEqual({
      username: 'Enter a username for the administrator.',
    });
    expect(administratorProblem({ username: 'ada', holdings: [] })).toEqual({
      holdings: 'Choose Full, or at least one capability.',
    });
    expect(administratorProblem({ username: 'ada', holdings: ['view-audit'] })).toBeNull();
  });

  it('says what an administrator was given, tenant-admin when Full or nothing was named', () => {
    expect(holdsText(undefined)).toBe('tenant-admin');
    expect(holdsText([])).toBe('tenant-admin');
    expect(holdsText(['view-audit', 'tenant-admin'])).toBe('tenant-admin');
    expect(holdsText(['view-audit'])).toBe('view-audit');
    expect(holdsText(['view-audit', 'view-users'])).toBe('view-audit and view-users');
    expect(holdsText(['view-audit', 'view-users', 'manage-users'])).toBe(
      'view-audit, view-users and manage-users',
    );
  });

  it('words what a system administrator holds, Full or a part of it', () => {
    expect(systemHoldsText('tenant-admin')).toBe(
      'is a system administrator, holding tenant-admin in',
    );
    expect(systemHoldsText('view-audit')).toBe('holds view-audit in');
  });
});
