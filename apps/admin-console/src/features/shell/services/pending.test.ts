import { describe, expect, it } from 'vitest';
import { areaAccess, pendingPage } from '#/features/shell/services/pending';
import { areaAt, OVERVIEW } from '#/entities/area';

const SYSTEM_ADMIN = { tenant: 'system', subjectId: 's0', username: 'root' };

const ACME_ADMIN = { tenant: 'acme', subjectId: 's1', username: 'grace' };

const everything = {
  capabilities: ['manage-tenants', 'view-users'] as const,
  crossTenant: false,
};

describe('the page a tenant address stands for while the session is read', () => {
  it('draws the overview panels for the tenant root, with or without a slash', () => {
    const expected = { tenant: 'acme', shape: 'overview', title: 'Overview' };
    expect(pendingPage('/console/acme')).toEqual(expected);
    expect(pendingPage('/console/acme/')).toEqual(expected);
    expect(pendingPage('/acme')).toEqual(expected);
  });

  it('draws a table for a list area and names it', () => {
    expect(pendingPage('/console/acme/subjects')).toEqual({
      tenant: 'acme',
      shape: 'list',
      title: 'Subjects',
    });
    expect(pendingPage('/console/system/tenants')?.shape).toBe('list');
    expect(pendingPage('/console/acme/audit')?.shape).toBe('list');
  });

  it('draws a record for a page below a list, and a form for a creation page', () => {
    expect(pendingPage('/console/acme/subjects/abc')).toEqual({
      tenant: 'acme',
      shape: 'record',
      title: null,
    });
    expect(pendingPage('/console/system/tenants/acme')?.shape).toBe('record');
    expect(pendingPage('/console/acme/groups/new')?.shape).toBe('form');
    expect(pendingPage('/console/system/new-tenant')?.shape).toBe('form');
    expect(pendingPage('/console/system/tenants/acme/new-administrator')?.shape).toBe('form');
  });

  it('draws a form for an area that is a single page', () => {
    expect(pendingPage('/console/acme/settings')).toEqual({
      tenant: 'acme',
      shape: 'form',
      title: 'Settings',
    });
  });

  it('draws plain lines for an address no area owns', () => {
    expect(pendingPage('/console/acme/nowhere')).toEqual({
      tenant: 'acme',
      shape: 'page',
      title: null,
    });
  });

  it('draws nothing for the bare root or a name no tenant can have', () => {
    expect(pendingPage('/console')).toBeNull();
    expect(pendingPage('/console/')).toBeNull();
    expect(pendingPage('/')).toBeNull();
    expect(pendingPage('/console/Not_A_Tenant/subjects')).toBeNull();
  });
});

describe('what an area shows its caller', () => {
  const nothing = { capabilities: [] as const, crossTenant: false };
  const viewer = { capabilities: ['view-users'] as const, crossTenant: false };

  it('is open for an area that needs no capability', () => {
    expect(areaAccess(ACME_ADMIN, 'acme', undefined, OVERVIEW, false)).toEqual({ kind: 'open' });
    expect(areaAccess(ACME_ADMIN, 'acme', nothing, OVERVIEW, true)).toEqual({ kind: 'open' });
  });

  it('is checking while whoami is unanswered, so no read is made that it may refuse', () => {
    expect(areaAccess(ACME_ADMIN, 'acme', undefined, areaAt('subjects'), false)).toEqual({
      kind: 'checking',
    });
  });

  it('is open once whoami has failed to answer, since it is advice and the server decides', () => {
    expect(areaAccess(ACME_ADMIN, 'acme', undefined, areaAt('subjects'), true)).toEqual({
      kind: 'open',
    });
  });

  it('is refused, naming the capability, when whoami says it is not held', () => {
    expect(areaAccess(ACME_ADMIN, 'acme', nothing, areaAt('subjects'), true)).toEqual({
      kind: 'refused',
      capability: 'view-users',
    });
    expect(areaAccess(ACME_ADMIN, 'acme', viewer, areaAt('subjects'), true)).toEqual({
      kind: 'open',
    });
  });

  it('is hidden for a System area anywhere but the system tenant, to a system administrator', () => {
    const tenants = areaAt('tenants');
    expect(areaAccess(SYSTEM_ADMIN, 'acme', everything, tenants, true)).toEqual({ kind: 'hidden' });
    expect(areaAccess(ACME_ADMIN, 'system', everything, tenants, true)).toEqual({ kind: 'hidden' });
    expect(areaAccess(ACME_ADMIN, 'acme', everything, tenants, true)).toEqual({ kind: 'hidden' });
  });

  it('is checking for a System area until whoami answers', () => {
    expect(areaAccess(SYSTEM_ADMIN, 'system', undefined, areaAt('tenants'), false)).toEqual({
      kind: 'checking',
    });
  });

  it('is open for a System area when manage-tenants is held, and hidden when whoami says not', () => {
    expect(areaAccess(SYSTEM_ADMIN, 'system', everything, areaAt('tenants'), true)).toEqual({
      kind: 'open',
    });
    expect(areaAccess(SYSTEM_ADMIN, 'system', viewer, areaAt('tenants'), true)).toEqual({
      kind: 'hidden',
    });
  });
});
