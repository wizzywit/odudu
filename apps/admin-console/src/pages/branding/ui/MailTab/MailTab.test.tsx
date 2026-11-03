import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { languagesRoutes, ML, mailBranding } from '#/testing/brandingFixtures';
import { C, client } from '#/testing/clientsFixtures';
import { json, problem } from '#/testing/fakeTransport';
import { ACME_ADMIN } from '#/testing/tenantPaths';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import { resetConsole } from '#/testing/resetConsole';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/branding?tab=mail';

it('frames the production mail with no script and no shared origin', async () => {
  renderConsoleAt(AT, languagesRoutes());
  const frame = await screen.findByTitle('Preview of the verification mail');
  expect(frame).toHaveAttribute('sandbox', '');
  expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
  const src = frame.getAttribute('src') ?? '';
  expect(src).toContain('/admin/tenants/acme/mail/preview?');
  expect(new URL(src, 'http://x').searchParams.get('scheme')).toBe('light');
  expect(new URL(src, 'http://x').searchParams.get('locale')).toBeNull();
});

it('asks for the dark scheme and a language when they are chosen', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, languagesRoutes());
  await screen.findByTitle('Preview of the verification mail');
  await user.click(screen.getByRole('button', { name: /Colour scheme/u }));
  await user.click(await screen.findByRole('option', { name: 'Dark' }));
  await user.click(screen.getByRole('button', { name: /Language/u }));
  await user.click(await screen.findByRole('option', { name: /Arabic/u }));
  const params = new URL(
    (await screen.findByTitle('Preview of the verification mail')).getAttribute('src') ?? '',
    'http://x',
  ).searchParams;
  expect(params.get('scheme')).toBe('dark');
  expect(params.get('locale')).toBe('ar');
});

it('lists the nine colours of each scheme and who supplies each palette', async () => {
  renderConsoleAt(AT, languagesRoutes());
  const light = await screen.findByRole('region', { name: 'Light colours' });
  expect(within(light).getAllByRole('row')).toHaveLength(10);
  expect(within(light).getByText('From the tenant’s published theme.')).toBeVisible();
  expect(within(light).getByRole('row', { name: /Message background/u })).toHaveTextContent(
    '#fafafa',
  );
  const dark = screen.getByRole('region', { name: 'Dark colours' });
  expect(within(dark).getByText('Odudu’s default.')).toBeVisible();
});

it('shows the logo the mail carries, and says when there is none', async () => {
  renderConsoleAt(AT, languagesRoutes());
  const logo = await screen.findByRole('region', { name: 'Logo' });
  expect(logo).toHaveTextContent('Acme logo');
  expect(logo).toHaveTextContent('160 by 32 pixels');
  expect(logo).toHaveTextContent('light logo is shown in both schemes');
});

it('shows the logo itself when it is served from the console’s own address', async () => {
  const src = `${globalThis.location.origin}/tenants/acme/brand/a.png`;
  renderConsoleAt(
    AT,
    languagesRoutes({
      [`GET ${ML}`]: json(
        mailBranding({ logo: { src, alt: 'Acme logo', width: 160, height: 32 } }),
      ),
    }),
  );
  const logo = await screen.findByRole('region', { name: 'Logo' });
  expect(within(logo).getByRole('img', { name: 'Acme logo' })).toHaveAttribute('src', src);
  expect(logo).not.toHaveTextContent('preview above');
});

it('points at the preview when the logo is served from another address', async () => {
  renderConsoleAt(AT, languagesRoutes());
  const logo = await screen.findByRole('region', { name: 'Logo' });
  expect(within(logo).queryByRole('img')).toBeNull();
  expect(logo).toHaveTextContent('shown in the preview above');
});

it('says the mail keeps Odudu’s own mark when the theme sets no logo', async () => {
  renderConsoleAt(AT, languagesRoutes({ [`GET ${ML}`]: json(mailBranding({ logo: null })) }));
  expect(await screen.findByText(/shows Odudu’s own mark/u)).toBeVisible();
});

it('says the colours could not be loaded, and offers to try again', async () => {
  renderConsoleAt(
    AT,
    languagesRoutes({
      [`GET ${ML}`]: problem(500, 'about:blank', 'Error'),
      [`GET ${ACME_ADMIN}/clients`]: json({ items: [] }),
    }),
  );
  expect(await screen.findByText('The colours and logo could not be loaded.')).toBeVisible();
  expect(screen.getByRole('button', { name: /Try again|Retry/u })).toBeVisible();
});

