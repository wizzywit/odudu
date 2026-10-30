import { describe, expect, it } from 'vitest';
import { mailColoursProblem, mailLogoProblem } from '#/mail-branding';

const LOGO = { src: 'https://id.example/tenants/a/brand/x.png', alt: 'A', width: 100, height: 40 };

describe('mailLogoProblem', () => {
  it('accepts a plain https or http address with whole-number sides', () => {
    expect(mailLogoProblem(LOGO)).toBeNull();
    expect(mailLogoProblem({ ...LOGO, src: 'http://localhost:3000/a.png' })).toBeNull();
    expect(mailLogoProblem({ ...LOGO, width: 1024, height: 1 })).toBeNull();
  });

  it.each([
    'cid:odudu-mark',
    'data:image/png;base64,AA',
    'javascript:alert(1)',
    '/relative.png',
    'https://u:p@id.example/a.png',
    'https://id.example/a.png"x',
    'https://id.example/a b.png',
    ' https://id.example/a.png',
  ])('refuses the address %s', (src) => {
    expect(mailLogoProblem({ ...LOGO, src })).not.toBeNull();
  });

  it.each([0, -1, 1.5, 1025, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses a side of %s',
    (side) => {
      expect(mailLogoProblem({ ...LOGO, width: side })).not.toBeNull();
      expect(mailLogoProblem({ ...LOGO, height: side })).not.toBeNull();
    },
  );
});

describe('mailColoursProblem', () => {
  const colours = {
    page: '#ffffff',
    panel: '#ffffff',
    sunken: '#ffffff',
    border: '#ffffff',
    ink: '#000000',
    muted: '#000000',
    link: '#000000',
    button: '#000000',
    buttonInk: '#ffffff',
  };
  it('accepts lower-case #rrggbb only', () => {
    expect(mailColoursProblem(colours)).toBeNull();
    expect(mailColoursProblem({ ...colours, ink: '#ABCDEF' })).not.toBeNull();
    expect(mailColoursProblem({ ...colours, ink: 'red' })).not.toBeNull();
    expect(mailColoursProblem({ ...colours, ink: '#000;x:y' })).not.toBeNull();
  });
});
