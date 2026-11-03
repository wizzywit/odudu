import { describe, expect, it } from 'vitest';
import {
  actorHref,
  AREA_RESOURCES,
  resourceHref,
  type RecordPages,
} from '#/pages/audit/services/resourceLinks';

const PAGES: RecordPages = {
  subject: (tenant, id) => `/console/${tenant}/subjects/${id}`,
  client: (tenant, id) => `/console/${tenant}/clients/${id}`,
};
const areaPage = (area: string): string => `/console/acme/${area}`;
const ID = '0192f7a4-5c1e-7b3a-9d2e-6f8a1b2c3d4e';

describe('where a resource id leads', () => {
  it('to the record page, for a type that has one', () => {
    expect(resourceHref('acme', 'client', ID, PAGES, areaPage)).toBe(`/console/acme/clients/${ID}`);
  });

  it('to the record page of each type that has one, and the uppercase of a record id', () => {
    const every: RecordPages = {
      subject: (tenant, id) => `/s/${tenant}/${id}`,
      client: (tenant, id) => `/c/${tenant}/${id}`,
      group: (tenant, id) => `/g/${tenant}/${id}`,
      role: (tenant, id) => `/r/${tenant}/${id}`,
      scope: (tenant, id) => `/o/${tenant}/${id}`,
    };
    for (const [type, prefix] of [
      ['subject', 's'],
      ['client', 'c'],
      ['group', 'g'],
      ['role', 'r'],
      ['scope', 'o'],
    ] as const) {
      expect(resourceHref('acme', type, ID, every, areaPage), type).toBe(`/${prefix}/acme/${ID}`);
    }
    expect(resourceHref('acme', 'client', ID.toUpperCase(), every, areaPage)).toBe(
      `/c/acme/${ID.toUpperCase()}`,
    );
  });

  it('to the area, for a type with a page and no record page', () => {
    expect(AREA_RESOURCES).toEqual({
      signing_key: 'keys',
      flow: 'flow',
      registration_token: 'registration-tokens',
    });
    expect(resourceHref('acme', 'signing_key', ID, PAGES, areaPage)).toBe('/console/acme/keys');
    expect(resourceHref('acme', 'flow', ID, PAGES, areaPage)).toBe('/console/acme/flow');
    expect(resourceHref('acme', 'registration_token', ID, PAGES, areaPage)).toBe(
      '/console/acme/registration-tokens',
    );
  });

  it('nowhere for a type with neither, or an id that is not a record id', () => {
    expect(resourceHref('acme', 'grant', ID, PAGES, areaPage)).toBeNull();
    expect(resourceHref('acme', 'client', 'odudu-admin', PAGES, areaPage)).toBeNull();
    expect(resourceHref('acme', null, ID, PAGES, areaPage)).toBeNull();
    expect(resourceHref('acme', 'client', null, PAGES, areaPage)).toBeNull();
  });
});

describe('where an actor leads', () => {
  const page = (tenant: string, id: string) => `/console/${tenant}/subjects/${id}`;

  it('to the subject, for an actor of this tenant when the caller may read subjects', () => {
    expect(actorHref('acme', { actor_subject_id: ID, actor_origin: 'tenant' }, true, page)).toBe(
      `/console/acme/subjects/${ID}`,
    );
  });

  it('nowhere without view-users, for a caller from elsewhere, or with no subject', () => {
    expect(
      actorHref('acme', { actor_subject_id: ID, actor_origin: 'tenant' }, false, page),
    ).toBeNull();
    expect(
      actorHref('acme', { actor_subject_id: ID, actor_origin: 'system' }, true, page),
    ).toBeNull();
    expect(
      actorHref('acme', { actor_subject_id: null, actor_origin: null }, true, page),
    ).toBeNull();
  });
});
