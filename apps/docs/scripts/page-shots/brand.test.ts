import { readFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { DEFAULT_PAGE_LOCALE, withBranding } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../../../packages/domain-theme/src/service/branding-urls.ts';
import { contrastFailures } from '../../../../packages/domain-theme/src/service/contrast.ts';
import { renderLoginForm } from '../../../../packages/protocol-oidc/src/view/authorize-html.ts';
import { THEME_BODY, brandFiles, brandOutcome, png, storedZlib } from './brand.ts';

const tokens = readFileSync(
  path.resolve(import.meta.dirname, '../../../admin-console/src/shared/view/tokens.css'),
  'utf8',
);

describe('the tenant theme the landing page shows', () => {
  const outcome = brandOutcome();

  it('goes through the production path whole: nothing refused, nothing faulted', () => {
    expect(outcome.problems).toEqual([]);
    expect(outcome.faults).toEqual([]);
    expect(outcome.refused).toEqual([]);
    expect(outcome.used).toEqual(['tenant']);
    expect(outcome.branding).not.toBeNull();
  });

  it('sets colours for both schemes, a font, a logo for each, a background and a stylesheet', () => {
    expect(THEME_BODY.tokens.light).toBeDefined();
    expect(THEME_BODY.tokens.dark).toBeDefined();
    expect(THEME_BODY.tokens.font).toBeDefined();
    expect(THEME_BODY.assets.logo?.alt.length).toBeGreaterThan(0);
    expect(THEME_BODY.assets.darkLogo).toBeDefined();
    expect(THEME_BODY.assets.background).toBeDefined();
    expect(THEME_BODY.stylesheet).not.toBeNull();
    const branding = outcome.branding;
    expect(branding?.logo?.darkUrl).not.toBeNull();
    expect(branding?.stylesheetUrl).not.toBeNull();
    expect(branding?.assetUrls).toHaveLength(3);
    expect(outcome.css).toContain('background-image');
  });

  it('passes the contrast check a publish is held to', () => {
    expect(contrastFailures(THEME_BODY.tokens)).toEqual([]);
  });

  it('replaces only properties the stylesheet declares', () => {
    const set = [...outcome.css.matchAll(/(--[a-z-]+):/gu)].map((match) => match[1] ?? '');
    expect(set.length).toBeGreaterThan(10);
    for (const name of set) expect(tokens, name).toContain(`${name}:`);
  });

  it('serves every address the page names, and the stylesheet under its own hash', () => {
    const branding = outcome.branding;
    if (branding === null) throw new Error('no branding');
    const files = brandFiles();
    const named = [
      branding.stylesheetUrl,
      branding.logo?.url,
      branding.logo?.darkUrl,
      ...branding.assetUrls,
    ].filter((url): url is string => typeof url === 'string');
    for (const url of named) expect(files.has(url), url).toBe(true);
    const stylesheet = files.get(branding.stylesheetUrl ?? '');
    expect(stylesheet?.contentType).toBe('text/css');
    expect(sha256Hex(String(stylesheet?.body))).toBe(
      path.basename(branding.stylesheetUrl ?? '', '.css'),
    );
    for (const url of branding.assetUrls) {
      const image = files.get(url);
      expect(image?.contentType).toBe('image/png');
      const bytes = Buffer.from(image?.body ?? '');
      expect(bytes.subarray(1, 4).toString()).toBe('PNG');
      expect(sha256Hex(bytes)).toBe(path.basename(url, '.png'));
    }
  });

  it('shows in the page the real renderer returns: both logos and the stylesheet link', () => {
    const locale = withBranding(DEFAULT_PAGE_LOCALE, outcome.branding);
    const html = renderLoginForm(
      'acme',
      'a-session',
      'password',
      true,
      true,
      undefined,
      false,
      'Notes',
      { createAccount: '/create', resetPassword: '/reset' },
      locale,
    ).html;
    expect(html).toContain('class="logo logo-light"');
    expect(html).toContain('class="logo logo-dark"');
    expect(html).toContain(`href="${outcome.branding?.stylesheetUrl ?? ''}"`);
  });
});

describe('the images are drawn the same on every Node', () => {
  const small = {
    id: 'x',
    width: 3,
    height: 2,
    pixel: (x: number, y: number): [number, number, number, number] => [x * 80, y * 100, 7, 255],
  };

  it('writes a small image to a fixed, known byte sequence', () => {
    expect(sha256Hex(png(small))).toBe(
      'a8c886f0869e7f0f3759f1d1bfc2eca090b76bb45793f547eace959b6a5c2f45',
    );
  });

  it('writes a zlib stream that inflates to the raw data, in one block or several', () => {
    const raw = Buffer.from(Array.from({ length: 150_000 }, (_, i) => (i * 31) % 251));
    expect(inflateSync(storedZlib(raw)).equals(raw)).toBe(true);
    expect(inflateSync(storedZlib(Buffer.alloc(0))).length).toBe(0);
    const rows = Buffer.concat(
      [0, 1].map((y) =>
        Buffer.concat([Buffer.from([0]), ...[0, 1, 2].map((x) => Buffer.from(small.pixel(x, y)))]),
      ),
    );
    const idat = png(small).toString('latin1');
    expect(idat).toContain(storedZlib(rows).toString('latin1'));
  });
});
