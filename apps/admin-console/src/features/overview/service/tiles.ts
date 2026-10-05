import type { CountResponse } from '@odudu/contracts/admin';
import { readable } from '#/shared/service/access.ts';
import type { AdminCapability, Authority } from '#/shared/service/principal.ts';
import {
  type Gated,
  type OverviewReads,
  gate,
  readyData,
} from '#/features/overview/service/reads.ts';

export interface CountTile {
  id: string;
  label: string;
  href: string;
  noun: { one: string; other: string };
  count: Gated<CountResponse>;
  // The client cap, when settings could be read.
  limit?: number | undefined;
}

// What an area is called, needs and is addressed by; the overview links to
// areas it does not own.
export interface Place {
  label: string;
  capability: AdminCapability | null;
  href: string;
}

export type AreaOf = (path: string) => Place;

const COUNTED = [
  { id: 'subjects', noun: { one: 'subject', other: 'subjects' } },
  { id: 'clients', noun: { one: 'client', other: 'clients' } },
  { id: 'groups', noun: { one: 'group', other: 'groups' } },
  { id: 'roles', noun: { one: 'role', other: 'roles' } },
  { id: 'scopes', noun: { one: 'scope', other: 'scopes' } },
] as const;

// A tile links to its area, so one the rail leaves out is left out here.
export function countTiles(
  reads: OverviewReads,
  authority: Authority | undefined,
  areaOf: AreaOf,
): CountTile[] {
  const cap = readyData(reads.settings)?.max_clients;
  return COUNTED.flatMap(({ id, noun }) => {
    const place = areaOf(id);
    if (!readable(authority, place.capability)) return [];
    return [
      {
        id,
        label: place.label,
        href: place.href,
        noun,
        count: gate(reads.counts[id], authority, place.capability),
        limit: id === 'clients' && typeof cap === 'number' ? cap : undefined,
      },
    ];
  });
}
