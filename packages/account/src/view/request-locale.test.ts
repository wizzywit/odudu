import { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { brandedLocale, type LocaleTenant } from '#/view/request-locale';

const request = (acceptLanguage?: string): FastifyRequest =>
  ({
    headers: acceptLanguage === undefined ? {} : { 'accept-language': acceptLanguage },
  }) as unknown as FastifyRequest;

const tenant = (overrides: Partial<LocaleTenant> = {}): LocaleTenant => ({
  id: 't1',
  name: 'acme',
  supportedLocales: ['en', 'fr', 'ar'],
  defaultLocale: null,
  ...overrides,
});

describe('the language an account page is shown in', () => {
  it('is the browser’s choice among the tenant’s languages', async () => {
    const locale = await brandedLocale(request('ar, fr;q=0.5'), {}, tenant());
    expect(locale).toMatchObject({ tag: 'ar', dir: 'rtl' });
  });

  it('offers only what the tenant lists', async () => {
    const locale = await brandedLocale(request('fr'), {}, tenant({ supportedLocales: ['en'] }));
    expect(locale.tag).toBe('en');
  });

  it('is the tenant’s default ahead of the browser’s preference', async () => {
    const locale = await brandedLocale(request('ar'), {}, tenant({ defaultLocale: 'fr' }));
    expect(locale.tag).toBe('fr');
  });

  it('is the shipped English for a page with no tenant', async () => {
    expect((await brandedLocale(request('fr'), {}, null)).tag).toBe('en');
  });
});

describe('the tenant’s own wording on an account page', () => {
  it('rides on the locale, for the tag negotiated', async () => {
    const resolveOverrides = vi.fn(() => Promise.resolve({ 'link.backToSignIn': 'Retour' }));
    const locale = await brandedLocale(request('fr'), { resolveOverrides }, tenant());
    expect(resolveOverrides).toHaveBeenCalledWith('t1', 'fr');
    expect(locale.overrides).toEqual({ 'link.backToSignIn': 'Retour' });
  });

  it('is not asked for without a tenant', async () => {
    const resolveOverrides = vi.fn(() => Promise.resolve({ a: 'b' }));
    const locale = await brandedLocale(request('fr'), { resolveOverrides }, null);
    expect(resolveOverrides).not.toHaveBeenCalled();
    expect(locale.overrides).toBeUndefined();
  });
});
