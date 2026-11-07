import type { CountResponse } from '#/shared/lib/types/count';
import { readable } from '#/shared/lib/services/access';
import type { Authority } from '#/shared/lib/services/principal';
import { countAgainLabel, limitText } from '#/pages/overview/services/panelText';
import { gate } from '#/pages/overview/services/readGate';
import { readyData } from '#/pages/overview/services/readState';
import type { AreaOf, Gated, OverviewReads } from '#/pages/overview/types/overviewReads';

export interface CountTile {
  id: string;
  label: string;
  href: string;
  noun: { one: string; other: string };
  count: Gated<CountResponse>;
  // What the client cap counts, said beside the count once both reads are in.
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
  const made = readyData(reads.operatorClients);
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
        allowance:
          id === 'clients' && typeof cap === 'number' && made !== undefined
            ? limitText(cap, made)
            : undefined,
        againLabel: countAgainLabel(noun.other),
      },
    ];
  });
}
