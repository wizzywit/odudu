import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PAGE_LOCALE, type PageLocale, type ResolvedBranding } from '#/page';
import { createPageFiller, fillPageTemplate } from '#/page-template';

const text = (key: string): string => {
  if (key !== 'a.b') throw new Error(`unknown message ${key}`);
  return 'Hello';
};

function withTemplate(template: string, fallback?: PageLocale['templateFallback']): PageLocale {
  const branding: ResolvedBranding = {
    origin: 'https://id.example.com',
    templates: { 'logout-confirm': template },
    tokensCss: '',
    stylesheetUrl: null,
    faviconUrl: null,
    logo: null,
    assetUrls: [],
  };
  return fallback === undefined
    ? { ...DEFAULT_PAGE_LOCALE, branding }
    : { ...DEFAULT_PAGE_LOCALE, branding, templateFallback: fallback };
}

const PARTS = { submit: '<button>Go</button>' };
const DEFAULT = '<p>{{t "a.b"}}</p>{{submit}}';

describe('fillPageTemplate', () => {
  it('fills the default when the locale has no template', () => {
    expect(fillPageTemplate('logout-confirm', DEFAULT, PARTS, DEFAULT_PAGE_LOCALE, text)).toBe(
      '<p>Hello</p><button>Go</button>',
    );
  });

  it("fills the locale's own template in its own order", () => {
    const locale = withTemplate('{{submit}}<i>{{t "a.b"}}</i>');
    expect(fillPageTemplate('logout-confirm', DEFAULT, PARTS, locale, text)).toBe(
      '<button>Go</button><i>Hello</i>',
    );
  });

  it('falls back to the default and says why when the template names an unknown part', () => {
    const told = vi.fn();
    const locale = withTemplate('{{nope}}', told);
    expect(fillPageTemplate('logout-confirm', DEFAULT, PARTS, locale, text)).toBe(
      '<p>Hello</p><button>Go</button>',
    );
    expect(told).toHaveBeenCalledWith('logout-confirm', 'unknown slot nope');
  });

  it('falls back when the template names a catalogue key that is not there', () => {
    const told = vi.fn();
    const locale = withTemplate('{{t "gone"}}{{submit}}', told);
    expect(fillPageTemplate('logout-confirm', DEFAULT, PARTS, locale, text)).toContain('Hello');
    expect(told).toHaveBeenCalledWith('logout-confirm', 'unknown message gone');
  });

  it('falls back silently when nobody is listening', () => {
    const locale = withTemplate('{{nope}}');
    expect(fillPageTemplate('logout-confirm', DEFAULT, PARTS, locale, text)).toContain('Go');
  });
});

describe('createPageFiller', () => {
  const fill = createPageFiller({
    defaults: { 'logout-confirm': DEFAULT },
    hasMessage: (key) => key === 'a.b',
    text: () => 'Hello',
  });

  it('fills the default with the package catalogue', () => {
    expect(fill('logout-confirm', PARTS, DEFAULT_PAGE_LOCALE)).toBe(
      '<p>Hello</p><button>Go</button>',
    );
  });

  it('gives way to the default and says why for a key the catalogue lacks', () => {
    const told = vi.fn();
    const locale = withTemplate('{{t "gone"}}{{submit}}', told);
    expect(fill('logout-confirm', PARTS, locale)).toBe('<p>Hello</p><button>Go</button>');
    expect(told).toHaveBeenCalledWith('logout-confirm', 'unknown message gone');
  });
});
