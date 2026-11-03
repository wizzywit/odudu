import { describe, expect, it } from 'vitest';
import { SignInFlow } from '@site/src/features/landing/ui/SignInFlow/SignInFlow';
import { markupOf } from '@site/tests/support/markup';
import { PAGES_DOCS_BASE } from '@site/site.config';

describe('SignInFlow', () => {
  it('starts at rest with a scene for each layout and the controls in place', () => {
    const $ = markupOf(<SignInFlow />);
    expect($('[data-flow]').attr('data-step')).toBe('0');
    expect($('svg[data-layout]')).toHaveLength(2);
    expect($('[role="group"] button')).toHaveLength(7);
  });

  it('keeps the seven captions as a list for where script or motion is absent', () => {
    const $ = markupOf(<SignInFlow />);
    expect($('[data-flow-captions] > li')).toHaveLength(7);
    expect($('[data-flow-captions] [data-claim]').length).toBeGreaterThanOrEqual(5);
  });

  it('links the pages that give the detail', () => {
    const $ = markupOf(<SignInFlow />);
    expect(
      $('p a')
        .map((_, link) => $(link).attr('href'))
        .get(),
    ).toEqual([
      `${PAGES_DOCS_BASE}concepts/sessions/`,
      `${PAGES_DOCS_BASE}concepts/tokens/`,
      `${PAGES_DOCS_BASE}guides/sign-a-user-in/`,
    ]);
  });
});
