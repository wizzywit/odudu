import type { Settings } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import type { AdminCapability, Authority } from '#/shared/service/principal.ts';
import { countTiles, type AreaOf } from '#/features/overview/service/tiles.ts';
import { type OverviewReads, type Read } from '#/features/overview/service/reads.ts';

const retry = (): void => undefined;

const OFF: Read<never> = { status: 'off' };

const LOADING: Read<never> = { status: 'loading' };

const REFUSED: Read<never> = { status: 'failed', refused: true, retry };

function ready<T>(data: T): Read<T> {
  return { status: 'ready', data };
}

function authority(...capabilities: Authority['capabilities'][number][]): Authority {
  return { capabilities, crossTenant: false };
}

const AREAS: Readonly<Record<string, { label: string; capability: AdminCapability | null }>> = {
  subjects: { label: 'Subjects', capability: 'view-users' },
  clients: { label: 'Clients', capability: 'manage-clients' },
  groups: { label: 'Groups', capability: 'manage-tenant' },
  roles: { label: 'Roles', capability: 'manage-tenant' },
  scopes: { label: 'Scopes', capability: 'manage-tenant' },
  email: { label: 'Email', capability: 'manage-tenant' },
  keys: { label: 'Signing keys', capability: 'manage-keys' },
  settings: { label: 'Settings', capability: 'manage-tenant' },
};

const areaOf: AreaOf = (path) => {
  const found = AREAS[path];
  if (found === undefined) throw new Error(`no area ${path}`);
  return { label: found.label, capability: found.capability, href: `/console/acme/${path}` };
};

function reads(over: Partial<OverviewReads> = {}): OverviewReads {
  return {
    discovery: OFF,
    jwks: OFF,
    counts: { subjects: OFF, clients: OFF, groups: OFF, roles: OFF, scopes: OFF },
    settings: OFF,
    smtp: OFF,
    keys: OFF,
    audit: OFF,
    ...over,
  };
}

describe('the count tiles', () => {
  const asked = reads({
    counts: {
      subjects: ready({ count: 3, capped: false }),
      clients: ready({ count: 2, capped: false }),
      groups: LOADING,
      roles: OFF,
      scopes: OFF,
    },
    settings: ready<Settings>({ max_clients: 200 }),
  });

  it('leaves out the tile of an area the caller cannot read', () => {
    const tiles = countTiles(asked, authority('view-users'), areaOf);
    expect(tiles.map((t) => t.id)).toEqual(['subjects']);
  });

  it('lists every tile until whoami has answered, in the rail order', () => {
    expect(countTiles(asked, undefined, areaOf).map((t) => t.id)).toEqual([
      'subjects',
      'clients',
      'groups',
      'roles',
      'scopes',
    ]);
  });

  it('carries the area label and address, and the noun the count is said in', () => {
    const [tile] = countTiles(asked, undefined, areaOf);
    expect(tile).toMatchObject({
      id: 'subjects',
      label: 'Subjects',
      href: '/console/acme/subjects',
      noun: { one: 'subject', other: 'subjects' },
      count: { status: 'ready' },
    });
  });

  it('puts the client cap on the clients tile alone, when settings gave a number', () => {
    const tiles = countTiles(asked, undefined, areaOf);
    expect(tiles.map((t) => t.limit)).toEqual([undefined, 200, undefined, undefined, undefined]);
    const none = countTiles(
      reads({ settings: ready<Settings>({ max_clients: null }) }),
      undefined,
      areaOf,
    );
    expect(none.every((t) => t.limit === undefined)).toBe(true);
  });

  it('gates a count the caller does not hold', () => {
    const [tile] = countTiles(asked, authority('manage-keys'), areaOf);
    expect(tile).toBeUndefined();
    const all = countTiles(
      reads({ counts: { ...asked.counts, groups: REFUSED } }),
      authority('manage-tenant'),
      areaOf,
    );
    expect(all.map((t) => t.count.status)).toEqual(['needs', 'off', 'off']);
  });
});
