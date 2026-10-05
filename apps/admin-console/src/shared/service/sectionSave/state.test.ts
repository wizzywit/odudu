import { describe, expect, it } from 'vitest';
import { changedFrom, fieldValues, withoutFields } from '#/shared/service/sectionSave/state.ts';

const BASE = { name: 'a', tags: ['x'] };

describe('the section values', () => {
  it('reads the values off the fields, and which of them an edit changed', () => {
    const fields = {
      name: { value: 'a', label: 'Name', kind: 'plain' as const },
      tags: { value: ['x'], label: 'Tags', kind: 'plain' as const },
    };
    expect(fieldValues(fields)).toEqual(BASE);
    expect(changedFrom(BASE, { name: 'b', tags: ['x'], stray: 1 })).toEqual({ name: 'b' });
    expect(withoutFields({ name: 'b', tags: [] }, ['name'])).toEqual({ tags: [] });
  });
});
