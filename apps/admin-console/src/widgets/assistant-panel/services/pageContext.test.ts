import { assistantPageContextSchema } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import { pageContextOf, pageLabel } from '#/widgets/assistant-panel/services/pageContext';

describe('where the administrator is', () => {
  it('names the route below the tenant and no more', () => {
    expect(pageContextOf('/acme/roles', 'acme')).toEqual({ route: '/roles' });
    expect(pageContextOf('/acme', 'acme')).toEqual({ route: '/' });
    expect(pageContextOf('/acme/', 'acme')).toEqual({ route: '/' });
  });

  it('names the record a page shows, by its kind and id', () => {
    expect(pageContextOf('/acme/clients/c1', 'acme')).toEqual({
      route: '/clients/c1',
      objectType: 'client',
      objectId: 'c1',
    });
    expect(pageContextOf('/acme/subjects/0192-ab/sessions', 'acme')).toEqual({
      route: '/subjects/0192-ab/sessions',
      objectType: 'subject',
      objectId: '0192-ab',
    });
    expect(pageContextOf('/acme/groups/g_1', 'acme')).toMatchObject({
      objectType: 'group',
      objectId: 'g_1',
    });
  });

  it('names no record for a list, a page of one kind, or an address that is not an id', () => {
    expect(pageContextOf('/acme/clients', 'acme')).toEqual({ route: '/clients' });
    expect(pageContextOf('/acme/settings/assistant', 'acme')).toEqual({
      route: '/settings/assistant',
    });
    expect(pageContextOf('/acme/clients/a%20b', 'acme').objectId).toBeUndefined();
  });

  it('falls back to the tenant’s home for a path outside it, or one the server would refuse', () => {
    expect(pageContextOf('/other/roles', 'acme')).toEqual({ route: '/' });
    expect(pageContextOf('/somewhere/else', 'acme')).toEqual({ route: '/' });
    expect(pageContextOf(`/acme/${'a'.repeat(300)}`, 'acme')).toEqual({ route: '/' });
    expect(pageContextOf('/acme/ro les', 'acme')).toEqual({ route: '/' });
  });

  it.each([
    '/acme/roles',
    '/acme/clients/c1/branding',
    '/acme/subjects/0192-ab',
    '/acme/audit',
    '/acme',
  ])('only ever builds what the contract accepts: %s', (path) => {
    expect(assistantPageContextSchema.safeParse(pageContextOf(path, 'acme')).success).toBe(true);
  });
});

describe('the chip that says where', () => {
  it('shows the record when there is one, else the route', () => {
    expect(pageLabel({ route: '/clients/c1', objectType: 'client', objectId: 'c1' })).toBe(
      'client c1',
    );
    expect(pageLabel({ route: '/roles' })).toBe('/roles');
    expect(pageLabel({ route: '/' })).toBe('Overview');
  });
});
