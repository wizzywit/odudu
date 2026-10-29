import { test, signIn } from './fixtures';
import { seeded } from './stack';

const { branding } = seeded().config;
const OUT = process.env.CAPTURE_DIR ?? '/tmp/shots';
const SIZES = [
  [375, 812],
  [768, 1024],
] as const;

for (const [w, h] of SIZES) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`capture ${String(w)} ${scheme}`, async ({ page }) => {
      test.slow();
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await signIn(page, branding.layout);
      for (const tab of ['Theme', 'Pages', 'Mail', 'Languages']) {
        await page.goto(`/console/${branding.layout.tenant}/branding`);
        await page.getByRole('tab', { name: tab, exact: true }).click();
        await page.waitForTimeout(1500);
        await page.screenshot({
          path: `${OUT}/${tab}-${String(w)}-${scheme}.png`,
          fullPage: true,
        });
      }
      await page.goto(`/console/${branding.client.tenant}/clients`);
      await page
        .getByRole('grid', { name: 'Clients' })
        .getByRole('row', { name: /brand-app/u })
        .click();
      await page.getByRole('tab', { name: 'Branding' }).click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${OUT}/Client-${String(w)}-${scheme}.png`, fullPage: true });
    });
  }
}
