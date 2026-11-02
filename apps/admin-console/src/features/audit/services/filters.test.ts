import { describe, expect, it } from 'vitest';
import {
  applyBlocked,
  auditQuery,
  choiceOf,
  isClean,
  draftOf,
  draftProblems,
  filtersOf,
  filtersToSearch,
  hasResourceType,
  isFiltered,
  readFilters,
  withField,
  withUnreadable,
  EMPTY_DRAFT,
} from '#/features/audit/services/filters';
import { ANY_STATUS } from '#/shared/services/filters';

const ACTOR = '0192f7a4-5c1e-7b3a-9d2e-6f8a1b2c3d4e';

function read(search: string) {
  return readFilters(new URLSearchParams(search));
}

describe('reading the filters from the address', () => {
  it('reads each filter the API takes, and nothing else', () => {
    const { filters, ignored } = read(
      `event_type=admin_mutation&action=client.update&outcome=refused&actor_subject_id=${ACTOR}` +
        '&resource_type=client&resource_id=c1&from=2026-09-28T10:00:00.000Z&to=2026-09-28T11:00:00%2B01:00' +
        '&request_id=abc&after=x.y&tab=1',
    );
    expect(filters).toEqual({
      event_type: 'admin_mutation',
      action: 'client.update',
      outcome: 'refused',
      actor_subject_id: ACTOR,
      resource_type: 'client',
      resource_id: 'c1',
      from: '2026-09-28T10:00:00.000Z',
      to: '2026-09-28T11:00:00+01:00',
    });
    expect(ignored).toEqual([]);
  });

  it('reads an empty address as no filter, and an empty value as unset', () => {
    expect(read('')).toEqual({ filters: {}, ignored: [] });
    expect(read('action=&outcome=')).toEqual({ filters: {}, ignored: [] });
  });

  it('ignores a value the API would refuse, and says which and why', () => {
    const { filters, ignored } = read(
      `event_type=nope&outcome=maybe&actor_subject_id=bob&from=yesterday&action=ok`,
    );
    expect(filters).toEqual({ action: 'ok' });
    expect(ignored).toHaveLength(4);
    expect(ignored[0]).toMatch(/event type/iu);
    expect(ignored[0]).toMatch(/nope/u);
    expect(ignored.join(' ')).toMatch(/outcome/iu);
    expect(ignored.join(' ')).toMatch(/actor/iu);
    expect(ignored.join(' ')).toMatch(/from/iu);
  });

  it('ignores a text longer than the API accepts', () => {
    const { filters, ignored } = read(`action=${'a'.repeat(257)}`);
    expect(filters).toEqual({});
    expect(ignored).toHaveLength(1);
  });

  it('ignores a resource id that names no resource type', () => {
    const { filters, ignored } = read('resource_id=c1');
    expect(filters).toEqual({});
    expect(ignored[0]).toMatch(/resource type/iu);
    expect(read('resource_type=client&resource_id=c1').filters).toEqual({
      resource_type: 'client',
      resource_id: 'c1',
    });
  });

  it('ignores a range that ends before it starts', () => {
    const { filters, ignored } = read('from=2026-09-28T12:00:00Z&to=2026-09-28T11:00:00Z&action=x');
    expect(filters).toEqual({ action: 'x' });
    expect(ignored[0]).toMatch(/before/iu);
  });

  it('keeps a range that starts and ends at the same instant', () => {
    expect(read('from=2026-09-28T12:00:00Z&to=2026-09-28T12:00:00Z').ignored).toEqual([]);
  });

  it('takes the first of a repeated parameter', () => {
    expect(read('action=a&action=b').filters).toEqual({ action: 'a' });
  });
});

describe('the address a set of filters makes', () => {
  it('writes the filters, drops the trail, and keeps what else the address holds', () => {
    const base = new URLSearchParams('action=old&after=a.b&after=c.d&tab=x');
    const search = filtersToSearch(base, { outcome: 'refused', action: 'client.update' });
    expect(search.get('outcome')).toBe('refused');
    expect(search.get('action')).toBe('client.update');
    expect(search.has('after')).toBe(false);
    expect(search.get('tab')).toBe('x');
  });

  it('leaves out a filter that is unset', () => {
    expect(filtersToSearch(new URLSearchParams('action=old'), {}).toString()).toBe('');
  });

  it('asks the API for exactly the filters held', () => {
    expect(auditQuery({ outcome: 'failed', resource_type: 'role' }).toString()).toBe(
      'outcome=failed&resource_type=role',
    );
    expect(auditQuery({}).toString()).toBe('');
  });

  it('says whether any filter is held', () => {
    expect(isFiltered({})).toBe(false);
    expect(isFiltered({ action: 'x' })).toBe(true);
  });
});

