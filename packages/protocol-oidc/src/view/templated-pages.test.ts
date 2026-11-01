import {
  DEFAULT_PAGE_LOCALE,
  PAGE_KINDS,
  type PageLocale,
  type RenderedPage,
  type ResolvedBranding,
} from '@odudu/kernel';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  renderAuthorizeErrorPage,
  renderEmailUnverifiedPage,
  renderLoginForm,
} from '#/view/authorize-html';
import { renderConsentPage } from '#/view/consent-html';
import {
  renderLoggedOutPage,
  renderLoggedOutRedirectPage,
  renderLogoutConfirmationPage,
  renderNoActiveSessionPage,
} from '#/view/logout-html';
import { en } from '#/view/messages';
import { renderSelectAccountPage } from '#/view/select-account-html';
import { DEFAULT_TEMPLATES, type TemplatedKind } from '#/view/templates/index';

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

interface Case {
  kind: TemplatedKind;
  render: (locale: PageLocale) => RenderedPage;
  // A template that places the parts in an order of its own, and what each
  // of them leaves in the markup, in the order the template asks for.
  template: string;
  inOrder: string[];
  // The inputs the form posts that the server, not a template, writes.
  hidden: string[];
}

const NO_WAYS = { resetPassword: '/reset', createAccount: '/register' };

const CASES: Case[] = [
  {
    kind: 'sign-in',
    render: (locale) =>
      renderLoginForm(
        't1',
        'sess-1',
        'password',
        false,
        false,
        { messageId: 'login.refusal.signInFailed' },
        false,
        'App',
        NO_WAYS,
        locale,
      ),
    template:
      '<div>{{links}}</div>{{error}}{{form.open}}{{fields}}{{submit}}{{form.close}}<p>{{intro}}</p>',
    inOrder: [
      'class="links"',
      'role="alert"',
      '<form',
      'name="username"',
      '<button',
      '</form>',
      'class="intro"',
    ],
    hidden: ['auth_session_id'],
  },
  {
    kind: 'consent',
    render: (locale) =>
      renderConsentPage(
        {
          tenant: 't1',
          authSessionId: 'sess-1',
          clientName: 'App',
          clientPages: { clientUri: 'https://rp.test/', policyUri: null, tosUri: null },
          defaultScopes: ['openid'],
          optionalScopes: ['email'],
          alreadyGranted: [],
          scopeLabels: {},
        },
        locale,
      ),
    template:
      '{{form.open}}{{scopes}}{{submit.deny}}{{submit.allow}}{{form.close}}{{links}}{{client}}',
    inOrder: [
      '<form',
      '<ul>',
      'value="deny"',
      'value="allow"',
      '</form>',
      'rp.test',
      'class="intro"',
    ],
    hidden: ['auth_session_id'],
  },
  {
    kind: 'select-account',
    render: (locale) =>
      renderSelectAccountPage(
        {
          tenant: 't1',
          authSessionId: 'sess-1',
          accounts: [{ sessionId: 's1', displayName: 'alice' }],
        },
        locale,
      ),
    template: '{{intro}}{{form.open}}{{submit.other}}{{accounts}}{{form.close}}',
    inOrder: ['class="intro"', '<form', 'name="use_other"', 'name="session_id"', '</form>'],
    hidden: ['auth_session_id'],
  },
  {
    kind: 'logout-confirm',
    render: (locale) =>
      renderLogoutConfirmationPage(
        't1',
        'sid',
        'csrf-value',
        { clientId: 'c1', postLogoutRedirectUri: 'https://rp.test/', state: 'st' },
        locale,
      ),
    template: `<div>{{form.open}}{{submit}}{{form.close}}</div><h2>{{t "logout.confirm.title"}}</h2>`,
    inOrder: ['<form', '<button', '</form>', '<h2>'],
    hidden: ['session_id', 'csrf', 'client_id', 'post_logout_redirect_uri', 'state'],
  },
  {
    kind: 'authorize-error',
    render: (locale) =>
      renderAuthorizeErrorPage(
        'invalid_request',
        'Bad.',
        { kind: 'restart', href: '/authorize' },
        locale,
      ),
    template: '{{code}}{{links}}{{message}}',
    inOrder: ['<small>', '<a href', '<h1>'],
    hidden: [],
  },
  {
    kind: 'email-unverified',
    render: (locale) => renderEmailUnverifiedPage(true, '/authorize', locale),
    template: '{{links}}{{message}}',
    inOrder: ['<a href', '<h1>'],
    hidden: [],
  },
  {
    kind: 'logged-out',
    render: (locale) => renderLoggedOutPage(['https://rp.test/fc'], locale),
    template: '{{frames}}{{message}}',
    inOrder: ['<iframe', '<h1>'],
    hidden: [],
  },
];

function indexesIn(html: string, markers: readonly string[]): number[] {
  return markers.map((marker) => html.indexOf(marker));
}

