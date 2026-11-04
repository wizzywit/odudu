import { expect, it } from 'vitest';
import type { Domain } from '#/pages/domains/types/domain';
import { addressLine, challengesOf, domainRows } from '#/pages/domains/services/rows';

function domain(id: string, state: Domain['state'], extra: Partial<Domain> = {}): Domain {
  return {
    id,
    host: `${id}.acme.com`,
    state,
    canonical: false,
    verified_at: null,
    last_checked_at: null,
    dns_record: null,
    ...extra,
  };
}

const RECORD = { name: '_odudu-challenge.p.acme.com', value: 'odudu-verify=abc' };

it('offers verify and remove on a pending and on a failed domain', () => {
  const rows = domainRows([domain('p', 'pending', { dns_record: RECORD }), domain('f', 'failed')]);
  expect(rows.map((row) => row.actions)).toEqual([
    ['verify', 'remove'],
    ['verify', 'remove'],
  ]);
});

it('offers a verified domain that is not the address to be made it, or removed', () => {
  const [row] = domainRows([domain('v', 'verified')]);
  expect(row?.actions).toEqual(['activate', 'remove']);
  expect(row?.use).toBe('Not in use');
});

it('offers the address only the switch back, never a removal', () => {
  const [row] = domainRows([domain('c', 'verified', { canonical: true })]);
  expect(row?.actions).toEqual(['deactivate']);
  expect(row?.use).toBe('Current address');
});

it('still offers the switch back on an address whose domain has failed', () => {
  const [row] = domainRows([domain('c', 'failed', { canonical: true })]);
  expect(row?.actions).toEqual(['deactivate']);
});

it('names each action by the host it acts on, for a screen reader', () => {
  const [row] = domainRows([domain('v', 'verified')]);
  expect(row?.labels).toEqual({
    verify: 'Verify v.acme.com',
    activate: 'Make v.acme.com the address',
    deactivate: 'Switch back from v.acme.com',
    remove: 'Remove v.acme.com',
  });
});

it('tones a state: pending warns, verified is active, failed is danger', () => {
  const rows = domainRows([domain('p', 'pending'), domain('v', 'verified'), domain('f', 'failed')]);
  expect(rows.map((row) => [row.tag.label, row.tag.tone])).toEqual([
    ['Pending', 'warning'],
    ['Verified', 'active'],
    ['Failed', 'danger'],
  ]);
});

it('says where the tenant signs in now', () => {
  expect(addressLine([domain('v', 'verified')])).toBe('This tenant signs in at its path address.');
  expect(addressLine([domain('c', 'verified', { canonical: true })])).toBe(
    'This tenant signs in at c.acme.com.',
  );
});

it('lists a challenge for each domain that has a record to publish, and no other', () => {
  const challenges = challengesOf([
    domain('p', 'pending', { dns_record: RECORD }),
    domain('f', 'failed'),
    domain('v', 'verified'),
  ]);
  expect(challenges).toEqual([{ id: 'p', host: 'p.acme.com', record: RECORD }]);
});
