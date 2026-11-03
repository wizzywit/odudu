import { describe, expect, it } from 'vitest';
import {
  choiceOf,
  draftOf,
  EMPTY_DRAFT,
  filtersOf,
  hasResourceType,
  withField,
} from '#/pages/audit/services/filterDraft';
import { ANY_STATUS } from '#/shared/lib/services/filters';

describe('the form as a draft of the filters', () => {
  it('reads "any" as no filter, and shows no filter as "any"', () => {
    expect(withField({ ...EMPTY_DRAFT, outcome: 'refused' }, 'outcome', ANY_STATUS).outcome).toBe(
      '',
    );
    expect(choiceOf(EMPTY_DRAFT, 'outcome')).toBe(ANY_STATUS);
    expect(choiceOf({ ...EMPTY_DRAFT, outcome: 'failed' }, 'outcome')).toBe('failed');
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
});
