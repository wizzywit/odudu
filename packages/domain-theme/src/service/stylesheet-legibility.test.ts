import { describe, expect, it } from 'vitest';
import { checkStylesheet } from '#/service/stylesheet';

const codes = (css: string): string[] => checkStylesheet(css).map((issue) => issue.code);

// Selectors that reach a part the page needs: the consent page's scope list
// and buttons, the rules and the alert.
const NEEDED = ['button', 'label', '.page', '.choice', '.rules', '.alert', 'p', 'main'];

describe('checkStylesheet: a needed part stays visible', () => {
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

describe('checkStylesheet: the focus indicator stays', () => {
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
