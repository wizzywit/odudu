import { flag, text } from '#/cli/command-types';

export const MCP_OPTIONS = {
  'base-url': text(
    'Address of the Odudu instance, with no path. It must be https unless it is a loopback address.',
    true,
  ),
  tenant: text('Name of the tenant to act in; every call is made in this tenant.', true),
  'read-only': flag(
    'Offer the read tools only, and ask for mcp:read at sign-in. This is the default.',
  ),
  'allow-writes': flag(
    'Ask for mcp:write at sign-in and offer the write tools as well. The token lasts at most ' +
      'ten minutes, is never refreshed or stored, and each sign-in asks you again.',
  ),
  'key-file': text(
    'File holding the service account key, readable by you only. The same value as ' +
      'ODUDU_MCP_KEY, which is read when this is not given.',
  ),
  'client-id': text(
    'The client_id of the service account the key belongs to; read from ODUDU_MCP_CLIENT_ID ' +
      'when not given. With a key the command signs in as it, with no browser.',
  ),
  logout: flag(
    'Forget the sign-in kept for this instance and tenant, in the credential store and the ' +
      'file, and exit.',
  ),
  keygen: flag(
    'Print a new ODUDU_MCP_KEY line on standard output and the public key set to register ' +
      'for the service account on standard error, then exit. Needs no other option.',
  ),
} as const;
