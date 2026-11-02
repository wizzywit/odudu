import { describe, expect, it } from 'vitest';
import {
  type CopyRead,
  sourceChildren,
  sourceDescription,
  copyingOf,
  copyingText,
  copyPlan,
  copySourceOf,
  partialCopy,
} from '#/features/roles/services/copy';
import { copyHrefOf } from '#/features/roles/services/address';
import { role } from '#/testing/roleAnswers';

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

  it("reads the source's description, none until it is ready", () => {
    const ready: CopyRead = {
      status: 'ready',
      role: { ...AUDITOR, description: 'Reads' },
      children: [],
    };
    expect(sourceDescription(ready)).toBe('Reads');
    expect(sourceDescription({ status: 'ready', role: AUDITOR, children: [] })).toBeNull();
    expect(sourceDescription({ status: 'loading' })).toBeNull();
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

describe('the children of the source a copy is made of', () => {
  it('are those of a role read, and none until then', () => {
    const ready: CopyRead = { status: 'ready', role: READER, children: [AUDITOR] };
    expect(sourceChildren(ready)).toEqual([AUDITOR]);
    expect(sourceChildren({ status: 'loading' })).toEqual([]);
    expect(sourceChildren({ status: 'failed' })).toEqual([]);
    expect(sourceChildren({ status: 'none' })).toEqual([]);
  });
});

describe('what a role copy keeps of its reads', () => {
  const ok = <T>(data: T) => ({ ok: true as const, status: 200, data, etag: null, next: null });

  it('keeps the role and its children when both were read, and nothing when either failed', () => {
    expect(copySourceOf(ok(READER), ok({ items: [AUDITOR] }))).toEqual({
      role: READER,
      children: [AUDITOR],
    });
    expect(copySourceOf({ ok: false, kind: 'network' }, ok({ items: [] }))).toBeNull();
    expect(copySourceOf(ok(READER), { ok: false, kind: 'network' })).toBeNull();
  });
});
