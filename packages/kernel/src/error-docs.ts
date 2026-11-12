import { type ErrorCode } from '#/errors';

export type ErrorGroup =
  | 'Startup and configuration'
  | 'Commands'
  | 'Background passes'
  | 'Signing, tokens and encryption'
  | 'Data and validation';

export const ERROR_GROUPS: readonly ErrorGroup[] = [
  'Startup and configuration',
  'Commands',
  'Background passes',
  'Signing, tokens and encryption',
  'Data and validation',
];

interface ErrorDoc {
  readonly group: ErrorGroup;
  readonly summary: string;
}

function startup(summary: string): ErrorDoc {
  return { group: 'Startup and configuration', summary };
}

function command(summary: string): ErrorDoc {
  return { group: 'Commands', summary };
}

function pass(summary: string): ErrorDoc {
  return { group: 'Background passes', summary };
}

function crypto(summary: string): ErrorDoc {
  return { group: 'Signing, tokens and encryption', summary };
}

function data(summary: string): ErrorDoc {
  return { group: 'Data and validation', summary };
}

// The codes of the errors the server and its commands fail with, which appear
// in logs and on standard error. Typed over every code, so one added without
// an entry here fails to compile.
export const ERROR_DOCS: Record<ErrorCode, ErrorDoc> = {
  config_invalid: startup(
    'The environment does not describe a valid configuration. The message names every ' +
      'variable at fault, or the production rule that was broken.',
  ),
  module_duplicate: startup('Two server modules registered under the same name.'),
  module_unknown_dependency: startup(
    'A server module depends on a module that was not registered.',
  ),
  module_cycle: startup(
    'The server modules depend on each other in a cycle, so none can start first.',
  ),
  module_stop_failed: startup(
    'One or more modules failed while the server was shutting down. The failures are in the cause.',
  ),
  static_tree_too_large: startup(
    'A directory of static files, such as `ODUDU_INSTRUMENT_DIR`, holds more entries, files or ' +
      'bytes than the server will serve, so it is probably not the build.',
  ),
  smtp_destination_refused: startup(
    'The SMTP relay address is one the server refuses to connect to: a loopback, link-local ' +
      'or multicast address, or a private one while `ODUDU_ALLOW_PRIVATE_SMTP_HOSTS` is off.',
  ),
  cli_unknown_command: command(
    'The first argument of `odudu` is not a command. The exit status is 2 and the commands are ' +
      'printed.',
  ),
  seed_unknown_command: command('`odudu seed` was given a subcommand it does not have.'),
  seed_invalid_options: command(
    'The options of an `odudu seed` command are missing, contradictory or have an unacceptable ' +
      'value. The message names them.',
  ),
  seed_conflict: command(
    'The thing `odudu seed` was asked to create already exists, or exists in a form that ' +
      'disagrees with the request, such as a client of the other type.',
  ),
  seed_not_found: command('`odudu seed` was told to act on something that does not exist.'),
  seed_unknown_setting: command(
    'A `--set` names a tenant setting that does not exist. The message lists the ones that do.',
  ),
  seed_unknown_grant_type: command(
    '`--grant-type` names a grant type this server does not implement.',
  ),
  allowed_actions_need_me_read: command(
    'A client is given actions it may start without the scope `me:read`, which is how it ' +
      'reads the outcome. Refused by the admin API (a create or amend, or removing `me:read` ' +
      'or deleting it while a client holds actions), by a tenant import, and by ' +
      '`odudu seed client --allow-action` when the tenant has no `me:read` scope to assign. ' +
      'Through the admin API, assign `me:read` to the client first or make it a default ' +
      'assignment; the seed flag assigns it itself.',
  ),
  seed_admin_exists: command(
    '`odudu seed admin` found a subject with that name already in the system tenant.',
  ),
  seed_system_tenant_conflict: command(
    'A tenant named like the system tenant exists under another id, so the system tenant cannot ' +
      'be created.',
  ),
  init_invalid_options: command(
    'The options or environment of `odudu init` are not usable, for example a public base URL ' +
      'that is not a loopback address.',
  ),
  init_roles_without_secrets: command(
    '`odudu init` found the service role in the database but not the state file holding its ' +
      'password. Restore the file, or drop the role if the database is disposable.',
  ),
  console_unknown_command: command('`odudu console` was given a subcommand it does not have.'),
  console_invalid_options: command(
    'The options of an `odudu console` command are missing or unusable.',
  ),
  client_origins_unknown_command: command(
    '`odudu client-origins` was given a subcommand it does not have.',
  ),
  admin_client_not_builtin: command(
    'A client with the id of the built-in admin client already exists in the tenant but is not ' +
      'it, so the console cannot be registered.',
  ),
  mcp_client_not_builtin: command(
    'A client with the id of the built-in MCP client already exists in the tenant but is not ' +
      'it, so the built-in client cannot be provisioned.',
  ),
  admin_client_list_full: command(
    'The built-in admin client already holds as many redirect URIs as a client may, so the ' +
      'console’s address cannot be added.',
  ),
  breached_passwords_usage: command(
    '`odudu breached-passwords` was not given `load` and exactly one file path.',
  ),
  breached_passwords_bad_line: command(
    'A line of the file given to `odudu breached-passwords load` is not a SHA-1 hash, so the ' +
      'file is not a list of them. The message names the line; rows read before it stay loaded.',
  ),
  breached_passwords_cannot_load: command(
    '`odudu breached-passwords load` writes a table the serving role may only read, which needs ' +
      'a connection that bypasses row-level security, and `ODUDU_DATABASE_URL` names a role that ' +
      'neither is a superuser nor has BYPASSRLS.',
  ),
  reap_cannot_enumerate_tenants: pass(
    '`odudu reap` must list every tenant, which needs a connection that bypasses row-level ' +
      'security, and `ODUDU_DATABASE_URL` names a role that neither is a superuser nor has BYPASSRLS.',
  ),
  reap_requires_app_database_url: pass(
    '`odudu reap` deletes under the tenant policy and so needs `ODUDU_APP_DATABASE_URL`; the ' +
      'owner role escapes the policy.',
  ),
  reap_serving_role_bypasses_rls: pass(
    '`ODUDU_APP_DATABASE_URL` names a superuser or BYPASSRLS role, so `odudu reap` would not ' +
      'delete under the tenant policy.',
  ),
  outbox_cannot_enumerate_tenants: pass(
    'The mail sender must list every tenant, which needs a connection that bypasses row-level ' +
      'security, and `ODUDU_DATABASE_URL` names a role that does not.',
  ),
  outbox_requires_app_database_url: pass(
    'The mail sender needs `ODUDU_APP_DATABASE_URL` to claim messages under the tenant policy.',
  ),
  outbox_serving_role_bypasses_rls: pass(
    '`ODUDU_APP_DATABASE_URL` names a superuser or BYPASSRLS role, so the mail sender would not ' +
      'claim messages under the tenant policy.',
  ),
  logout_sender_cannot_enumerate_tenants: pass(
    'The logout sender must list every tenant, which needs a connection that bypasses row-level ' +
      'security, and `ODUDU_DATABASE_URL` names a role that does not.',
  ),
  logout_sender_requires_app_database_url: pass(
    'The logout sender needs `ODUDU_APP_DATABASE_URL` to claim deliveries under the tenant policy.',
  ),
  logout_sender_serving_role_bypasses_rls: pass(
    '`ODUDU_APP_DATABASE_URL` names a superuser or BYPASSRLS role, so the logout sender would not ' +
      'claim deliveries under the tenant policy.',
  ),
  domain_assume_verified_production: command(
    '`odudu seed domain --assume-verified` was run with `NODE_ENV=production`. It marks a domain ' +
      'verified without a DNS lookup, so a production deployment cannot use it; publish the ' +
      'challenge record and verify the domain instead.',
  ),
  domains_unknown_command: command('`odudu domains` was given a subcommand it does not have.'),
  domain_recheck_cannot_read_every_tenant: pass(
    '`odudu domains recheck` must read the verified domains of every tenant, which needs a ' +
      'connection that bypasses row-level security, and `ODUDU_DATABASE_URL` names a role that ' +
      'does not.',
  ),
  domain_recheck_requires_app_database_url: pass(
    '`odudu domains recheck` writes under the tenant policy and so needs ' +
      '`ODUDU_APP_DATABASE_URL`; the owner role escapes the policy.',
  ),
  domain_recheck_serving_role_bypasses_rls: pass(
    '`ODUDU_APP_DATABASE_URL` names a superuser or BYPASSRLS role, so `odudu domains recheck` ' +
      'would not write under the tenant policy.',
  ),
  kek_invalid: crypto('The key-encryption key is not 32 bytes.'),
  client_key_invalid: crypto(
    'The console client key is not base64-encoded JSON, or is not an EC P-256 key with its ' +
      'public coordinates.',
  ),
  signing_key_not_found: crypto('The tenant has no active signing key to sign with.'),
  jwt_header_invalid: crypto('A token has no readable header.'),
  jwt_kid_missing: crypto('A token header carries no `kid`, so no key can be chosen to verify it.'),
  jwt_unknown_key: crypto('A token header names a `kid` that is not one of the tenant’s keys.'),
  jwt_alg_mismatch: crypto(
    'A token header’s `alg` is not the algorithm of the key its `kid` names.',
  ),
  jwt_typ_mismatch: crypto('A token’s `typ` is one that must not be accepted at this endpoint.'),
  jwe_alg_unsupported: crypto(
    'An encrypted response was asked for with a key-management algorithm that is not one of ' +
      'the permitted ones.',
  ),
  insert_returned_no_row: crypto(
    'A signing key insert returned no row, which the database should never do.',
  ),
  tenant_context_missing: data(
    'A tenant-scoped query was started without a valid tenant id, so it was refused rather than ' +
      'run unscoped.',
  ),
  claim_mapper_duplicate: data('Two claim mappers registered under the same name.'),
  invalid_email: data('An email address is not well formed.'),
  bidi_control_refused: data(
    'A typed field holds a bidirectional control character (U+202A to U+202E, U+2066 to U+2069).',
  ),
  role_not_found: data('A role that was expected to exist does not.'),
  role_composite_cycle: data('Adding the composite role would make a role contain itself.'),
  group_not_found: data('There is no group with that id.'),
  group_reparent_cycle: data('Moving the group under that parent would make it its own ancestor.'),
  client_scope_not_found: data('There is no client scope with that id.'),
  user_not_found: data('There is no user for that subject.'),
  subject_not_found: data('There is no subject with that id.'),
  credential_not_found: data('There is no credential with that id.'),
  tenant_not_found: data('There is no tenant with that id in the current context.'),
};
