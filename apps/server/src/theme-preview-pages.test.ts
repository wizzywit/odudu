import { PAGE_KINDS, withBranding, type PageKind, type ResolvedBranding } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { THEME_PREVIEW_PAGES } from '#/theme-preview-pages';

const KINDS = Object.keys(PAGE_KINDS) as PageKind[];

function brandingWith(kind: PageKind, template: string): ResolvedBranding {
  return {
    origin: 'https://idp.example',
    templates: { [kind]: template },
    tokensCss: '',
    stylesheetUrl: null,
    faviconUrl: null,
    logo: null,
    assetUrls: [],
  };
}

// Every part a kind lists as required, once, the form's tags around the ones
// that must sit inside it: the smallest template the kind accepts.
function smallestTemplate(kind: PageKind): string {
  const { required, inForm } = PAGE_KINDS[kind];
  const outside = required.filter((part) => !inForm.includes(part) && !part.startsWith('form.'));
  const inside = required.filter((part) => inForm.includes(part));
  const form = required.includes('form.open')
    ? `{{form.open}}${inside.map((part) => `{{${part}}}`).join('')}{{form.close}}`
    : '';
  return `<div data-preview="${kind}">${outside.map((part) => `{{${part}}}`).join('')}${form}</div>`;
}

describe('the preview pages', () => {
  it.each(KINDS)('has a sample for %s that its own renderer renders', (kind) => {
    const render = THEME_PREVIEW_PAGES[kind];
    const page = render('acme', { tag: 'en', dir: 'ltr' });
    expect(page.html).toContain('<main class="page">');
    expect(page.title).not.toBe('');
  });

  it.each(KINDS)('gives %s its page-<kind> hook when themed, and only then', (kind) => {
    const render = THEME_PREVIEW_PAGES[kind];
    const branding: ResolvedBranding = { ...brandingWith(kind, ''), templates: {} };
    const themed = render('acme', withBranding({ tag: 'en', dir: 'ltr' }, branding));
    expect(themed.html).toContain(`<main class="page page-${kind}">`);
    expect(themed.html.match(/<main /gu)).toHaveLength(1);
    const plain = render('acme', { tag: 'en', dir: 'ltr' });
    expect(plain.html).toContain('<main class="page">');
    expect(plain.html).not.toContain('page-');
  });

  it.each(KINDS)('gives a template-written %s the same main element', (kind) => {
    const locale = withBranding(
      { tag: 'en', dir: 'ltr' },
      brandingWith(kind, smallestTemplate(kind)),
    );
    const page = THEME_PREVIEW_PAGES[kind]('acme', locale);
    expect(page.html).toContain(`<div data-preview="${kind}">`);
    expect(page.html).toContain(`<main class="page page-${kind}">`);
  });

  it.each(KINDS)('supplies every required part of %s to a theme template', (kind) => {
    const fallbacks: string[] = [];
    const locale = withBranding(
      { tag: 'en', dir: 'ltr' },
      brandingWith(kind, smallestTemplate(kind)),
      (_kind, reason) => {
        fallbacks.push(reason);
      },
    );
    const page = THEME_PREVIEW_PAGES[kind]('acme', locale);
    expect(fallbacks).toEqual([]);
    expect(page.html).toContain(`<div data-preview="${kind}">`);
  });

  it('gives the one kind that needs a script its script', () => {
    const scripted = KINDS.filter((kind) => PAGE_KINDS[kind].required.includes('script'));
    expect(scripted.length).toBeGreaterThan(0);
    const page = THEME_PREVIEW_PAGES['passkey-enrolment']('acme', { tag: 'en', dir: 'ltr' });
    expect(page.script).not.toBeNull();
  });

  it('names the tenant it is previewed for in a form action', () => {
    const page = THEME_PREVIEW_PAGES['sign-in']('acme', { tag: 'en', dir: 'ltr' });
    expect(page.html).toContain('/tenants/acme/login-actions/authenticate');
  });
});
