import { describe, expect, it } from 'vitest';
import { Chip } from '@site/src/features/landing/ui/Chip/Chip';
import { markupOf } from '@site/tests/support/markup';

describe('Chip', () => {
  it('shows its words and nothing else', () => {
    const $ = markupOf(<Chip>Planned</Chip>);
    expect($('[data-chip]').text()).toBe('Planned');
    expect($('[data-chip] *')).toHaveLength(0);
  });
});