describe('the form as a draft of the filters', () => {
  it('reads "any" as no filter, and shows no filter as "any"', () => {
    expect(withField({ ...EMPTY_DRAFT, outcome: 'refused' }, 'outcome', ANY_STATUS).outcome).toBe(
      '',
    );
    expect(choiceOf(EMPTY_DRAFT, 'outcome')).toBe(ANY_STATUS);
    expect(choiceOf({ ...EMPTY_DRAFT, outcome: 'failed' }, 'outcome')).toBe('failed');
  });

  it('is clean when no problem is held', () => {
    expect(isClean({})).toBe(true);
    expect(isClean({ to: 'x' })).toBe(false);
  });

  it('is blank for no filter and carries every filter held', () => {
    expect(draftOf({})).toEqual(EMPTY_DRAFT);
    expect(draftOf({ action: 'x' }).action).toBe('x');
  });

  it('becomes the filters held, trimmed and without the blanks', () => {
    expect(filtersOf({ ...EMPTY_DRAFT, action: '  client.update ', outcome: 'refused' })).toEqual({
      action: 'client.update',
      outcome: 'refused',
    });
  });

  it('takes a resource id only once it has a resource type that is not blank', () => {
    expect(hasResourceType(EMPTY_DRAFT)).toBe(false);
    expect(hasResourceType({ ...EMPTY_DRAFT, resource_type: '  ' })).toBe(false);
    expect(hasResourceType({ ...EMPTY_DRAFT, resource_type: 'client' })).toBe(true);
  });

  it('cannot hold a resource id with no resource type: clearing the type clears the id', () => {
    const named = { ...EMPTY_DRAFT, resource_type: 'client', resource_id: 'c1' };
    expect(withField(named, 'resource_type', '').resource_id).toBe('');
    expect(withField(named, 'resource_type', 'role').resource_id).toBe('c1');
    expect(withField(EMPTY_DRAFT, 'resource_id', 'c1').resource_id).toBe('');
  });

  it('is refused for a subject id that is not a UUID, with the reason beside it', () => {
    expect(draftProblems({ ...EMPTY_DRAFT, actor_subject_id: 'bob' }).actor_subject_id).toMatch(
      /UUID/u,
    );
    expect(draftProblems({ ...EMPTY_DRAFT, actor_subject_id: ACTOR })).toEqual({});
  });

  it('is refused for a text longer than the API accepts', () => {
    expect(draftProblems({ ...EMPTY_DRAFT, action: 'a'.repeat(257) }).action).toMatch(/256/u);
  });

  it('is refused for a range that ends before it starts, under the end', () => {
    const problems = draftProblems({
      ...EMPTY_DRAFT,
      from: '2026-09-28T12:00:00.000Z',
      to: '2026-09-28T11:59:59.999Z',
    });
    expect(problems.to).toMatch(/before/iu);
    expect(problems.from).toBeUndefined();
  });

  it('is accepted with only one end of the range', () => {
    expect(draftProblems({ ...EMPTY_DRAFT, from: '2026-09-28T12:00:00.000Z' })).toEqual({});
  });
});

describe('a date typed that no instant reads from', () => {
  it('is held against its field, and lifted when it reads', () => {
    const held = withUnreadable({}, 'from', 'That day does not exist.');
    expect(held).toEqual({ from: 'That day does not exist.' });
    expect(withUnreadable(held, 'to', 'Fill in every part.')).toEqual({
      from: 'That day does not exist.',
      to: 'Fill in every part.',
    });
    expect(withUnreadable(held, 'from', null)).toEqual({});
  });

  it('is a problem under its field, so the draft cannot be applied as if it were not there', () => {
    const problems = draftProblems(EMPTY_DRAFT, { from: 'That day does not exist.' });
    expect(problems.from).toBe('That day does not exist.');
    expect(isClean(problems)).toBe(false);
  });

  it('blocks Apply with one line that says the trail is not narrowed by it', () => {
    expect(applyBlocked({})).toBeNull();
    expect(applyBlocked({ to: 'x' })).toMatch(/not narrowed by it/u);
  });
});
