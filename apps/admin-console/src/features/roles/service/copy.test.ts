import { describe, expect, it } from 'vitest';
import type { AdminCapability } from '#/shared/service/principal.ts';
import {
  type CopyRead,
  copiedDescription,
  copyingOf,
  copyingText,
  copyPlan,
  partialCopy,
} from '#/features/roles/service/copy.ts';
import { copyHrefOf } from '#/features/roles/service/address.ts';

function role(
  id: string,
  name: string,
  clientKey: string | null = null,
  reach: AdminCapability[] = [],
) {
  return {
    admin_reach: reach,
    id,
    name,
    description: null,
    client_id: clientKey === null ? null : `c-${clientKey}`,
    client_key: clientKey,
    default_for_new_subjects: false,
    created_at: '2026-09-28T08:41:53.858Z',
  };
}

const AUDITOR = role('r-aud', 'auditor');

const READER = role('r-read', 'reader');

const USERS = role('r-users', 'manage-users', 'odudu-admin', ['view-users', 'manage-users']);

describe('copying a role', () => {
  it('nests each child the caller could nest, and says why it leaves the rest', () => {
    const plan = copyPlan([AUDITOR, USERS], ['view-users'], 'acme');
    expect(plan.nested).toEqual([AUDITOR]);
    expect(plan.left).toEqual([
      {
        name: 'manage-users',
        why: 'You do not hold manage-users, so you cannot give or take it.',
      },
    ]);
  });

  it('nests everything until the caller is known', () => {
    expect(copyPlan([AUDITOR, USERS], undefined, 'acme')).toEqual({
      nested: [AUDITOR, USERS],
      left: [],
    });
  });

  it('shows the description edited, else the source one', () => {
    const source: CopyRead = {
      status: 'ready',
      role: { ...AUDITOR, description: 'Reads' },
      children: [],
    };
    expect(copiedDescription('mine', source)).toBe('mine');
    expect(copiedDescription('', source)).toBe('');
    expect(copiedDescription(null, source)).toBe('Reads');
    expect(copiedDescription(null, { status: 'ready', role: AUDITOR, children: [] })).toBe('');
    expect(copiedDescription(null, { status: 'loading' })).toBe('');
  });

  it('maps the source read to what the page shows', () => {
    const plan = { nested: [AUDITOR], left: [{ name: 'x', why: 'y' }] };
    expect(copyingOf({ status: 'none' }, plan)).toEqual({ status: 'none' });
    expect(copyingOf({ status: 'loading' }, plan)).toEqual({ status: 'loading' });
    expect(copyingOf({ status: 'failed' }, plan)).toEqual({ status: 'failed' });
    expect(copyingOf({ status: 'ready', role: READER, children: [] }, plan)).toEqual({
      status: 'ready',
      name: 'reader',
      children: ['auditor'],
      left: [{ name: 'x', why: 'y' }],
    });
  });

  it('says what a copy nests', () => {
    expect(copyingText({ name: 'reader', children: [] })).toBe(
      'A copy of reader, nesting nothing.',
    );
    expect(copyingText({ name: 'reader', children: ['a', 'b', 'c'] })).toBe(
      'A copy of reader, nesting a, b and c.',
    );
  });

  it('keeps a copy missing composites on the page, pointing at where to add them', () => {
    expect(partialCopy('acme', READER, [])).toBeNull();
    expect(partialCopy('acme', READER, [AUDITOR, USERS])).toEqual({
      text: 'reader was created, but auditor and manage-users could not be nested in it. Add them from its Composites tab.',
      href: '/console/acme/roles/r-read?tab=composites',
      name: 'reader',
    });
  });

  it('offers a copy only of a tenant role', () => {
    expect(copyHrefOf('acme', READER)).toBe('/console/acme/roles/new?copy=r-read');
    expect(copyHrefOf('acme', USERS)).toBeNull();
    expect(copyHrefOf('acme', undefined)).toBeNull();
  });
});