it('heads what the mail inherits, beside the logo and the colours', async () => {
  renderConsoleAt(AT, languagesRoutes());
  const section = await screen.findByRole('region', { name: 'What the mail inherits' });
  expect(within(section).getByRole('heading', { level: 2 })).toHaveTextContent(
    'What the mail inherits',
  );
  expect(within(section).getByText(/takes the tenant’s published logo and colours/u)).toBeVisible();
});

it('reads what the mail inherits only when the Mail tab is open', async () => {
  const { sent } = renderConsoleAt('/console/acme/branding', languagesRoutes());
  await screen.findByRole('tab', { name: 'Mail' });
  expect(sent.some((request) => request.path === ML)).toBe(false);
});

it('has nothing axe can find in either theme', async () => {
  const { element } = consoleAt(AT, languagesRoutes());
  const found = await axeInBothThemes(
    () => element,
    () => screen.findByRole('region', { name: 'Light colours' }),
    { frames: false },
  );
  expect(found).toEqual({ light: [], dark: [] });
});

it('has nothing axe can find in either theme with the logo drawn', async () => {
  const src = `${globalThis.location.origin}/tenants/acme/brand/a.png`;
  const { element } = consoleAt(
    AT,
    languagesRoutes({
      [`GET ${ML}`]: json(
        mailBranding({ logo: { src, alt: 'Acme logo', width: 160, height: 32 } }),
      ),
    }),
  );
  const found = await axeInBothThemes(
    () => element,
    () => screen.findByRole('img', { name: 'Acme logo' }),
    { frames: false },
  );
  expect(found).toEqual({ light: [], dark: [] });
});

describe('previewing as a client', () => {
  const billing = client('c-bill', 'billing', { name: 'Billing' });
  const routes = (extra: Record<string, ReturnType<typeof json>> = {}) =>
    languagesRoutes({
      [`GET ${ACME_ADMIN}/clients`]: json({ items: [billing] }),
      [`GET ${C}/c-bill/mail/branding`]: json(
        mailBranding({
          light: {
            source: 'client',
            colours: { ...mailBranding().light.colours, panel: '#e0f0ff' },
          },
        }),
      ),
      ...extra,
    });

  it('shows the tenant’s own look until a client is chosen, and says so', async () => {
    renderConsoleAt(AT, routes());
    const section = await screen.findByRole('region', { name: 'What the mail inherits' });
    expect(within(section).getByText(/This shows the tenant’s own/u)).toBeVisible();
  });

  it('frames the client’s mail, reads its colours and names who supplies them', async () => {
    const user = userEvent.setup();
    const { sent } = renderConsoleAt(AT, routes());
    await screen.findByTitle('Preview of the verification mail');
    await user.click(await screen.findByRole('option', { name: /Billing/u }));
    const frame = await screen.findByTitle('Preview of the verification mail');
    await waitFor(() => {
      expect(frame.getAttribute('src') ?? '').toContain('/clients/c-bill/mail/preview?');
    });
    const light = await screen.findByRole('region', { name: 'Light colours' });
    expect(await within(light).findByText('From the client’s published theme.')).toBeVisible();
    expect(
      await screen.findByText(/This shows the mail a sign-in of Billing sends/u),
    ).toBeVisible();
    expect(sent.some((request) => request.path === `${C}/c-bill/mail/branding`)).toBe(true);
  });

  it('goes back to the tenant’s own look', async () => {
    const user = userEvent.setup();
    renderConsoleAt(AT, routes());
    await user.click(await screen.findByRole('option', { name: /Billing/u }));
    await user.click(await screen.findByRole('button', { name: 'Show the tenant’s own' }));
    const frame = await screen.findByTitle('Preview of the verification mail');
    expect(frame.getAttribute('src') ?? '').toContain('/admin/tenants/acme/mail/preview?');
    expect(screen.queryByRole('button', { name: 'Show the tenant’s own' })).toBeNull();
  });

  it('says what is needed when the caller may not list clients', async () => {
    renderConsoleAt(
      AT,
      routes({ [`GET ${ACME_ADMIN}/clients`]: problem(403, 'about:blank', 'Forbidden') }),
    );
    expect(await screen.findByText(/manage-clients/u)).toBeVisible();
  });
});
