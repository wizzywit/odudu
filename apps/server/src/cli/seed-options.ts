import { cliOptions, flag, text, texts, type CliOption } from '#/cli/command-types';

// Exported so main.ts can tell, before parsing anything, whether an
// invocation names one of these subcommands or is the older
// seedClientBootstrap form (`seed --tenant ... --client ...`) — the two
// argv shapes are otherwise indistinguishable from the outside.
export const SEED_COMMANDS = [
  'tenant',
  'client',
  'user',
  'role',
  'group',
  'scope',
  'assign-scope',
  'restore-scopes',
  'map-role',
  'grant-role',
  'map-group-role',
  'join-group',
  'profile',
  'registration-token',
  'admin',
  'domain',
] as const;

export type SeedCommand = (typeof SEED_COMMANDS)[number];

const TENANT = text('Name of the tenant the command acts in.', true);
const CLIENT_ID = text('The client_id of the client the command acts on.', true);
const USERNAME = text('Username of the user the command acts on.', true);
const ROLE = text('Role name, qualified by its client for a client role.', true);

export const TENANT_OPTIONS = {
  name: text('Name of the tenant to create, or to update when it exists.', true),
  set: texts('A tenant setting as name=value.'),
} as const;

export const CLIENT_OPTIONS = {
  tenant: TENANT,
  'client-id': text(
    'The client_id to create. The command fails if that client exists; change an existing client in the console or the admin API.',
    true,
  ),
  public: flag('Register a public client; accepts --public or --client-secret, not both.'),
  'client-secret': text('Register a confidential client with this secret instead.'),
  'token-endpoint-auth-method': text(
    'client_secret_basic or client_secret_post, for a confidential client.',
  ),
  'redirect-uri': texts(
    "A redirect URI the client may use. Switching the tenant's address does not change it.",
  ),
  'post-logout-redirect-uri': texts(
    "A URI the client may send users to after logout. Switching the tenant's address does not change it.",
  ),
  'web-origin': texts(
    "A browser origin allowed to call the endpoints. Switching the tenant's address does not change it.",
  ),
  'allow-action': texts(
    'A required action the client may start through the authorization request: update-password, configure-totp, configure-passkey or generate-recovery-codes. Assigns me:read to the client, which the actions need.',
  ),
  audience: texts(
    "A resource indicator (RFC 8707) the client may ask for, such as a tenant's MCP address; a token carries it as an audience.",
  ),
  'grant-type': texts('A grant type the client may use.'),
  'consent-required': flag('Ask people to allow access the first time they sign in.'),
  'token-exchange-allowed-for-public': flag(
    'Let a public client use the token-exchange grant; needs --public and that grant.',
  ),
  'token-exchange-actor-from-other-client': flag(
    'Accept an actor token issued to another client in a token exchange; needs the token-exchange grant.',
  ),
  'client-credentials-scope': texts(
    'A scope a service may ask for with the client_credentials grant; a service gets none without it.',
  ),
} as const;

export const USER_OPTIONS = {
  tenant: TENANT,
  username: text('Username of the user to create.', true),
  password: text('The initial password; it must satisfy the tenant policy.', true),
  email: text('The email address of the user.'),
  'email-verified': flag('Record the email address as verified; needs --email.'),
  'require-password-change': flag('Make the user choose a new password at first login.'),
} as const;

export const ROLE_OPTIONS = {
  tenant: TENANT,
  name: text('Name of the role to create.', true),
  'client-id': text('Make this a client role owned by that client.'),
} as const;

export const GROUP_OPTIONS = {
  tenant: TENANT,
  name: text('Name of the group to create.', true),
  parent: text('Path of the parent group; omit for a top-level group.'),
} as const;

export const SCOPE_OPTIONS = {
  tenant: TENANT,
  name: text('Name of the client scope to create. The command fails if it exists.', true),
  description: text('A description of the scope.'),
  'include-in-id-token': text('true or false: put the scope claims in the ID token.'),
  'include-in-access-token': text('true or false: put the scope claims in the access token.'),
} as const;

export const ASSIGN_SCOPE_OPTIONS = {
  tenant: TENANT,
  'client-id': CLIENT_ID,
  scope: text('Name of the client scope to assign.', true),
  assignment: text('default or optional.', true),
} as const;

export const RESTORE_SCOPES_OPTIONS = { tenant: TENANT } as const;

export const MAP_ROLE_OPTIONS = {
  tenant: TENANT,
  scope: text('Name of the client scope whose tokens carry the role.', true),
  role: ROLE,
} as const;

export const GRANT_ROLE_OPTIONS = { tenant: TENANT, username: USERNAME, role: ROLE } as const;

