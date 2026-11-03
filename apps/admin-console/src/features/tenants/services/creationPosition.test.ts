import { describe, expect, it } from 'vitest';
import {
  systemAdminsTrail,
  tenantAdministratorTrail,
  tenantsTrail,
} from '#/features/tenants/services/systemTrail';
import {
  creationHeading,
  pageOf,
  ADD_SYSTEM_ADMIN_TITLE,
  CREATE_TENANT_TITLE,
} from '#/features/tenants/services/creationPosition';

describe('the heading of the creation page', () => {
  it('is the tenant step, first under Tenants', () => {
    expect(creationHeading('tenant', { step: 'tenant' })).toEqual({
      at: 0,
      title: 'Create a tenant',
      breadcrumb: tenantsTrail('Create a tenant'),
    });
  });

  it("is a system administrator's step under System administrators, whichever flow", () => {
    const step = {
      step: 'administrator',
      tenant: 'system',
      origin: 'existing',
      systemAdminsHref: '/x',
    } as const;
    expect(creationHeading('system-administrator', step)).toEqual({
      at: 1,
      title: 'Add a system administrator',
      breadcrumb: systemAdminsTrail('Add a system administrator'),
    });
    expect(
      creationHeading('system-administrator', {
        step: 'done',
        tenant: 'system',
        systemAdminsHref: '/x',
      }).at,
    ).toBe(2);
  });

  it('is the first administrator of a tenant just made, under Tenants', () => {
    const step = {
      step: 'administrator',
      tenant: 'acme',
      origin: 'created',
      systemAdminsHref: null,
    } as const;
    expect(creationHeading('tenant', step)).toEqual({
      at: 1,
      title: 'First administrator of acme',
      breadcrumb: tenantsTrail('First administrator of acme'),
    });
  });

  it("is another administrator of an existing tenant, under that tenant's record", () => {
    const step = {
      step: 'administrator',
      tenant: 'acme',
      origin: 'existing',
      systemAdminsHref: null,
    } as const;
    expect(creationHeading('administrator/acme', step)).toEqual({
      at: 1,
      title: 'Add an administrator to acme',
      breadcrumb: tenantAdministratorTrail('acme'),
    });
    expect(
      creationHeading('administrator/acme', {
        step: 'done',
        tenant: 'acme',
        systemAdminsHref: null,
      }),
    ).toMatchObject({ at: 2, title: 'Add an administrator to acme' });
  });
});

it('keeps the page titles in one place', () => {
  expect(CREATE_TENANT_TITLE).toBe('Create a tenant');
  expect(ADD_SYSTEM_ADMIN_TITLE).toBe('Add a system administrator');
});

describe('pageOf', () => {
  it('reads the page off a creation: the tenant step bare, the others with their way back', () => {
    expect(pageOf({ step: 'tenant', name: 'a', displayName: '' })).toEqual({ step: 'tenant' });
    expect(
      pageOf({
        step: 'administrator',
        tenant: 'system',
        origin: 'existing',
        username: '',
        email: '',
        subjectId: null,
        granted: false,
        holdings: [],
      }),
    ).toMatchObject({ step: 'administrator', tenant: 'system', origin: 'existing' });
    expect(pageOf({ step: 'done', tenant: 'system', username: 'g' })).toEqual({
      step: 'done',
      tenant: 'system',
      systemAdminsHref: '/console/system/system-admins',
    });
    expect(pageOf({ step: 'done', tenant: 'acme', username: 'g' })).toEqual({
      step: 'done',
      tenant: 'acme',
      systemAdminsHref: null,
    });
  });
});
