import { describe, expect, it } from 'vitest';
import { logoViews, LOGO_ELSEWHERE } from '#/pages/branding/services/mailLogos';
import { mailBranding } from '#/testing/brandingFixtures';

const ORIGIN = 'http://console.test';

describe('the logos', () => {
  it('are drawn only from the console’s own address, which is all its policy loads', () => {
    const same = mailBranding({
      logo: { src: 'http://console.test/tenants/acme/brand/a.png', alt: 'A', width: 1, height: 1 },
    });
    expect(logoViews(same, ORIGIN)[0]?.picture).toBe(
      'http://console.test/tenants/acme/brand/a.png',
    );
    expect(logoViews(mailBranding(), ORIGIN)[0]?.picture).toBeNull();
    expect(logoViews(mailBranding({ logo: null }), ORIGIN)[0]?.picture).toBeNull();
    const odd = mailBranding({ logo: { src: 'not a url', alt: '', width: 1, height: 1 } });
    expect(logoViews(odd, ORIGIN)[0]?.picture).toBeNull();
  });

  it('say where the picture is when the console cannot draw it', () => {
    expect(LOGO_ELSEWHERE).toMatch(/preview/u);
  });

  it('say what a missing one means', () => {
    const [light, dark] = logoViews(mailBranding({ logo: null }), ORIGIN);
    expect(light?.src).toBeNull();
    expect(light?.empty).toMatch(/Odudu’s own mark/u);
    expect(dark?.empty).toMatch(/light logo is shown/u);
  });

  it('say the size a mail draws a logo at', () => {
    expect(logoViews(mailBranding(), ORIGIN)[0]?.size).toBe('160 by 32 pixels');
  });
});