export const MAP_GROUP_ROLE_OPTIONS = {
  tenant: TENANT,
  group: text('Path of the group that receives the role.', true),
  role: ROLE,
} as const;

export const JOIN_GROUP_OPTIONS = {
  tenant: TENANT,
  username: USERNAME,
  group: text('Path of the group to join.', true),
} as const;

export const PROFILE_OPTIONS = {
  tenant: TENANT,
  username: USERNAME,
  name: text('Full name of the user.'),
  'given-name': text('Given name of the user.'),
  'family-name': text('Family name of the user.'),
  'middle-name': text('Middle name of the user.'),
  nickname: text('Nickname of the user.'),
  'preferred-username': text('The preferred_username claim of the user.'),
  profile: text('URL of the profile page of the user.'),
  picture: text('URL of the picture of the user.'),
  website: text('URL of the website of the user.'),
  gender: text('Gender of the user.'),
  birthdate: text('Birthdate of the user, as YYYY-MM-DD.'),
  zoneinfo: text('Time zone of the user, such as Europe/Berlin.'),
  locale: text('Locale of the user, such as de-DE.'),
  'phone-number': text('Phone number of the user.'),
  'email-verified': flag('Record the email address as verified; the user needs one.'),
  'phone-number-verified': flag('Record the phone number as verified.'),
  'address-formatted': text('The whole postal address as one string.'),
  'address-street': text('Street part of the postal address.'),
  'address-locality': text('City part of the postal address.'),
  'address-region': text('State or region part of the postal address.'),
  'address-postal-code': text('Postal code part of the postal address.'),
  'address-country': text('Country part of the postal address.'),
} as const;

export const REGISTRATION_TOKEN_OPTIONS = {
  tenant: TENANT,
  uses: text('How many registrations the token may authorise.', true),
  ttl: text('How long the token is valid, in seconds.', true),
} as const;

export const DOMAIN_OPTIONS = {
  tenant: TENANT,
  host: text('The host to serve the tenant on, such as login.acme.org.', true),
  canonical: flag(
    'Make the domain the tenant\u2019s canonical address; the domain must be verified.',
  ),
  'assume-verified': flag(
    'Mark the domain verified without a DNS lookup. Refused when NODE_ENV is production.',
  ),
} as const;

export const ADMIN_OPTIONS = {
  username: text('Username of the system-tenant administrator.', true),
} as const;

// Each subcommand's option table is the one its runner hands to parseArgs,
// worded for `odudu help`.
export const SEED_COMMAND_OPTIONS: Record<SeedCommand, readonly CliOption[]> = {
  tenant: cliOptions(TENANT_OPTIONS),
  client: cliOptions(CLIENT_OPTIONS),
  user: cliOptions(USER_OPTIONS),
  role: cliOptions(ROLE_OPTIONS),
  group: cliOptions(GROUP_OPTIONS),
  scope: cliOptions(SCOPE_OPTIONS),
  'assign-scope': cliOptions(ASSIGN_SCOPE_OPTIONS),
  'restore-scopes': cliOptions(RESTORE_SCOPES_OPTIONS),
  'map-role': cliOptions(MAP_ROLE_OPTIONS),
  'grant-role': cliOptions(GRANT_ROLE_OPTIONS),
  'map-group-role': cliOptions(MAP_GROUP_ROLE_OPTIONS),
  'join-group': cliOptions(JOIN_GROUP_OPTIONS),
  profile: cliOptions(PROFILE_OPTIONS),
  'registration-token': cliOptions(REGISTRATION_TOKEN_OPTIONS),
  admin: cliOptions(ADMIN_OPTIONS),
  domain: cliOptions(DOMAIN_OPTIONS),
};

// The options of `seed` without a subcommand, which creates a client in one
// call. Read by parseArgs below and rendered by `odudu help seed`.
export const SEED_BOOTSTRAP_OPTIONS = {
  tenant: text('Name of the tenant to create the client in.', true),
  client: text('The client_id to create.', true),
  'client-secret': text('Register a confidential client with this secret.'),
  'token-endpoint-auth-method': text(
    'client_secret_basic or client_secret_post, for a confidential client.',
  ),
  'redirect-uri': texts('A redirect URI the client may use.'),
  user: text('Username of a user to create with the client.'),
  password: text('The password of that user.'),
  email: text('The email address of that user.'),
  'send-verification-email': flag('Queue a verification email for that user.'),
  'issuer-base': text('Base URL of the verification link. Defaults to ODUDU_PUBLIC_BASE_URL.'),
} as const;

export const SEED_BOOTSTRAP_HELP = cliOptions(SEED_BOOTSTRAP_OPTIONS);

export const ASSERTION_OPTIONS = {
  tenant: text('Name of the tenant whose token endpoint it is for.', true),
} as const;
