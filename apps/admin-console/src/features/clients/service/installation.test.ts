import { expect, it } from 'vitest';
import { installationRows } from '#/features/clients/service/installation.ts';

it('lists what an application is configured with, the issuer and the client ID to be copied', () => {
  const rows = installationRows({
    issuer: 'https://id.example/acme',
    discovery_url: 'https://id.example/acme/.well-known/openid-configuration',
    client_id: 'billing',
    client_type: 'confidential',
    token_endpoint_auth_method: 'client_secret_basic',
    redirect_uris: ['https://billing.example/cb'],
    post_logout_redirect_uris: [],
    grant_types: ['authorization_code'],
    default_scope: 'openid profile',
  });
  expect(rows.map((row) => row.label)).toEqual([
    'Issuer',
    'Discovery URL',
    'Client ID',
    'Client type',
    'Authentication method',
    'Redirect URIs',
    'Post-logout redirect URIs',
    'Grant types',
    'Default scope',
  ]);
  expect(rows.filter((row) => row.copy).map((row) => row.label)).toEqual([
    'Issuer',
    'Discovery URL',
    'Client ID',
  ]);
  expect(rows.find((row) => row.label === 'Post-logout redirect URIs')?.values).toEqual([]);
});
