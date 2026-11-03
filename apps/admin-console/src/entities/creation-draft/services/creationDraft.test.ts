import { describe, expect, it } from 'vitest';
import type { Creation } from '#/entities/creation-draft/types/creation';
import {
  administratorOf,
  belongsTo,
  flowOf,
  FRESH_CREATION,
  freshCreation,
  resumesAdministrator,
} from '#/entities/creation-draft/services/creationDraft';

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
});
