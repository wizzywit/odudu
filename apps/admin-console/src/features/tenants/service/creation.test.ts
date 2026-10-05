import { describe, expect, it } from 'vitest';
import {
  administratorOf,
  type Creation,
  belongsTo,
  flowOf,
  FRESH_CREATION,
  freshCreation,
  resumesAdministrator,
  titleOrigin,
  administratorProblem,
  againOf,
  choosesHoldings,
  holdsText,
  systemHoldsText,
  unfinishedOf,
} from '#/features/tenants/service/creation.ts';

describe('the three guided flows', () => {
  it("keeps system's own administrators, and each tenant's, apart from tenant creation", () => {
    expect(flowOf('system')).toBe('system-administrator');
    expect(flowOf('acme')).toBe('administrator/acme');
    expect(flowOf('globex')).not.toBe(flowOf('acme'));
  });

  it('starts each at its own first step', () => {
    expect(freshCreation('tenant')).toEqual({ step: 'tenant', name: '', displayName: '' });
    expect(freshCreation('system-administrator')).toMatchObject({
      step: 'administrator',
      tenant: 'system',
      subjectId: null,
    });
    expect(freshCreation('administrator/acme')).toMatchObject({
      step: 'administrator',
      tenant: 'acme',
      origin: 'existing',
      subjectId: null,
    });
  });

  it('holds each flow to its own progress only', () => {
    const acme = administratorOf('acme', 'existing');
    expect(belongsTo('administrator/acme', acme)).toBe(true);
    expect(belongsTo('administrator/globex', acme)).toBe(false);
    expect(belongsTo('tenant', acme)).toBe(false);
    expect(belongsTo('tenant', administratorOf('acme', 'created'))).toBe(true);
    expect(belongsTo('administrator/acme', FRESH_CREATION)).toBe(false);
    expect(belongsTo('system-administrator', administratorOf('system', 'existing'))).toBe(true);
    expect(belongsTo('system-administrator', administratorOf('acme', 'existing'))).toBe(false);
    expect(belongsTo('tenant', { step: 'done', tenant: 'system', username: 'ada' })).toBe(false);
  });
});

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

  it('drops a creation only when a subject was already made', () => {
    expect(unfinishedOf(FRESH_CREATION)).toBeNull();
    expect(unfinishedOf(administratorOf('acme', 'existing'))).toBeNull();
    expect(
      unfinishedOf({
        step: 'administrator',
        tenant: 'acme',
        origin: 'existing',
        username: 'ada',
        email: '',
        subjectId: 's1',
        granted: true,
        holdings: ['tenant-admin'],
      }),
    ).toEqual({ tenant: 'acme', username: 'ada', granted: true });
    expect(unfinishedOf({ step: 'done', tenant: 'acme', username: 'ada' })).toBeNull();
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

  it('starts over to a tenant from a tenant, and to an administrator from any other flow', () => {
    expect(againOf('tenant')).toBe('tenant');
    expect(againOf('system-administrator')).toBe('administrator');
    expect(againOf('administrator/acme')).toBe('administrator');
  });
});

describe('the stored administrator step', () => {
  const stored = (subjectId: string | null): Creation => ({
    step: 'administrator',
    tenant: 'acme',
    origin: 'existing',
    username: 'ada',
    email: '',
    subjectId,
    granted: false,
    holdings: ['tenant-admin'],
  });

  it('is resumed only once its subject was created', () => {
    expect(resumesAdministrator(null)).toBe(false);
    expect(resumesAdministrator(FRESH_CREATION)).toBe(false);
    expect(resumesAdministrator(stored(null))).toBe(false);
    expect(resumesAdministrator(stored('s1'))).toBe(true);
  });

  it('titles the page by where the tenant came from, an existing one when nothing is stored', () => {
    expect(titleOrigin(null)).toBe('existing');
    expect(titleOrigin(FRESH_CREATION)).toBe('existing');
    expect(titleOrigin(administratorOf('acme', 'created'))).toBe('created');
    expect(titleOrigin(administratorOf('acme', 'imported'))).toBe('imported');
  });
});
