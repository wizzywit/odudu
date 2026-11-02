import type { ClientInstallation } from '@odudu/contracts/admin';

export const INSTALLATION_HEADING = 'Installation';
export const INSTALLATION_RULE =
  'What an application is configured with to sign people in through this client. The secret is never part of it: it is shown once, when it is made or rotated.';

export interface InstallationRow {
  label: string;
  // One value, or a list shown a line each.
  values: readonly string[];
  // Whether it is a value an operator copies into the application.
  copy: boolean;
}

export function installationRows(installation: ClientInstallation): InstallationRow[] {
  return [
    { label: 'Issuer', values: [installation.issuer], copy: true },
    { label: 'Discovery URL', values: [installation.discovery_url], copy: true },
    { label: 'Client ID', values: [installation.client_id], copy: true },
    { label: 'Client type', values: [installation.client_type], copy: false },
    {
      label: 'Authentication method',
      values: [installation.token_endpoint_auth_method],
      copy: false,
    },
    { label: 'Redirect URIs', values: installation.redirect_uris, copy: false },
    {
      label: 'Post-logout redirect URIs',
      values: installation.post_logout_redirect_uris,
      copy: false,
    },
    { label: 'Grant types', values: installation.grant_types, copy: false },
    { label: 'Default scope', values: [installation.default_scope], copy: false },
  ];
}

export const NONE = 'None';
