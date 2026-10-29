import { describe, expect, it } from 'vitest';
import { checkStylesheet } from '#/service/stylesheet';

const codes = (css: string): string[] => checkStylesheet(css).map((issue) => issue.code);

// Selectors that reach a part the page needs: the consent page's scope list
// and buttons, the rules and the alert.
const NEEDED = ['button', 'label', '.page', '.choice', '.rules', '.alert', 'p', 'main'];

describe('[ODUDU-THEME-LEGIBLE-01] checkStylesheet: a needed part stays visible', () => {
  const hiding: [string, string][] = [
    ['font-size zero', 'font-size: 0'],
    ['font-size zero px', 'font-size: 0px'],
    ['font-size below the floor', 'font-size: 3px'],
    ['font-size keyword below the floor', 'font-size: x-small'],
    ['font-size percent below the floor', 'font-size: 20%'],
    ['height zero with overflow', 'height: 0; overflow: hidden'],
    ['max-height zero with overflow', 'max-height: 0; overflow: hidden'],
    ['max-height zero px', 'max-height: 0px'],
    ['block-size zero', 'block-size: 0'],
    ['max-block-size zero', 'max-block-size: 0'],
    ['width zero with overflow', 'width: 0; overflow: hidden'],
    ['max-width zero', 'max-width: 0'],
    ['inline-size zero', 'inline-size: 0'],
    ['a one-pixel height', 'height: 1px; overflow: hidden'],
    ['a negative margin', 'margin-left: -9999px'],
    ['a negative margin shorthand', 'margin: -100px'],
    ['a negative inset', 'inset-inline-start: -9999px'],
    ['an offset', 'top: -9999px'],
    ['absolute positioning', 'position: absolute; left: -9999px'],
    ['fixed positioning', 'position: fixed'],
    ['text the colour of its background', 'color: #fff; background-color: #fff'],
    ['same colour spelt two ways', 'color: #ffffff; background-color: white'],
    ['same colour as the shorthand', 'color: #fff; background: #FFF'],
    ['same colour as rgb', 'color: rgb(255, 255, 255); background-color: #fff'],
    ['same token twice', 'color: var(--ink-primary); background-color: var(--ink-primary)'],
    ['transparent text', 'color: transparent'],
    ['fully clear rgba text', 'color: rgba(0, 0, 0, 0)'],
    ['fully clear hex text', 'color: #00000000'],
    ['hsla zero alpha', 'color: hsla(10, 10%, 10%, 0)'],
    ['letter spacing pulled together', 'letter-spacing: -1em'],
  ];
  for (const [name, declarations] of hiding) {
    it(`refuses ${name} on every needed part`, () => {
      for (const selector of NEEDED) {
        expect(
          codes(`${selector} { ${declarations}; }`),
          `${selector} { ${declarations} }`,
        ).not.toEqual([]);
      }
    });
  }

  it('refuses a rule that names a needed part among others', () => {
    expect(codes('small, button { font-size: 0; }')).not.toEqual([]);
    expect(codes('.intro h1, .page { height: 0; }')).not.toEqual([]);
  });

  it('accepts the sizes, colours and spacing a theme uses', () => {
    const fine = [
      'button { font-size: 14px; }',
      'button { font-size: 0.875rem; }',
      'button { font-size: 100%; }',
      'p { font-size: medium; }',
      'main { max-width: 480px; }',
      'button { height: 44px; min-height: 0; }',
      'button { margin: 0 0 16px; padding: 0; }',
      'button { color: #fff; background-color: #06c; }',
      'button { color: #fff; background: transparent; }',
      'button { color: var(--ink-primary); background-color: var(--surface-page); }',
      'input::placeholder { color: currentColor; opacity: 0.7; }',
      'button { letter-spacing: -0.02em; }',
    ];
    for (const css of fine) expect(codes(css), css).toEqual([]);
  });
});

describe('checkStylesheet: a decorative part may collapse', () => {
  it('lets the hideable parts shrink, as display none already lets them go', () => {
    const fine = [
      '.logo { height: 0; overflow: hidden; }',
      '.links { font-size: 0; }',
      'small { color: transparent; }',
      '.wordmark { color: #fff; background-color: #fff; }',
    ];
    for (const css of fine) expect(codes(css), css).toEqual([]);
  });
});

describe('[ODUDU-THEME-FOCUS-01] checkStylesheet: the focus indicator stays', () => {
  const removing = [
    'button:focus { outline: none; }',
    'button:focus-visible { outline: 0; }',
    'a:focus-visible { outline-width: 0; }',
    'input:focus { outline-style: none; }',
    'input:focus { outline: 0px solid red; }',
    'input:focus { outline: transparent; }',
    'input:focus { outline-color: transparent; }',
    'input:focus { outline: 1px solid rgba(0, 0, 0, 0); }',
    'button { outline: none; }',
    'a { outline-style: hidden; }',
  ];
  for (const css of removing) {
    it(`refuses ${css}`, () => {
      expect(codes(css)).not.toEqual([]);
    });
  }

  it('accepts a styled outline', () => {
    const fine = [
      'button:focus-visible { outline: 2px solid #06c; outline-offset: 2px; }',
      'input:focus { outline-width: 3px; outline-style: dashed; outline-color: #06c; }',
      'a:hover { outline: 1px solid red; }',
    ];
    for (const css of fine) expect(codes(css), css).toEqual([]);
  });
});

