import type { ThemeView } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import { sourceReading } from '#/features/branding/service';
import { draftedView, themeView } from '#/testing/brandingFixtures';

describe('sourceReading', () => {
  it('names the draft’s layer beside the published one, per piece', () => {
    const view = draftedView() as ThemeView;
    expect(sourceReading({ kind: 'tenant' }, view, 'assets.logo')).toBe(
      'Draft: this tenant · Published: Instrument’s default',
    );
  });

  it('says only what is published when there is no draft, and defaults a piece nobody sets', () => {
    expect(sourceReading({ kind: 'tenant' }, themeView() as ThemeView, 'tokens.font')).toBe(
      'Published: Instrument’s default',
    );
  });

  it('speaks of the tenant as the layer below at a client’s scope', () => {
    const view = themeView({ sources: { 'tokens.light': 'tenant' } }) as ThemeView;
    expect(sourceReading({ kind: 'client', id: 'c' }, view, 'tokens.light')).toBe(
      'Published: the tenant',
    );
  });
});

describe('what a client piece hides', () => {
  const below = {
    'tokens.light': 'tenant',
    'assets.logo': 'tenant',
    'templates.sign-in': 'default',
  } as const;
  const client = { kind: 'client' as const, id: 'c', below };

  it('a client override shows the tenant piece it hides', () => {
    const view = themeView({
      scope: 'client',
      sources: { 'tokens.light': 'client' },
      draft_sources: { 'tokens.light': 'client' },
    }) as ThemeView;
    expect(sourceReading(client, view, 'tokens.light')).toBe(
      'Draft: this client · Published: this client · Hides the tenant’s light colours',
    );
  });

  it('names an image or a page template by what it is', () => {
    const view = themeView({
      scope: 'client',
      sources: { 'assets.logo': 'client', 'templates.sign-in': 'client' },
    }) as ThemeView;
    expect(sourceReading(client, view, 'assets.logo')).toBe(
      'Published: this client · Hides the tenant’s logo',
    );
    expect(sourceReading(client, view, 'templates.sign-in')).toBe(
      'Published: this client · Replaces Instrument’s default sign in page template',
    );
  });

  it('says a draft that sets a piece will hide the tenant’s once published', () => {
    const view = themeView({
      scope: 'client',
      sources: { 'tokens.light': 'tenant' },
      draft_sources: { 'tokens.light': 'client' },
    }) as ThemeView;
    expect(sourceReading(client, view, 'tokens.light')).toBe(
      'Draft: this client · Published: the tenant · The draft hides the tenant’s light colours once published',
    );
  });

  it('says nothing of a piece the client does not set', () => {
    const view = themeView({ scope: 'client', sources: { 'tokens.light': 'tenant' } }) as ThemeView;
    expect(sourceReading(client, view, 'tokens.light')).toBe('Published: the tenant');
  });

  it('says nothing more when the tenant’s theme is not known, or at the tenant’s own scope', () => {
    const view = themeView({ scope: 'client', sources: { 'tokens.light': 'client' } }) as ThemeView;
    expect(sourceReading({ kind: 'client', id: 'c' }, view, 'tokens.light')).toBe(
      'Published: this client',
    );
    expect(sourceReading({ kind: 'tenant' }, view, 'tokens.light')).toBe('Published: this client');
  });
});
