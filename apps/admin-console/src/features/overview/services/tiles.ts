import type { CountResponse } from '@odudu/contracts/admin';
import { readable } from '#/shared/services/access';
import type { Authority } from '#/shared/services/principal';
import { countAgainLabel, limitText } from '#/features/overview/services/panelText';
import { gate } from '#/features/overview/services/readGate';
import { readyData } from '#/features/overview/services/readState';
import type { AreaOf, Gated, OverviewReads } from '#/features/overview/types/overviewReads';

export interface CountTile {
  id: string;
  label: string;
  href: string;
  noun: { one: string; other: string };
  count: Gated<CountResponse>;
  // The client cap said beside the count, when settings could be read.
  allowance?: string | undefined;
  againLabel: string;
}

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
        allowance: id === 'clients' && typeof cap === 'number' ? limitText(cap) : undefined,
        againLabel: countAgainLabel(noun.other),
      },
    ];
  });
}
