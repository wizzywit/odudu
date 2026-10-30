import { describe, expect, it, vi } from 'vitest';
import {
  brandLocale,
  clientFromReturnTo,
  type BrandingResolver,
  type OverridesResolver,
} from '#/branding-resolver';
import { DEFAULT_PAGE_LOCALE, type ResolvedBranding } from '#/page';

const BRANDING: ResolvedBranding = {
  origin: 'https://id.example.test',
  templates: {},
  tokensCss: '',
  stylesheetUrl: null,
  faviconUrl: null,
  logo: null,
  assetUrls: [],
};
const SCOPE = { tenantId: 't1', tenantName: 'acme', clientId: null };

describe('brandLocale', () => {
  it('leaves the locale alone with no resolver or no scope', async () => {
    const resolve = vi.fn<BrandingResolver>();
    expect(await brandLocale(DEFAULT_PAGE_LOCALE, undefined, SCOPE)).toBe(DEFAULT_PAGE_LOCALE);
    expect(await brandLocale(DEFAULT_PAGE_LOCALE, resolve, null)).toBe(DEFAULT_PAGE_LOCALE);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('leaves the locale alone when the tenant has no theme', async () => {
    const locale = await brandLocale(DEFAULT_PAGE_LOCALE, () => Promise.resolve(null), SCOPE);
    expect(locale).toBe(DEFAULT_PAGE_LOCALE);
  });

  it('attaches the branding and the fallback hook', async () => {
    const templateFallback = vi.fn();
    const locale = await brandLocale(
      { ...DEFAULT_PAGE_LOCALE, theme: 'dark' },
      () => Promise.resolve({ branding: BRANDING, templateFallback, mail: null }),
      SCOPE,
    );
    expect(locale.branding).toBe(BRANDING);
    expect(locale.theme).toBe('dark');
    locale.templateFallback?.('sign-in', 'why');
    expect(templateFallback).toHaveBeenCalledWith('sign-in', 'why');
  });
});

describe('brandLocale with a tenant’s message overrides', () => {
  it('attaches the overrides for the negotiated tag, beside the branding', async () => {
    const overrides = vi.fn<OverridesResolver>(() => Promise.resolve({ 'login.title': 'Hi' }));
    const locale = await brandLocale(
      { tag: 'fr', dir: 'ltr' },
      () => Promise.resolve({ branding: BRANDING, templateFallback: vi.fn(), mail: null }),
      SCOPE,
      overrides,
    );
    expect(overrides).toHaveBeenCalledWith('t1', 'fr');
    expect(locale.overrides).toEqual({ 'login.title': 'Hi' });
    expect(locale.branding).toBe(BRANDING);
  });

  it('attaches them with no theme, and leaves the locale alone when there are none', async () => {
    const some = await brandLocale(DEFAULT_PAGE_LOCALE, undefined, SCOPE, () =>
      Promise.resolve({ a: 'b' }),
    );
    expect(some.overrides).toEqual({ a: 'b' });
    const none = await brandLocale(DEFAULT_PAGE_LOCALE, undefined, SCOPE, () =>
      Promise.resolve({}),
    );
    expect(none).toBe(DEFAULT_PAGE_LOCALE);
  });

  it('asks for nothing without a tenant, and survives a resolver that rejects', async () => {
    const overrides = vi.fn<OverridesResolver>(() => Promise.resolve({ a: 'b' }));
    expect(await brandLocale(DEFAULT_PAGE_LOCALE, undefined, null, overrides)).toBe(
      DEFAULT_PAGE_LOCALE,
    );
    expect(overrides).not.toHaveBeenCalled();
    const broken = await brandLocale(DEFAULT_PAGE_LOCALE, undefined, SCOPE, () =>
      Promise.reject(new Error('down')),
    );
    expect(broken).toBe(DEFAULT_PAGE_LOCALE);
  });

  it('keeps the overrides when a theme without branding is applied afterwards', async () => {
    const locale = await brandLocale(
      DEFAULT_PAGE_LOCALE,
      () => Promise.resolve(null),
      SCOPE,
      () => Promise.resolve({ a: 'b' }),
    );
    expect(locale.overrides).toEqual({ a: 'b' });
  });
});

describe('clientFromReturnTo', () => {
  const path = (query: string, tenant = 'acme'): string =>
    `/tenants/${tenant}/protocol/openid-connect/auth?${query}`;
  const known = (id: string): Promise<boolean> => Promise.resolve(id === 'web');

  it('names the registered client the authorize path carries', async () => {
    expect(await clientFromReturnTo('acme', path('response_type=code&client_id=web'), known)).toBe(
      'web',
    );
  });

  it('is null for an unregistered or foreign client, without saying which', async () => {
    expect(await clientFromReturnTo('acme', path('client_id=other'), known)).toBeNull();
    expect(await clientFromReturnTo('acme', path('client_id=web', 'rival'), known)).toBeNull();
  });

  it.each([
    ['no return_to', null],
    ['a foreign address', 'https://evil.example/?client_id=web'],
    ['no client_id', path('response_type=code')],
    ['a repeated client_id', path('client_id=web&client_id=web')],
    ['an empty client_id', path('client_id=')],
    ['an oversized client_id', path(`client_id=${'a'.repeat(300)}`)],
  ])('is null for %s without asking the registry', async (_name, value) => {
    const asked = vi.fn(known);
    expect(await clientFromReturnTo('acme', value, asked)).toBeNull();
    expect(asked).not.toHaveBeenCalled();
  });

  it('is null when the registry cannot be read', async () => {
    const failing = (): Promise<boolean> => Promise.reject(new Error('down'));
    expect(await clientFromReturnTo('acme', path('client_id=web'), failing)).toBeNull();
  });
});
