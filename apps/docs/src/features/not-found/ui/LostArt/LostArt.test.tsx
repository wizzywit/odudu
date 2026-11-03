import { describe, expect, it } from 'vitest';
import { LostArt } from '@site/src/features/not-found/ui/LostArt/LostArt';
import { markupOf } from '@site/tests/support/markup';

describe('LostArt', () => {
  it('is decoration only: hidden from assistive technology, with no title or text', () => {
    const $ = markupOf(<LostArt />);
    expect($('svg').attr('aria-hidden')).toBe('true');
    expect($('svg').attr('focusable')).toBe('false');
    expect($('svg title, svg desc, svg text')).toHaveLength(0);
  });

  it('draws in the colour of the text around it, with no inline style', () => {
    const $ = markupOf(<LostArt />);
    expect($('svg').attr('stroke')).toBe('currentColor');
    expect($('[style]')).toHaveLength(0);
  });
});