describe('[ODUDU-THEME-LEGIBLE-01] a needed part is not pushed, shrunk or washed out', () => {
  const REACH = ['.page-consent h1', 'label', '.alert', 'button', 'main'];
  const refused = [
    'margin-left: 99999px',
    'margin-top: 99999px',
    'padding-left: 99999px',
    'padding-top: 99999px',
    'margin: 0 0 0 9rem',
    'padding: 60%',
    'width: 8px; overflow: hidden',
    'height: 8px; overflow: hidden',
    'max-width: 8px; overflow: hidden',
    'max-height: 8px; overflow: hidden',
    'height: 40px; overflow: hidden',
    'max-height: 2rem; overflow: auto',
    'color: rgba(0, 0, 0, 0.01)',
    'color: rgb(0 0 0 / 1%)',
    'color: rgba(0, 0, 0, 0.4)',
    'color: #0000007f',
    'letter-spacing: -2px',
    'letter-spacing: -0.06em',
  ];
  for (const declarations of refused) {
    it(`refuses ${declarations}`, () => {
      for (const selector of REACH) {
        expect(
          codes(`${selector} { ${declarations}; }`),
          `${selector} ${declarations}`,
        ).not.toEqual([]);
      }
    });
  }

  it('refuses text the colour of the page or panel behind it', () => {
    const text = ['.page-consent h1', 'label', 'p', '.page-consent .intro h1'];
    const colours = [
      'var(--surface-page)',
      'var(--surface-panel)',
      'var(--surface-sunken)',
      '#fafafa',
      '#ffffff',
      '#e7eae9',
      '#f3f5f4',
    ];
    for (const selector of text) {
      for (const colour of colours) {
        expect(codes(`${selector} { color: ${colour}; }`), `${selector} ${colour}`).not.toEqual([]);
      }
    }
  });

  it('knows the dark surfaces only inside the dark scheme', () => {
    expect(codes('label { color: #151a19; }')).toEqual([]);
    expect(codes('@media (prefers-color-scheme: dark) { label { color: #151a19; } }')).not.toEqual(
      [],
    );
    expect(codes('@media (prefers-color-scheme: dark) { label { color: #fafafa; } }')).toEqual([]);
  });

  it('accepts the sizes and colours of a real card, button and heading', () => {
    const fine = [
      '.page-consent h1 { color: var(--ink-primary); margin: 0 0 var(--space-4); }',
      'button { color: var(--surface-panel); background-color: var(--ink-primary); }',
      'button { padding: 12px 24px; margin-top: 16px; width: 100%; max-width: 20rem; }',
      'input { width: 20px; height: 20px; }',
      'label { padding: 8px 12px; color: #1a1a1a; letter-spacing: 0.02em; }',
      '.alert { color: var(--signal-danger-ink); }',
      'main { max-width: 32rem; margin: 0 auto; padding: 2rem 1rem; overflow: visible; }',
      'label { color: rgba(0, 0, 0, 0.7); }',
    ];
    for (const css of fine) expect(codes(css), css).toEqual([]);
  });
});

describe('[ODUDU-THEME-CLIENTNAME-01] the consent page keeps its scope list and heading', () => {
  const REACHED = [
    'ul',
    'ol',
    'li',
    '.page-consent ul',
    '.page-consent li',
    'ul li',
    'h1',
    '.intro',
  ];
  for (const selector of REACHED) {
    it(`refuses to hide or collapse ${selector}`, () => {
      for (const declarations of ['display: none', 'height: 0; overflow: hidden', 'font-size: 0']) {
        expect(
          codes(`${selector} { ${declarations}; }`),
          `${selector} ${declarations}`,
        ).not.toEqual([]);
      }
    });
  }

  it('lets another page kind hide or collapse them', () => {
    expect(codes('.page-sign-in ul { display: none; }')).toEqual([]);
    expect(codes('.page-reset li { display: none; }')).toEqual([]);
  });
});

describe('[ODUDU-THEME-FOCUS-01] the focus indicator cannot be reset, hidden or pushed away', () => {
  const removing = [
    'outline: initial',
    'outline: unset',
    'outline: inherit',
    'outline: revert',
    'outline-style: initial',
    'outline-style: unset',
    'outline-style: inherit',
    'outline-style: revert',
    'outline-width: unset',
    'outline-offset: 99999px',
    'outline-offset: -99999px',
    'outline: 2px solid #fff',
    'outline: 2px solid #fafafa',
    'outline-color: var(--surface-page)',
    'outline-color: rgba(0, 0, 0, 0.01)',
    'outline: 2px solid rgb(0 0 0 / 1%)',
  ];
  for (const declarations of removing) {
    it(`refuses ${declarations} on a focus rule`, () => {
      expect(codes(`button:focus-visible { ${declarations}; }`)).not.toEqual([]);
      expect(codes(`a:focus { ${declarations}; }`)).not.toEqual([]);
    });
  }

  it('accepts a visible outline, offset a little', () => {
    const fine = [
      'a:focus-visible { outline: 3px solid #06c; outline-offset: 4px; }',
      'a:focus-visible { outline-offset: 2px; outline: 2px solid var(--focus-ring); }',
      'a:focus-visible { outline: 2px dashed #b00020; }',
    ];
    for (const css of fine) expect(codes(css), css).toEqual([]);
  });
});
