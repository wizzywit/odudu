import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { discoveryView, type KeysView, type Read } from '#/features/overview/service.ts';
import { DiscoveryPanel } from '#/features/overview/view/DiscoveryPanel';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

const ISSUER = 'https://id.example/tenants/acme';

const DISCOVERY = {
  status: 'ready',
  data: discoveryView({
    issuer: ISSUER,
    token_endpoint: `${ISSUER}/protocol/openid-connect/token`,
    jwks_uri: `${ISSUER}/protocol/openid-connect/certs`,
    grant_types_supported: ['authorization_code', 'refresh_token'],
    claims_parameter_supported: true,
  }),
} as const;

const KEYS: Read<KeysView> = {
  status: 'ready',
  data: {
    rows: [
      { row: '0', kid: 'kid-active-0001', kty: 'EC', alg: 'ES256', use: 'sig', lane: 'active' },
      { row: '1', kid: 'kid-staged-0002', kty: 'RSA', alg: 'RS256', use: 'sig', lane: 'rotating' },
    ],
    raw: '{\n  "keys": []\n}',
    lanesNeed: null,
  },
};

it('shows the issuer with a copy control, and links the document relying parties read', async () => {
  const user = userEvent.setup();
  render(<DiscoveryPanel discovery={DISCOVERY} keys={KEYS} />);
  const panel = screen.getByRole('region', { name: 'Discovery' });
  expect(within(panel).getByText(ISSUER)).toBeVisible();
  await user.click(within(panel).getByRole('button', { name: 'Copy issuer' }));
  expect(await navigator.clipboard.readText()).toBe(ISSUER);
  expect(within(panel).getByRole('link', { name: /openid-configuration/u })).toHaveAttribute(
    'href',
    `${ISSUER}/.well-known/openid-configuration`,
  );
});

it('lists the endpoints and the supported values', () => {
  render(<DiscoveryPanel discovery={DISCOVERY} keys={KEYS} />);
  const endpoints = screen.getByRole('region', { name: 'Endpoints' });
  expect(endpoints).toHaveTextContent('token_endpoint');
  expect(endpoints).toHaveTextContent(`${ISSUER}/protocol/openid-connect/token`);
  expect(endpoints).toHaveTextContent('jwks_uri');
  const supported = screen.getByRole('region', { name: 'Supported values' });
  expect(within(supported).getByRole('list', { name: 'grant_types_supported' })).toHaveTextContent(
    'authorization_coderefresh_token',
  );
  expect(supported).toHaveTextContent('claims_parameter_supportedyes');
});

it('lists each published key with its lane', () => {
  render(<DiscoveryPanel discovery={DISCOVERY} keys={KEYS} />);
  const table = screen.getByRole('grid', { name: 'Published keys' });
  const rows = within(table).getAllByRole('row').slice(1);
  expect(rows[0]).toHaveTextContent('EC');
  expect(rows[0]).toHaveTextContent('ES256');
  expect(rows[0]).toHaveTextContent('active');
  expect(rows[1]).toHaveTextContent('rotating');
});

it('names the capability a lane needs when the key list could not be read', () => {
  const unread: Read<KeysView> = {
    status: 'ready',
    data: {
      rows: [{ row: '0', kid: 'k', kty: 'EC', alg: null, use: null, lane: 'unknown' }],
      raw: '{}',
      lanesNeed: 'manage-keys',
    },
  };
  render(<DiscoveryPanel discovery={DISCOVERY} keys={unread} />);
  expect(screen.getByRole('note')).toHaveTextContent(
    "Each key's lane needs the manage-keys capability.",
  );
  expect(screen.getByRole('grid', { name: 'Published keys' })).toHaveTextContent('not known');
});

it('keeps the raw documents in a disclosure, each with its copy', async () => {
  const user = userEvent.setup();
  render(<DiscoveryPanel discovery={DISCOVERY} keys={KEYS} />);
  const raw = screen.getByText('Raw discovery document');
  expect(screen.getByRole('button', { name: 'Copy discovery document' })).not.toBeVisible();
  await user.click(raw);
  await user.click(screen.getByRole('button', { name: 'Copy discovery document' }));
  expect(await navigator.clipboard.readText()).toBe(DISCOVERY.data.raw);
  await user.click(screen.getByText('Raw JWKS'));
  await user.click(screen.getByRole('button', { name: 'Copy JWKS' }));
  expect(await navigator.clipboard.readText()).toBe('{\n  "keys": []\n}');
});

it('draws term-and-value rows while the document loads, and the keys table while they do', () => {
  const { rerender } = render(
    <DiscoveryPanel discovery={{ status: 'loading' }} keys={{ status: 'loading' }} />,
  );
  expect(screen.getByRole('status').querySelector('[data-shape="terms"]')).not.toBeNull();
  rerender(<DiscoveryPanel discovery={DISCOVERY} keys={{ status: 'loading' }} />);
  const keys = screen
    .getAllByRole('status')
    .filter((status) => status.textContent.includes('Loading the published keys'));
  expect(keys).toHaveLength(1);
  expect(keys[0]?.querySelector('[data-shape="table"] th')).not.toBeNull();
});

it('lets a long name break only after an underscore, never inside a word', () => {
  render(<DiscoveryPanel discovery={DISCOVERY} keys={KEYS} />);
  const name = screen.getByText('grant_types_supported', { selector: 'code' });
  expect(name.innerHTML).toBe('grant_<wbr>types_<wbr>supported');
});

it('says when the document could not be read, and reads it again', async () => {
  const user = userEvent.setup();
  const retry = vi.fn();
  render(
    <DiscoveryPanel
      discovery={{ status: 'failed', refused: false, retry }}
      keys={{ status: 'loading' }}
    />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('The discovery document could not be read');
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(retry).toHaveBeenCalledOnce();
});

it('passes axe in both themes', async () => {
  for (const [discovery, keys] of [
    [DISCOVERY, KEYS],
    [{ status: 'loading' }, { status: 'loading' }],
    [DISCOVERY, { status: 'failed', refused: false, retry: vi.fn() }],
  ] as const) {
    expect(
      await axeInBothThemes(() => <DiscoveryPanel discovery={discovery} keys={keys} />),
    ).toEqual({ light: [], dark: [] });
  }
});
