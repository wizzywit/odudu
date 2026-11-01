import {
  DEFAULT_PAGE_LOCALE,
  PAGE_KINDS,
  type PageLocale,
  type RenderedPage,
  type ResolvedBranding,
} from '@odudu/kernel';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { renderPasskeyEnrolmentPage } from '#/view/passkey-enrolment-html';
import { renderRecoveryCodesPage } from '#/view/recovery-codes-html';
import { renderRequiredActionPage } from '#/view/required-action-html';
import { DEFAULT_TEMPLATES, type TemplatedKind } from '#/view/templates/index';
import { renderTotpEnrolmentPage } from '#/view/totp-enrolment-html';
import { renderUpdatePasswordPage } from '#/view/update-password-html';

function themed(kind: TemplatedKind, template: string): PageLocale {
  const branding: ResolvedBranding = {
    origin: 'https://id.test',
    templates: { [kind]: template },
    tokensCss: '',
    stylesheetUrl: null,
    faviconUrl: null,
    logo: null,
    assetUrls: [],
  };
  return { ...DEFAULT_PAGE_LOCALE, branding };
}

const slots = (names: readonly string[]): string => names.map((name) => `{{${name}}}`).join('');

// A random nonce is the only part of a body that differs between two renders.
const stable = (page: RenderedPage): string => page.body.replace(/nonce="[^"]+"/gu, 'nonce="N"');

const RULES = {
  minLength: 12,
  requireDigit: true,
  requireUppercase: false,
  requireLowercase: false,
  requireSpecial: false,
};
const OFFER = {
  secret: 'GEZDGNBVGY3TQOJQ',
  uri: 'otpauth://totp/acme:ada?secret=GEZDGNBVGY3TQOJQ',
};
const PASSKEY = {
  options: {
    rp: { name: 'acme', id: 'id.example.com' },
    user: { id: 'c3ViamVjdA', name: 'ada', displayName: 'ada' },
    challenge: 'Q0hBTExFTkdF',
    pubKeyCredParams: [{ type: 'public-key' as const, alg: -7 }],
  },
};
const SIGN_IN = '/tenants/t1/protocol/openid-connect/auth?client_id=a';

interface Case {
  name: string;
  kind: TemplatedKind;
  render: (locale: PageLocale) => RenderedPage;
  // A template that places the parts in an order of its own, and what each
  // of them leaves in the markup, in the order the template asks for.
  template: string;
  inOrder: string[];
  // The inputs the form posts that the server, not a template, writes.
  hidden: string[];
}

const CASES: Case[] = [
  {
    name: 'TOTP enrolment',
    kind: 'totp-enrolment',
    render: (locale) => renderTotpEnrolmentPage('t1', 'sess-1', OFFER, 'code_mismatch', locale),
    template:
      '{{error}}{{form.open}}{{submit}}{{fields}}{{form.close}}<div>{{offer}}</div><p>{{intro}}</p>',
    inOrder: [
      'role="alert"',
      '<form',
      '<button',
      'name="code"',
      '</form>',
      '<svg',
      'class="intro"',
    ],
    hidden: ['auth_session_id', 'secret'],
  },
  {
    name: 'passkey enrolment',
    kind: 'passkey-enrolment',
    render: (locale) =>
      renderPasskeyEnrolmentPage('t1', 'sess-1', PASSKEY, 'passkey_not_added', locale),
    template: '{{script}}{{error}}{{form.open}}{{submit}}{{fields}}{{form.close}}{{intro}}',
    inOrder: [
      'id="passkey-error"',
      'role="alert"',
      '<form',
      '<button',
      'name="label"',
      '</form>',
      'class="intro"',
    ],
    hidden: ['auth_session_id', 'credential'],
  },
  {
    name: 'recovery codes',
    kind: 'recovery-codes',
    render: (locale) =>
      renderRecoveryCodesPage(
        't1',
        'sess-1',
        { codes: ['aaaa-bbbb'], replaced: true },
        'codes_not_saved',
        locale,
      ),
    template:
      '{{form.open}}{{submit}}{{form.close}}{{codes}}{{notice}}{{instructions}}{{error}}{{intro}}',
    inOrder: [
      '<form',
      '<button',
      '</form>',
      '<ol>',
      'replace the codes',
      'only time',
      'role="alert"',
      'class="intro"',
    ],
    hidden: ['auth_session_id'],
  },
  {
    name: 'update password',
    kind: 'update-password',
    render: (locale) =>
      renderUpdatePasswordPage(
        't1',
        'sess-1',
        [{ rule: 'require-digit', message: 'needs a digit' }],
        RULES,
        locale,
      ),
    template: '{{error}}{{form.open}}{{submit}}{{fields}}{{form.close}}{{intro}}',
    inOrder: ['role="alert"', '<form', '<button', 'name="password"', '</form>', 'class="intro"'],
    hidden: ['auth_session_id'],
  },
  {
    name: 'required action',
    kind: 'required-action',
    render: (locale) => renderRequiredActionPage('configure-passkey', SIGN_IN, locale),
    template: '<div>{{message}}</div><p>end</p>',
    inOrder: ['<div><h1>', '</div>'],
    hidden: [],
  },
];

