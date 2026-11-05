import { cliOptions, type CliCommand } from '#/cli/command-types';
import { INIT_OPTIONS } from '#/cli/init-options';
import {
  ASSERTION_OPTIONS,
  SEED_BOOTSTRAP_HELP,
  SEED_COMMAND_OPTIONS,
  SEED_COMMANDS,
} from '#/cli/seed-options';

export type { CliCommand, CliOption } from '#/cli/command-types';

const NONE: readonly CliCommand[] = [];

const SEED_SUMMARIES: Record<(typeof SEED_COMMANDS)[number], string> = {
  tenant: 'Create a tenant with its signing key, or change its settings.',
  client: 'Register an OAuth client in a tenant.',
  user: 'Create a user with a password.',
  role: 'Create a role, tenant-wide or owned by a client.',
  group: 'Create a group, optionally under a parent group.',
  scope: 'Create or update a client scope.',
  'assign-scope': 'Assign a client scope to a client as default or optional.',
  'restore-scopes':
    'Create the built-in client scopes a tenant has lost, with their shipped settings.',
  'map-role': 'Make a client scope carry a role.',
  'grant-role': 'Grant a role to a user.',
  'map-group-role': 'Give every member of a group a role.',
  'join-group': 'Add a user to a group.',
  profile: 'Set the standard profile claims of a user.',
  'registration-token': 'Mint an initial access token for dynamic client registration.',
  admin: 'Create an administrator in the system tenant and print a one-time password.',
  domain: 'Register a domain for a tenant, optionally verified and canonical.',
};

const SEED_EXAMPLES: Record<(typeof SEED_COMMANDS)[number], string> = {
  tenant: 'odudu seed tenant --name acme --set registration_allowed=true',
  client:
    'odudu seed client --tenant acme \\\n    --client-id web --public --redirect-uri https://app.example/cb',
  user: 'odudu seed user --tenant acme \\\n    --username ada --password "a long passphrase"',
  role: 'odudu seed role --tenant acme --name editor',
  group: 'odudu seed group --tenant acme --name staff',
  scope: 'odudu seed scope --tenant acme --name reports',
  'assign-scope':
    'odudu seed assign-scope --tenant acme \\\n    --client-id web --scope reports --assignment default',
  'restore-scopes': 'odudu seed restore-scopes --tenant acme',
  'map-role': 'odudu seed map-role --tenant acme --scope reports --role editor',
  'grant-role': 'odudu seed grant-role --tenant acme --username ada --role editor',
  'map-group-role': 'odudu seed map-group-role --tenant acme --group /staff --role editor',
  'join-group': 'odudu seed join-group --tenant acme --username ada --group /staff',
  profile: 'odudu seed profile --tenant acme --username ada --given-name Ada',
  'registration-token': 'odudu seed registration-token --tenant acme --uses 1 --ttl 3600',
  admin: 'odudu seed admin --username root',
  domain: 'odudu seed domain --tenant acme --host login.acme.org',
};

const SEED_SUBCOMMANDS: readonly CliCommand[] = SEED_COMMANDS.map((name) => ({
  name,
  summary: SEED_SUMMARIES[name],
  options: SEED_COMMAND_OPTIONS[name],
  subcommands: NONE,
  example: SEED_EXAMPLES[name],
}));

export const CLI_COMMANDS: readonly CliCommand[] = [
  {
    name: '--version',
    summary: 'Print the version of this build, or dev outside a release image.',
    options: [],
    subcommands: NONE,
    example: 'odudu --version',
  },
  {
    name: 'help',
    summary: 'Print the commands, or the options of one command. Also --help and -h.',
    options: [],
    subcommands: NONE,
    example: 'odudu help seed client',
  },
  {
    name: 'init',
    summary:
      'Create the database roles, migrate, create the system tenant and the first ' +
      'administrator, and write quickstart.env. Safe to run again.',
    options: cliOptions(INIT_OPTIONS),
    subcommands: NONE,
    example: 'odudu init --admin-email ada@example.com',
  },
  {
    name: 'reap',
    summary:
      'Delete expired and retention-bound rows in every tenant and print the counts as JSON.',
    options: [],
    subcommands: NONE,
    example: 'odudu reap',
  },
  {
    name: 'domains',
    summary: 'Operate on custom domains.',
    options: [],
    subcommands: [
      {
        name: 'recheck',
        summary:
          'Look up the ownership record of every verified custom domain once, fail the ones ' +
          'that stopped proving it and print the counts as JSON.',
        options: [],
        subcommands: NONE,
        example: 'odudu domains recheck',
      },
    ],
    example: 'odudu domains recheck',
  },
  {
    name: 'send-mail',
    summary: 'Deliver the queued emails once and print the outcome as JSON.',
    options: [],
    subcommands: NONE,
    example: 'odudu send-mail',
  },
  {
    name: 'send-logouts',
    summary: 'Deliver the queued back-channel logout tokens once and print the outcome as JSON.',
    options: [],
    subcommands: NONE,
    example: 'odudu send-logouts',
  },
  {
    name: 'console',
    summary: 'Provision the admin console for every tenant, generate its key or sign in as it.',
    options: [],
    subcommands: [
      {
        name: 'provision',
        summary:
          'Register the console client in every tenant; run after changing the console settings.',
        options: [],
        subcommands: NONE,
        example: 'odudu console provision',
      },
      {
        name: 'keygen',
        summary: 'Print a new ODUDU_CONSOLE_CLIENT_KEY line for the environment.',
        options: [],
        subcommands: NONE,
        example: 'odudu console keygen',
      },
      {
        name: 'assertion',
        summary: 'Print a one-minute client assertion that authenticates the console client.',
        options: cliOptions(ASSERTION_OPTIONS),
        subcommands: NONE,
        example: 'odudu console assertion --tenant acme',
      },
    ],
    example: 'odudu console provision',
  },
  {
    name: 'client-origins',
    summary: 'Rebuild the stored client origins after upgrading past the migration adding them.',
    options: [],
    subcommands: [
      {
        name: 'rebuild',
        summary: 'Rewrite every client origin from its web origins and redirect URIs.',
        options: [],
        subcommands: NONE,
        example: 'odudu client-origins rebuild',
      },
    ],
    example: 'odudu client-origins rebuild',
  },
  {
    name: 'seed',
    summary:
      'Create tenants, clients, users, roles, groups and scopes. Without a subcommand it ' +
      'creates a client in one call.',
    options: SEED_BOOTSTRAP_HELP,
    subcommands: SEED_SUBCOMMANDS,
    example: 'odudu seed tenant --name acme',
  },
];
