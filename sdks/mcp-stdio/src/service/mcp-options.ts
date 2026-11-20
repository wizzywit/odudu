import { StdioError } from '#/service/stdio-error';
import { parseArgs } from 'node:util';

function text(summary: string, required = false) {
  return { type: 'string', required, summary } as const;
}

function flag(summary: string) {
  return { type: 'boolean', required: false, summary } as const;
}

// The command's options, handed to `parseArgs` (which reads `type`) and shown
// by `--help`. The server's `odudu help` keeps a copy of this table that a test
// holds to it.
export const MCP_OPTIONS = {
  'base-url': text(
    'Address of the Odudu instance, with no path. It must be https unless it is a loopback address.',
    true,
  ),
  'tenant-address': text(
    'The https origin a tenant with a domain of its own signs in at (its login host, with the scheme). ' +
      'The admin API stays at --base-url. Without it the tenant is at its path address under --base-url.',
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

export type McpValues = ReturnType<typeof parse>['values'];

function parse(argv: readonly string[]) {
  try {
    return parseArgs({ args: [...argv], options: MCP_OPTIONS, allowPositionals: true });
  } catch (error) {
    throw new StdioError(
      'mcp_invalid_options',
      error instanceof Error ? error.message : 'invalid options',
    );
  }
}

export function checkedArguments(argv: readonly string[]): McpValues {
  const { values, positionals } = parse(argv);
  if (positionals.length > 0) {
    throw new StdioError(
      'mcp_invalid_options',
      `unexpected argument ${JSON.stringify(positionals[0])}`,
    );
  }
  if (values['read-only'] === true && values['allow-writes'] === true) {
    throw new StdioError(
      'mcp_invalid_options',
      '--read-only and --allow-writes contradict each other; give one',
    );
  }
  return values;
}

export function requiredTarget(values: McpValues): { baseUrl: string; tenant: string } {
  if (values['base-url'] === undefined) {
    throw new StdioError(
      'mcp_invalid_options',
      '--base-url is required (the address of the Odudu instance)',
    );
  }
  if (values.tenant === undefined) {
    throw new StdioError('mcp_invalid_options', '--tenant is required (the tenant to act in)');
  }
  return { baseUrl: values['base-url'], tenant: values.tenant };
}

export function usageText(): string {
  const lines = ['Usage: odudu-mcp --base-url <url> --tenant <name> [options]', '', 'Options:'];
  for (const [name, spec] of Object.entries(MCP_OPTIONS)) {
    lines.push(`  --${name}${spec.type === 'string' ? ' <value>' : ''}`, `      ${spec.summary}`);
  }
  lines.push(
    '',
    'Environment: ODUDU_MCP_KEY, ODUDU_MCP_CLIENT_ID (see --key-file and --client-id).',
    'Standard output carries the protocol only; everything else goes to standard error.',
  );
  return lines.join('\n');
}
