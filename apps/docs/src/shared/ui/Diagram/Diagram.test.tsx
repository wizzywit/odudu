import { describe, expect, it } from 'vitest';
import { Diagram } from '@site/src/shared/ui/Diagram';
import { markupOf } from '@site/tests/support/markup';

describe('Diagram', () => {
  it('draws one named drawing with its own title and description', () => {
    const $ = markupOf(<Diagram name="sessions" title="A title" desc="What it shows." />);
    expect($('svg').attr('data-diagram')).toBe('sessions');
    expect($('title').text()).toBe('A title');
    expect($('desc').text()).toBe('What it shows.');
    expect($('svg').attr('aria-labelledby')).toBe($('title').attr('id'));
  });
});
