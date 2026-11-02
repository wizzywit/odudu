import { describe, expect, it } from 'vitest';
import { Wrap } from '@site/src/features/landing/ui/Wrap/Wrap';
import { markupOf } from '@site/tests/support/markup';

describe('Wrap', () => {
  it('holds its children in one column', () => {
    const $ = markupOf(<Wrap>inside</Wrap>);
    expect($('div').text()).toBe('inside');
  });

  it('adds the class a caller gives it', () => {
    const $ = markupOf(<Wrap className="extra">inside</Wrap>);
    expect($('div').attr('class') ?? '').toContain('extra');
  });
});
