import { describe, expect, it } from 'vitest';
import { auditQuery, filtersToSearch, readFilters } from '#/pages/audit/services/auditAddress';

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

  it('ignores an end that is no instant, and says which end it was', () => {
    const { filters, ignored } = read('to=tomorrow&from=2026-09-28T10:00:00Z');
    expect(filters).toEqual({ from: '2026-09-28T10:00:00Z' });
    expect(ignored).toEqual([
      'The address names a to the trail cannot read (“tomorrow”), so it was ignored.',
    ]);
  });

  it('ignores a date a person would read but the API would not: no zone, or a spelled-out month', () => {
    expect(read('from=2026-09-28T10:00:00').ignored).toHaveLength(1);
    expect(read('to=Dec 25 2026').ignored).toHaveLength(1);
  });

  it('ignores a resource type or id longer than the API accepts, and the id left alone with it', () => {
    const long = 'a'.repeat(257);
    expect(read(`resource_type=${long}`).filters).toEqual({});
    const { filters, ignored } = read(`resource_type=client&resource_id=${long}`);
    expect(filters).toEqual({ resource_type: 'client' });
    expect(ignored).toHaveLength(1);
  });

  it('shows a long ignored value cut, so the page does not echo the whole address', () => {
    const { ignored } = read(`outcome=${'x'.repeat(100)}`);
    expect(ignored[0]).toBe(
      `The address names a outcome the trail cannot read (“${'x'.repeat(40)}…”), so it was ignored.`,
    );
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
});
