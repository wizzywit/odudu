import { describe, expect, it } from 'vitest';
import {
  systemAdminsTrail,
  tenantAdministratorTrail,
  tenantsTrail,
} from '#/features/tenants/service/address.ts';
import {
  creationHeading,
  ADD_SYSTEM_ADMIN_TITLE,
  CREATE_TENANT_TITLE,
  firstAdministratorNote,
  originText,
} from '#/features/tenants/service/heading.ts';

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

describe('the administrator step copy', () => {
  it('says where the tenant came from, after its name', () => {
    expect(originText('created')).toBe(
      'was created. It has no administrator yet, so nobody can sign in to its console.',
    );
    expect(originText('imported')).toBe(
      'was imported. An import creates no administrator, so nobody can sign in to its console yet.',
    );
    expect(originText('existing')).toBe('gets another administrator.');
  });

  it('says a first administrator holds Full, and nothing for a further one', () => {
    expect(firstAdministratorNote('created', 'acme')).toBe(
      'The first administrator holds Full, so somebody in acme can give every capability; narrow it afterwards under Administrators.',
    );
    expect(firstAdministratorNote('imported', 'acme')).not.toBeNull();
    expect(firstAdministratorNote('existing', 'acme')).toBeNull();
  });

  it('keeps the page titles in one place', () => {
    expect(CREATE_TENANT_TITLE).toBe('Create a tenant');
    expect(ADD_SYSTEM_ADMIN_TITLE).toBe('Add a system administrator');
  });
});