const indexesIn = (html: string, markers: readonly string[]): number[] =>
  markers.map((marker) => html.indexOf(marker));

describe.each(CASES)('the $name page', ({ kind, render, template, inOrder, hidden }) => {
  const manifest = PAGE_KINDS[kind];

  it('renders a theme template with its parts in the theme’s own order', () => {
    const body = render(themed(kind, template)).body;
    const at = indexesIn(body, inOrder);
    expect(
      at.every((index) => index >= 0),
      body,
    ).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it('renders a template of the required parts alone without throwing', () => {
    const page = render(themed(kind, slots(manifest.required)));
    expect(page.body).not.toContain('{{');
  });

  it('supplies every part the manifest lists, so a template may place any of them', () => {
    const own = slots([...manifest.required, ...manifest.optional]);
    expect(render(themed(kind, own)).body).not.toContain('{{');
  });

  it('keeps every hidden input inside form.open, whatever the template holds', () => {
    if (hidden.length === 0) return;
    const body = render(themed(kind, slots(['form.open', 'form.close']))).body;
    for (const name of hidden) {
      expect(body.match(new RegExp(`type="hidden" name="${name}"`, 'gu')), name).toHaveLength(1);
    }
    const opening = body.indexOf('<form');
    const closing = body.indexOf('</form>');
    expect(body.slice(opening, closing)).toContain('type="hidden"');
  });

  it('falls back to the default when the theme’s template names an unknown part', () => {
    const own = themed(kind, `${slots(manifest.required)}{{nonesuch}}`);
    expect(stable(render(own))).toBe(stable(render(DEFAULT_PAGE_LOCALE)));
  });

  it('falls back to the default when the theme’s template names an unknown message', () => {
    const own = themed(kind, `${slots(manifest.required)}{{t "no.such.key"}}`);
    expect(stable(render(own))).toBe(stable(render(DEFAULT_PAGE_LOCALE)));
  });

  it('renders a template that leaves the optional parts out', () => {
    const page = render(themed(kind, slots(manifest.required)));
    expect(page.body).not.toContain('class="intro"');
  });
});

describe.each(Object.keys(DEFAULT_TEMPLATES) as TemplatedKind[])(
  'the default template of %s',
  (kind) => {
    it('writes no input, form, script or button of its own', () => {
      expect(DEFAULT_TEMPLATES[kind]).not.toMatch(/<(?:input|form|script|button|iframe)/u);
    });
  },
);

describe('the required action page', () => {
  it('shows its way on to a template of the message alone', () => {
    const own = themed('required-action', '{{message}}');
    expect(renderRequiredActionPage('update-password', SIGN_IN, own).body).toContain(SIGN_IN);
  });
});

describe('the recovery codes page', () => {
  const render = (template: string, replaced = true): RenderedPage =>
    renderRecoveryCodesPage(
      't1',
      's',
      { codes: ['aaaa-bbbb', 'cccc-dddd'], replaced },
      undefined,
      themed('recovery-codes', template),
    );
  const required = slots(PAGE_KINDS['recovery-codes'].required);

  it('shows the codes, and that they are shown once, to any template that is valid', () => {
    const body = render(required).body;
    expect(body).toContain('aaaa-bbbb');
    expect(body).toContain('cccc-dddd');
    expect(body).toContain('only time');
  });

  it('says the set replaces an earlier one, once, when it does', () => {
    const body = render(required, true).body;
    expect(body.split('These replace the codes issued to this account')).toHaveLength(2);
  });

  it('places the replaced notice empty when the set replaces nothing', () => {
    expect(render(required, false).body).not.toContain('replace the codes');
  });
});

describe('the passkey page script', () => {
  const required = PAGE_KINDS['passkey-enrolment'].required;
  const render = (template: string): RenderedPage =>
    renderPasskeyEnrolmentPage(
      't1',
      's',
      PASSKEY,
      undefined,
      themed('passkey-enrolment', template),
    );

  it('the nonce survives a themed passkey page', () => {
    for (const template of [
      slots(required),
      slots(['script', ...required.filter((name) => name !== 'script')]),
      '{{form.open}}{{script}}{{fields}}{{submit}}{{error}}{{form.close}}',
    ]) {
      const page = render(template);
      const nonce = page.script?.nonce ?? '';
      expect(nonce).not.toBe('');
      expect(page.html.split(nonce)).toHaveLength(2);
      expect(page.html).toContain(`<script nonce="${nonce}">`);
    }
  });

  it('keeps the element it reports into with the script, wherever a theme places it', () => {
    const scriptFirst = slots(['script', ...required.filter((name) => name !== 'script')]);
    for (const template of [slots(required), scriptFirst]) {
      const body = render(template).body;
      expect(body.indexOf('id="passkey-error"')).toBeGreaterThanOrEqual(0);
      expect(body.indexOf('id="passkey-error"')).toBeLessThan(body.indexOf('<script'));
      expect(body).toContain('<noscript>');
    }
  });

  // A stand-in document: the elements exist only once parsing has finished,
  // as they do for a script placed before the form.
  function run(body: string): { reads: string[]; listeners: string[] } {
    const code = /<script nonce="[^"]*">([\s\S]*?)<\/script>/u.exec(body)?.[1] ?? '';
    const reads: string[] = [];
    const listeners: string[] = [];
    let parsed = false;
    const form = { addEventListener: (type: string) => listeners.push(type), dataset: {} };
    const elements: Record<string, unknown> = {
      'passkey-form': form,
      'passkey-credential': { value: '' },
      'passkey-error': { hidden: true },
    };
    const started: (() => void)[] = [];
    runInNewContext(code, {
      document: {
        readyState: 'loading',
        addEventListener: (_: string, handler: () => void) => started.push(handler),
        getElementById: (id: string) => {
          reads.push(id);
          if (!parsed) throw new Error(`read ${id} before the document was parsed`);
          return elements[id];
        },
      },
      atob,
      Uint8Array,
    });
    parsed = true;
    for (const handler of started) handler();
    return { reads, listeners };
  }

  it('reads nothing before the document is parsed, so its position does not matter', () => {
    for (const template of [
      slots(required),
      slots(['script', ...required.filter((name) => name !== 'script')]),
    ]) {
      const { reads, listeners } = run(render(template).body);
      expect(reads).toEqual(['passkey-form', 'passkey-credential', 'passkey-error']);
      expect(listeners).toEqual(['submit']);
    }
  });
});

describe('the password script', () => {
  const render = (template: string): RenderedPage =>
    renderUpdatePasswordPage('t1', 's', [], RULES, themed('update-password', template));
  const names = ['form.open', 'submit', 'error', 'form.close'];

  it('travels with the fields it reads, wherever a theme places them', () => {
    for (const template of [slots(['fields', ...names]), slots([...names, 'fields'])]) {
      const body = render(template).body;
      const scripts = [...body.matchAll(/<script nonce="/gu)];
      expect(scripts).toHaveLength(1);
      for (const id of ['id="password-rules"', 'id="password"']) {
        expect(body.indexOf(id), id).toBeGreaterThanOrEqual(0);
        expect(body.indexOf(id), id).toBeLessThan(scripts[0]?.index ?? 0);
      }
    }
  });

  it('carries the nonce the page returns', () => {
    const page = render(DEFAULT_TEMPLATES['update-password']);
    const nonce = page.script?.nonce ?? '';
    expect(nonce).not.toBe('');
    expect(page.html.split(`nonce="${nonce}"`)).toHaveLength(2);
  });
});

describe('a theme template that cannot be filled', () => {
  const told: [string, string][] = [];
  const spy = (kind: string, reason: string): number => told.push([kind, reason]);

  it('is reported with its kind and reason, and the default template is rendered', () => {
    told.length = 0;
    const locale = { ...themed('totp-enrolment', '{{nonesuch}}'), templateFallback: spy };
    expect(renderTotpEnrolmentPage('t1', 's', OFFER, undefined, locale).body).toBe(
      renderTotpEnrolmentPage('t1', 's', OFFER, undefined, DEFAULT_PAGE_LOCALE).body,
    );
    expect(told).toEqual([['totp-enrolment', 'unknown slot nonesuch']]);
  });

  it('is reported for an unknown message key, which saving does not check', () => {
    told.length = 0;
    const own = `${slots(PAGE_KINDS['required-action'].required)}{{t "no.such.key"}}`;
    const locale = { ...themed('required-action', own), templateFallback: spy };
    renderRequiredActionPage('update-password', null, locale);
    expect(told).toEqual([['required-action', 'unknown message no.such.key']]);
  });

  it('is not reported when it fills', () => {
    told.length = 0;
    const locale = { ...themed('required-action', '{{message}}'), templateFallback: spy };
    renderRequiredActionPage('update-password', null, locale);
    expect(told).toEqual([]);
  });
});
