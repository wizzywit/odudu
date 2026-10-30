import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ClientRecord } from '@odudu/contracts/admin';
import { afterEach, describe, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import {
  clientBrandingRoutes,
  clientView,
  CTH,
  EMPTY,
  MC,
  SH,
  OWN_LIGHT,
  previewInfo,
  themeAnswer,
} from '#/testing/brandingFixtures';
import { BILLING, C } from '#/testing/clientsFixtures';
import { json, problem } from '#/testing/fakeTransport';
import { ACME_ADMIN } from '#/testing/tenantPaths';
import { BrandingTab } from '#/features/clients/view/BrandingTab';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import { resetConsole } from '#/testing/resetConsole';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/clients/c-bill?tab=branding';

// A client whose draft and published theme both set the light colours.
function overriding(changed: string[] = []) {
  const body = { ...EMPTY, tokens: { light: OWN_LIGHT } };
  return clientView({
    changed,
    draft: changed.length === 0 ? body : { ...body, stylesheet: '.page { color: red; }' },
    published: { id: 'cv1', version: 1, published_at: '2026-10-20T09:00:00.000Z', body },
    sources: { 'tokens.light': 'client' },
    draft_sources: { 'tokens.light': 'client' },
  });
}

async function colours() {
  return screen.findByRole('region', { name: 'Colours and font' });
}

it('adds a Branding tab to the client, between Logout and Advanced', async () => {
  renderConsoleAt('/console/acme/clients/c-bill', clientBrandingRoutes());
  await screen.findByRole('heading', { level: 1, name: 'Billing' });
  const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
  expect(tabs.indexOf('Branding')).toBe(tabs.indexOf('Logout') + 1);
  expect(tabs.indexOf('Advanced')).toBe(tabs.indexOf('Branding') + 1);
});

it('edits the client’s own theme under the same two tabs as the tenant’s', async () => {
  renderConsoleAt(AT, clientBrandingRoutes());
  await colours();
  expect(screen.getByRole('tablist', { name: 'Branding sections' }).textContent).toBe('ThemePages');
  expect(screen.getByRole('region', { name: 'Images' })).toBeVisible();
  expect(screen.getByRole('region', { name: 'Stylesheet' })).toBeVisible();
  expect(screen.getByRole('region', { name: 'Publish' })).toBeVisible();
  expect(screen.getByRole('region', { name: 'Versions' })).toBeVisible();
  expect(screen.getByRole('region', { name: 'Reset to default' })).toHaveTextContent(
    /its tenant’s look/u,
  );
});

describe('what a client piece hides', () => {
  it('a client override shows the tenant piece it hides', async () => {
    renderConsoleAt(AT, clientBrandingRoutes(themeAnswer(overriding(), '"cd1"')));
    const section = await colours();
    expect(
      await within(section).findByText(
        'Draft: this client · Published: this client · Hides the tenant’s light colours',
      ),
    ).toBeVisible();
    expect(
      within(section).getAllByText('Draft: Instrument’s default · Published: Instrument’s default'),
    ).toHaveLength(2);
  });

  it('says a piece the client sets replaces Instrument’s where the tenant sets none', async () => {
    const view = clientView({
      sources: { 'tokens.dark': 'client' },
      draft_sources: { 'tokens.dark': 'client' },
      draft: { ...EMPTY, tokens: { dark: OWN_LIGHT } },
    });
    renderConsoleAt(AT, clientBrandingRoutes(themeAnswer(view, '"cd1"')));
    const section = await colours();
    expect(
      await within(section).findByText(
        'Draft: this client · Published: this client · Replaces Instrument’s default dark colours',
      ),
    ).toBeVisible();
  });

  it('follows the tenant for a piece the client leaves alone', async () => {
    const view = clientView({ sources: { 'assets.logo': 'tenant' } });
    renderConsoleAt(AT, clientBrandingRoutes(themeAnswer(view, '"cd1"')));
    const images = await screen.findByRole('region', { name: 'Images' });
    expect(within(images).getAllByText('Published: the tenant').length).toBeGreaterThan(0);
    expect(images).not.toHaveTextContent('Hides');
  });
});

describe('saving the client’s theme', () => {
  it('sends the first save to the client’s theme with no If-Match, never the tenant’s', async () => {
    const user = userEvent.setup();
    const { sent } = renderConsoleAt(
      AT,
      clientBrandingRoutes(themeAnswer(clientView()), {
        [`PUT ${CTH}`]: json(overriding(), 200, { etag: '"cd1"' }),
      }),
    );
    const section = await colours();
    await user.click(within(section).getByRole('switch', { name: 'Use my own light colours' }));
    await user.click(within(section).getByRole('button', { name: /Save/u }));
    await waitFor(() => {
      expect(sent.some((s) => s.method === 'PUT')).toBe(true);
    });
    const put = sent.find((s) => s.method === 'PUT');
    expect(put?.path).toBe(CTH);
    expect(put?.ifMatch).toBeNull();
    expect(
      sent.filter((s) => s.method !== 'GET').every((s) => s.path.includes('/clients/c-bill')),
    ).toBe(true);
  });

  it('marks the Branding tab with its dot while a section holds unsaved edits', async () => {
    const user = userEvent.setup();
    renderConsoleAt(AT, clientBrandingRoutes());
    const section = await colours();
    expect(screen.getByRole('tab', { name: 'Branding' })).toHaveAccessibleName('Branding');
    await user.click(within(section).getByRole('switch', { name: 'Use my own light colours' }));
    expect(screen.getByRole('tab', { name: /^Branding/u })).toHaveAccessibleName(/unsaved/iu);
    expect(screen.getByRole('tab', { name: /^Theme/u })).toHaveAccessibleName(/unsaved/iu);
    expect(screen.getByRole('tab', { name: 'General' })).toHaveAccessibleName('General');
  });

  it('sends a publish to the client’s own route only, says the refusal, and keeps the tab', async () => {
    const user = userEvent.setup();
    const { sent } = renderConsoleAt(
      AT,
      clientBrandingRoutes(themeAnswer(overriding(['stylesheet']), '"cd1"'), {
        [`POST ${CTH}/publish`]: problem(409, 'about:blank#theme-no-draft', 'Conflict', {
          detail: 'There is no draft to publish.',
        }),
      }),
    );
    const publish = await screen.findByRole('region', { name: 'Publish' });
    await user.click(await within(publish).findByRole('button', { name: 'Publish the draft' }));
    await waitFor(() => {
      expect(sent.some((s) => s.method === 'POST')).toBe(true);
    });
    expect(await within(publish).findByText(/no draft/iu)).toBeVisible();
    expect(sent.filter((s) => s.method !== 'GET').map((s) => s.path)).toEqual([`${CTH}/publish`]);
    expect(screen.getByRole('tab', { name: /^Branding/u })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});

describe('the publication bar and the revert', () => {
  const OWN = { ...EMPTY, tokens: { light: OWN_LIGHT } };

  function pending() {
    return clientView({
      draft: { ...OWN, stylesheet: '.page { color: red; }', templates: { 'sign-in': 'x' } },
      published: {
        id: 'cv1',
        version: 1,
        published_at: '2026-10-20T09:00:00.000Z',
        body: OWN,
      },
      changed: ['stylesheet', 'templates'],
    });
  }

  it('sits above the two tabs and names what the client’s draft changes', async () => {
    renderConsoleAt(AT, clientBrandingRoutes(themeAnswer(pending(), '"cd1"')));
    const bar = await screen.findByRole('region', { name: 'Publish' });
    expect(within(bar).getByText('Changed: Stylesheet, Page templates')).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Theme, changes to publish' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Pages, changes to publish' })).toBeVisible();
  });

  it('discards on the client’s own route and says what stays', async () => {
    const user = userEvent.setup();
    const { sent } = renderConsoleAt(
      AT,
      clientBrandingRoutes(themeAnswer(pending(), '"cd1"'), {
        [`DELETE ${CTH}/draft`]: json(clientView({ published: pending().published })),
      }),
    );
    const bar = await screen.findByRole('region', { name: 'Publish' });
    await user.click(within(bar).getByRole('button', { name: 'Discard draft…' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('client’s saved draft');
    await user.click(within(dialog).getByRole('button', { name: 'Discard draft' }));
    await waitFor(() => {
      expect(sent.some((s) => s.method === 'DELETE')).toBe(true);
    });
    expect(sent.filter((s) => s.method !== 'GET').map((s) => s.path)).toEqual([`${CTH}/draft`]);
  });

  it('reverts a tab to the client’s own published layer, falling back below where it has none', async () => {
    const user = userEvent.setup();
    const { sent } = renderConsoleAt(
      AT,
      clientBrandingRoutes(themeAnswer(pending(), '"cd1"'), {
        [`PUT ${CTH}`]: json(clientView(), 200, { etag: '"cd2"' }),
      }),
    );
    const panel = await screen.findByRole('region', { name: 'Revert to published' });
    expect(panel).toHaveTextContent(/falls back to the tenant’s theme/u);
    await user.click(within(panel).getByRole('button', { name: 'Revert this tab to published' }));
    await waitFor(() => {
      expect(sent.some((s) => s.method === 'PUT')).toBe(true);
    });
    expect(sent.find((s) => s.method === 'PUT')?.body).toEqual({
      tokens: OWN.tokens,
      assets: {},
      stylesheet: null,
      templates: { 'sign-in': 'x' },
    });
  });
});

describe('a refusal on a client’s page', () => {
  it('names manage-clients, as the writes of a client’s theme need', async () => {
    const user = userEvent.setup();
    renderConsoleAt(
      AT,
      clientBrandingRoutes(themeAnswer(overriding(), '"cd1"'), {
        [`PUT ${CTH}`]: problem(403, 'about:blank', 'Forbidden'),
      }),
    );
    const section = await colours();
    await user.click(within(section).getByRole('switch', { name: 'Use my own dark colours' }));
    await user.click(within(section).getByRole('button', { name: /Save/u }));
    expect(
      await within(section).findByText(/it needs the manage-clients capability/u),
    ).toBeVisible();
    expect(section).not.toHaveTextContent('manage-tenant');
  });
});

describe('the Pages tab', () => {
  it('edits the client’s page templates beside a preview of the page chosen', async () => {
    const user = userEvent.setup();
    renderConsoleAt(AT, clientBrandingRoutes(themeAnswer(overriding(), '"cd1"')));
    await colours();
    await user.click(screen.getByRole('tab', { name: /^Pages/u }));
    const section = await screen.findByRole('region', { name: 'Page templates' });
    expect(within(section).getByRole('textbox', { name: 'Sign in: template' })).toBeVisible();
    expect(
      within(section).getAllByText(/Published: the tenant|Instrument’s default/u).length,
    ).toBeGreaterThan(0);
    const frame = screen.getByTitle('Preview of the page');
    expect(frame.getAttribute('src')).toContain('/clients/c-bill/theme/preview');
  });
});

describe('what the preview says about itself', () => {
  const status = () => screen.findByRole('status', { name: 'What the preview shows' });

  it('says a client with no draft shows its published theme', async () => {
    renderConsoleAt(
      AT,
      clientBrandingRoutes(themeAnswer(overriding(), '"cd1"'), {
        [`GET ${CTH}/preview/info`]: json(previewInfo({ from: 'published', shown: 'client' })),
      }),
    );
    expect(
      await within(await status()).findByText(
        'This client has no saved draft, so the preview shows its published theme.',
      ),
    ).toBeVisible();
  });

  it('says a client with nothing saved shows the tenant’s theme', async () => {
    const { sent } = renderConsoleAt(
      AT,
      clientBrandingRoutes(themeAnswer(clientView()), {
        [`GET ${CTH}/preview/info`]: json(previewInfo({ from: 'none', shown: 'tenant' })),
      }),
    );
    expect(
      await within(await status()).findByText(
        'This client has no saved draft or published theme, so the preview shows the tenant’s theme.',
      ),
    ).toBeVisible();
    expect(sent.some((s) => s.path === `${CTH}/preview/info`)).toBe(true);
    expect(sent.some((s) => s.path === `${C}/../theme/preview/info`)).toBe(false);
  });

  it('names the layer a fault is in, the client’s or the tenant’s', async () => {
    renderConsoleAt(
      AT,
      clientBrandingRoutes(themeAnswer(overriding(), '"cd1"'), {
        [`GET ${CTH}/preview/info`]: json(
          previewInfo({
            shown: 'tenant',
            faults: [{ layer: 'client', code: 'image_gone' }],
          }),
        ),
      }),
    );
    const notice = await status();
    expect(
      await within(notice).findByText('The client’s draft names an image that no longer exists.'),
    ).toBeVisible();
    expect(within(notice).getByText('The preview shows the tenant’s theme instead.')).toBeVisible();
  });
});

it('offers the editor to a client the service-account ceiling holds back, since a theme write has none', async () => {
  renderConsoleAt(
    AT,
    clientBrandingRoutes(
      themeAnswer(clientView()),
      {
        [`GET ${C}/c-bill`]: json(
          { ...BILLING, service_account_admin_reach: ['manage-users'] },
          200,
          { etag: '"c-bill-1"' },
        ),
      },
      ['manage-clients', 'view-users'],
    ),
  );
  expect(await screen.findByRole('region', { name: 'Colours and font' })).toBeVisible();
  expect(screen.getByText(/cannot change Billing/u)).toBeVisible();
});

it('asks for no theme and no tenant settings of a caller holding manage-clients alone', async () => {
  const { sent } = renderConsoleAt(
    AT,
    clientBrandingRoutes(themeAnswer(clientView()), {}, ['manage-clients']),
  );
  await colours();
  expect(
    sent.some((request) => request.path.endsWith('/theme') && !request.path.includes('/clients/')),
  ).toBe(false);
  expect(sent.some((request) => request.path.endsWith('/settings'))).toBe(false);
});

it('asks for no theme of a client with no service account while the caller is unknown', async () => {
  const { sent } = renderConsoleAt(
    '/console/acme/clients/c-portal?tab=branding',
    clientBrandingRoutes(themeAnswer(clientView()), {
      [`GET ${ACME_ADMIN}/whoami`]: problem(500),
      [`GET ${C}/c-portal/theme`]: themeAnswer(clientView()),
    }),
  );
  await screen.findByRole('heading', { level: 1, name: 'portal' });
  await screen.findByRole('tab', { name: 'Branding' });
  expect(screen.queryByRole('region', { name: 'Colours and font' })).toBeNull();
  expect(sent.some((request) => request.path.includes('/theme'))).toBe(false);
});

describe('the tab held back for a missing capability', () => {
  const client = { ...BILLING, id: 'c-bill' } as ClientRecord;

  it('names the capability and offers no editor', () => {
    render(<BrandingTab tenant="acme" client={client} offer="held" needs={['manage-clients']} />);
    expect(screen.getByRole('note')).toHaveTextContent(
      'The client’s branding is read and changed with manage-clients.',
    );
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('shows neither the note nor the editor while the caller’s capabilities are unknown', () => {
    const { container } = render(
      <BrandingTab tenant="acme" client={client} offer="checking" needs={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

it('says the branding could not be loaded, with a way to ask again', async () => {
  renderConsoleAt(AT, clientBrandingRoutes(problem(500, 'about:blank', 'Server Error')));
  expect(await screen.findByText('The client’s branding could not be loaded')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
});

it('passes axe in both themes', async () => {
  const { element } = consoleAt(AT, clientBrandingRoutes(themeAnswer(overriding(), '"cd1"')));
  const results = await axeInBothThemes(
    () => element,
    () => colours(),
    { frames: false },
  );
  expect(results.light).toEqual([]);
  expect(results.dark).toEqual([]);
});

it('keeps its tab in the keyboard order, and moves between its own with the arrows', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, clientBrandingRoutes(themeAnswer(overriding(), '"cd1"')));
  await colours();
  const theme = screen.getByRole('tab', { name: /^Theme/u });
  theme.focus();
  await user.keyboard('{ArrowRight}');
  expect(screen.getByRole('tab', { name: /^Pages/u })).toHaveAttribute('aria-selected', 'true');
  expect(await screen.findByRole('region', { name: 'Page templates' })).toBeVisible();
});

describe('what the client’s Branding reads', () => {
  const count = (sent: readonly { path: string }[], path: string): number =>
    sent.filter((request) => request.path === path).length;

  it('asks for the hooks and the versions while the client’s theme is still arriving', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { sent } = renderConsoleAt(
      AT,
      clientBrandingRoutes(async (request) => {
        await gate;
        return themeAnswer(clientView())(request);
      }),
    );
    await waitFor(() => {
      expect(count(sent, SH)).toBe(1);
      expect(count(sent, `${CTH}/versions`)).toBe(1);
    });
    release();
    await colours();
  });

  it('reads each once, and the catalogue only once Pages is shown', async () => {
    const user = userEvent.setup();
    const { sent } = renderConsoleAt(AT, clientBrandingRoutes());
    await colours();
    expect(count(sent, SH)).toBe(1);
    expect(count(sent, `${CTH}/versions`)).toBe(1);
    expect(count(sent, MC)).toBe(0);
    await user.click(screen.getByRole('tab', { name: 'Pages' }));
    await screen.findByRole('combobox', { name: 'Page' });
    expect(count(sent, MC)).toBe(1);
  });
});