describe.each(CASES)('the $kind page', ({ kind, render, template, inOrder, hidden }) => {
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
    const own = slots(manifest.required);
    const page = render(themed(kind, own));
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

  it('writes no input, form or script of its own into the default template', () => {
    expect(DEFAULT_TEMPLATES[kind]).not.toMatch(/<(?:input|form|script|button|iframe)/u);
  });

  it('falls back to the default when the theme’s template names an unknown part', () => {
    const own = themed(kind, `${slots(manifest.required)}{{nonesuch}}`);
    expect(render(own).body).toBe(render(DEFAULT_PAGE_LOCALE).body);
  });

  it('falls back to the default when the theme’s template names an unknown message', () => {
    const own = themed(kind, `${slots(manifest.required)}{{t "no.such.key"}}`);
    expect(render(own).body).toBe(render(DEFAULT_PAGE_LOCALE).body);
  });
});

describe('a theme template that cannot be filled', () => {
  const told: [string, string][] = [];
  const spy = (kind: string, reason: string): number => told.push([kind, reason]);

  it('is reported with its kind and reason, and the default template is rendered', () => {
    told.length = 0;
    const locale = { ...themed('select-account', '{{nonesuch}}'), templateFallback: spy };
    const input = { tenant: 't1', authSessionId: 's', accounts: [] };
    expect(renderSelectAccountPage(input, locale).body).toBe(
      renderSelectAccountPage(input, DEFAULT_PAGE_LOCALE).body,
    );
    expect(told).toEqual([['select-account', 'unknown slot nonesuch']]);
  });

  it('is reported for an unknown message key, which saving does not check', () => {
    told.length = 0;
    const own = '{{form.open}}{{t "no.such.key"}}{{form.close}}';
    const locale = { ...themed('logout-confirm', own), templateFallback: spy };
    renderLogoutConfirmationPage(
      't1',
      'sid',
      'c',
      { clientId: null, postLogoutRedirectUri: null, state: null },
      locale,
    );
    expect(told).toEqual([['logout-confirm', 'unknown message no.such.key']]);
  });

  it('is not reported when it fills', () => {
    told.length = 0;
    const locale = { ...themed('email-unverified', '{{message}}'), templateFallback: spy };
    renderEmailUnverifiedPage(true, null, locale);
    expect(told).toEqual([]);
  });
});

describe('the logged-out pages', () => {
  it('keeps the redirecting page’s nonce, once, in the script part', () => {
    const locale = themed('logged-out', '<div>{{script}}</div>{{message}}');
    const page = renderLoggedOutRedirectPage(['https://rp.test/fc'], 'https://rp.test/', locale);
    const nonce = page.script?.nonce ?? '';
    expect(nonce).not.toBe('');
    expect(page.body.split(`nonce="${nonce}"`)).toHaveLength(2);
    expect(page.body.indexOf('<script')).toBeLessThan(page.body.indexOf('<h1>'));
  });

  it('fills a page that never frames anything with empty frames and script', () => {
    const locale = themed('logged-out', '{{message}}[{{frames}}][{{script}}]');
    expect(renderNoActiveSessionPage(locale).body).toContain('[][]');
  });

  it('reads a theme’s own wording from the catalogue', () => {
    const locale = themed('logged-out', `<h2>{{t "logout.done.title"}}</h2>{{message}}`);
    const page = renderLoggedOutPage([], locale);
    expect(page.body).toContain(`<h2>${en['logout.done.title']}</h2>`);
  });
});

// The page's own script, run against a stand-in document whose elements
// arrive after the script has run, as they do when a theme places `script`
// first.
function runRedirectScript(html: string, whenScriptRuns: 'before' | 'after'): string[] {
  const script = /<script nonce="[^"]*">([\s\S]*?)<\/script>/u.exec(html)?.[1] ?? '';
  const left: string[] = [];
  const listeners: Record<string, (() => void)[]> = {};
  const frameLoads: (() => void)[] = [];
  const state = { ready: whenScriptRuns === 'after', elements: false };
  const frame = {
    dataset: {} as Record<string, string>,
    addEventListener: (_: string, listener: () => void) => frameLoads.push(listener),
  };
  const document = {
    get readyState(): string {
      return state.ready ? 'interactive' : 'loading';
    },
    addEventListener: (name: string, listener: () => void) =>
      (listeners[name] ??= []).push(listener),
    getElementById: (id: string) =>
      state.elements && id === 'continue' ? { href: 'https://rp.test/' } : null,
    querySelectorAll: () => (state.elements ? [frame] : []),
  };
  state.elements = whenScriptRuns === 'after';
  runInNewContext(script, {
    document,
    location: { replace: (to: string) => left.push(to) },
    setTimeout: () => 0,
  });
  state.elements = true;
  state.ready = true;
  for (const listener of listeners.DOMContentLoaded ?? []) listener();
  for (const listener of frameLoads) listener();
  return left;
}

describe('the redirecting page’s script', () => {
  const render = (template: string): RenderedPage =>
    renderLoggedOutRedirectPage(
      ['https://rp.test/fc'],
      'https://rp.test/',
      themed('logged-out', template),
    );

  it('finds the continue link and the frames wherever the theme places it', () => {
    const first = render('{{script}}{{message}}{{frames}}').html;
    expect(runRedirectScript(first, 'before')).toEqual(['https://rp.test/']);
    const last = render('{{message}}{{frames}}{{script}}').html;
    expect(runRedirectScript(last, 'after')).toEqual(['https://rp.test/']);
  });
});
