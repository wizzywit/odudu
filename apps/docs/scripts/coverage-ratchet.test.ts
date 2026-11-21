import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildMeOpenApiDocument } from '@odudu/me/docs';
import { buildAdminOpenApiDocument } from '@odudu/protocol-admin/docs';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_PROFILE,
  ME_PROFILE,
  coverageOfArea,
  operationsOf,
  type ReferenceDocument,
  type ReferenceProfile,
} from './openapi-pages.ts';

// A phase note records, per area of an API, how many of the fields a reader
// meets carry a description written for a person integrating. The number may
// rise and never fall; an area new to the API must be recorded.
const PHASES = path.resolve(import.meta.dirname, '../../../docs/phases');

interface Ratchet {
  readonly name: string;
  readonly profile: ReferenceProfile;
  readonly doc: ReferenceDocument;
  readonly notes: string;
  readonly heading: string;
}

const RATCHETS: readonly Ratchet[] = [
  {
    name: 'admin',
    profile: ADMIN_PROFILE,
    doc: buildAdminOpenApiDocument(),
    notes: 'p4g.md',
    heading: '#### Admin API documentation coverage',
  },
  {
    name: 'me',
    profile: ME_PROFILE,
    doc: buildMeOpenApiDocument(),
    notes: 'p4i.md',
    heading: '### Me API documentation coverage',
  },
];

function baseline(ratchet: Ratchet): Map<string, { described: number; total: number }> {
  const text = readFileSync(path.join(PHASES, ratchet.notes), 'utf8');
  const start = text.indexOf(ratchet.heading);
  if (start === -1)
    throw new Error(`${ratchet.heading} is missing from docs/phases/${ratchet.notes}`);
  const rows = new Map<string, { described: number; total: number }>();
  for (const line of text.slice(start).split('\n').slice(1)) {
    if (line.startsWith('#')) break;
    const match = /^\|\s*`([a-z-]+)`\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|$/u.exec(line);
    if (match?.[1] !== undefined) {
      rows.set(match[1], { described: Number(match[2]), total: Number(match[3]) });
    }
  }
  return rows;
}

describe.each(RATCHETS)('the descriptions in the $name API reference', (ratchet) => {
  const areas = operationsOf(ratchet.doc, ratchet.profile);

  it('are recorded for every area of the API', () => {
    expect([...areas.keys()].sort()).toEqual([...baseline(ratchet).keys()].sort());
  });

  it('cover at least the share of each area that was recorded', () => {
    const fell: string[] = [];
    for (const [area, recorded] of baseline(ratchet)) {
      const now = coverageOfArea(
        areas.get(area) ?? [],
        ratchet.doc,
        ratchet.profile.countsPathParameters,
      );
      // described/total compared as a product, so fields added without a description show up
      if (now.described * recorded.total < recorded.described * now.total) {
        fell.push(
          `${area}: ${String(now.described)}/${String(now.total)} below ${String(recorded.described)}/${String(recorded.total)}`,
        );
      }
    }
    expect(fell).toEqual([]);
  });
});
