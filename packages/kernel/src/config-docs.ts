import { z } from 'zod';
import { configSchema, loadConfig } from '#/config';

export type ConfigKey = keyof typeof configSchema.shape;

export type ConfigGroup =
  | 'Server'
  | 'Database'
  | 'Encryption'
  | 'Rate limits'
  | 'Retention'
  | 'Background passes'
  | 'Mail'
  | 'Admin console'
  | 'Outbound requests';

export const CONFIG_GROUPS: readonly ConfigGroup[] = [
  'Server',
  'Database',
  'Encryption',
  'Rate limits',
  'Retention',
  'Background passes',
  'Mail',
  'Admin console',
  'Outbound requests',
];

interface ConfigDoc {
  readonly group: ConfigGroup;
  readonly summary: string;
  // A secret has no default printed and is described as one wherever it is listed.
  readonly secret: boolean;
  // The condition under which the server refuses to start without it, for a key the schema leaves optional.
  readonly requiredWhen?: string;
}

function retention(summary: string): ConfigDoc {
  return { group: 'Retention', summary, secret: false };
}

function limit(summary: string): ConfigDoc {
  return { group: 'Rate limits', summary, secret: false };
}

// Typed over the schema's own keys, so a key added to the loader without an
// entry here, or an entry for a key the loader dropped, fails to compile.
export const CONFIG_DOCS: Record<ConfigKey, ConfigDoc> = {
  NODE_ENV: {
    group: 'Server',
    summary:
      'The environment the server runs in. `production` makes the server refuse to boot ' +
      'unless it has `ODUDU_APP_DATABASE_URL`, `ODUDU_TLS=true`, `ODUDU_PUBLIC_BASE_URL` and a ' +
      '`ODUDU_KEK` that is not the published example, and with `ODUDU_ALLOW_PRIVATE_CLIENT_URLS` off.',
    secret: false,
  },
  ODUDU_HTTP_HOST: {
    group: 'Server',
    summary: 'The address the HTTP server listens on.',
    secret: false,
  },
  ODUDU_HTTP_PORT: {
    group: 'Server',
    summary: 'The port the HTTP server listens on.',
    secret: false,
  },
  ODUDU_DATABASE_URL: {
    group: 'Database',
    summary:
      'The PostgreSQL connection URL of the owner role. The server applies migrations with ' +
      'it at start and `odudu init` creates the service role with it. It can switch row-level ' +
      'security off, so production serves traffic through `ODUDU_APP_DATABASE_URL` instead.',
    secret: true,
  },
  ODUDU_MIGRATIONS_DIR: {
    group: 'Database',
    summary: 'A directory of migrations to apply in place of the ones built into the release.',
    secret: false,
  },
  ODUDU_APP_DATABASE_URL: {
    group: 'Database',
    summary:
      'The PostgreSQL connection URL of the role the server serves traffic with, which ' +
      'row-level security applies to. Required when `NODE_ENV=production`. Commands that ' +
      'read every tenant refuse a role that is a superuser or bypasses row-level security.',
    secret: true,
    requiredWhen: '`NODE_ENV` is `production`',
  },
  ODUDU_TRUST_PROXY: {
    group: 'Server',
    summary:
      'Whether to trust what a reverse proxy in front of the server reports about the client: ' +
      'its address, which is recorded in audit events and keys the rate limits. It does not ' +
      'decide the issuer or any cookie. Turn it on only behind a proxy that overwrites ' +
      '`X-Forwarded-*`.',
    secret: false,
  },
  ODUDU_TLS_CLIENT_CERT_HEADER: {
    group: 'Server',
    summary:
      'The header a proxy puts the subject of a client certificate in, read for ' +
      '`tls_client_auth` at the token endpoint and only while `ODUDU_TRUST_PROXY` is on. ' +
      'Compared in lower case.',
    secret: false,
  },
  ODUDU_TLS: {
    group: 'Server',
    summary:
      'States that the connection to the user is HTTPS, terminated here or by a proxy in ' +
      'front of the server. It gives every cookie `Secure` and a `__Host-` or `__Secure-` name, and ' +
      '`NODE_ENV=production` refuses to boot while it is off.',
    secret: false,
    requiredWhen: '`NODE_ENV` is `production`, where it must be `true`',
  },
  ODUDU_THROTTLE_LIMIT: limit(
    'Requests allowed per origin in each window on the routes that cost a password hash or a ' +
      'mail send. Over the budget the server answers `429`.',
  ),
  ODUDU_THROTTLE_WINDOW_SECONDS: limit('The length of the per-origin window, in seconds.'),
  ODUDU_LOGIN_THROTTLE_LIMIT: limit(
    'Sign-in submissions allowed per address and username in each window.',
  ),
  ODUDU_LOGIN_THROTTLE_WINDOW_SECONDS: limit('The length of the sign-in window, in seconds.'),
  ODUDU_CLIENT_SECRET_THROTTLE_LIMIT: limit(
    'Failed `client_secret_basic` and `client_secret_post` attempts allowed per client in ' +
      'each window at the token endpoint.',
  ),
  ODUDU_CLIENT_SECRET_THROTTLE_WINDOW_SECONDS: limit(
    'The length of the client secret window, in seconds.',
  ),
  ODUDU_RETENTION_GRANT_SECONDS: retention(
    'How long `odudu reap` keeps a grant (refresh token family) after nothing can read it. ' +
      'A retention window, not a lifespan: it can raise how long rows are kept, never lower it ' +
      'below what reuse detection needs.',
  ),
  ODUDU_RETENTION_OFFLINE_GRANT_SECONDS: retention(
    'The retention window of an offline grant, the same kind of window as ' +
      '`ODUDU_RETENTION_GRANT_SECONDS`.',
  ),
  ODUDU_RETENTION_AUTHORIZATION_CODE_SECONDS: retention(
    'How long an authorization code that never produced a grant is kept. A code that did is ' +
      'removed with the grant family it produced.',
  ),
  ODUDU_RETENTION_AUTHENTICATION_SESSION_SECONDS: retention(
    'How long a finished or expired sign-in attempt is kept. This is where most of the ' +
      'rows are.',
  ),
  ODUDU_RETENTION_ACTION_TOKEN_SECONDS: retention(
    'How long a spent or expired mailed action token, or a registration nobody opened, is kept.',
  ),
  ODUDU_RETENTION_REGISTRATION_TOKEN_SECONDS: retention(
    'How long a spent or expired registration token is kept.',
  ),
  ODUDU_RETENTION_SESSION_SECONDS: retention('How long an ended or expired user session is kept.'),
  ODUDU_RETENTION_EMAIL_SENT_SECONDS: retention(
    'How long a delivered email stays in the outbox, counted from its delivery, so an ' +
      'operator can answer whether a link ever went out.',
  ),
  ODUDU_RETENTION_EMAIL_FAILED_SECONDS: retention(
    'How long an email that used up every attempt stays, counted from its last attempt. Long, ' +
      'because nothing else records the failure.',
  ),
  ODUDU_RETENTION_LOGOUT_DELIVERED_SECONDS: retention(
    'How long a delivered back-channel logout is kept, counted from its delivery.',
  ),
  ODUDU_RETENTION_LOGOUT_FAILED_SECONDS: retention(
    'How long a back-channel logout that used up every attempt is kept, counted from its ' +
      'last attempt.',
  ),
  ODUDU_RETENTION_PENDING_DOMAIN_SECONDS: retention(
    'How long a custom domain that was registered and never verified is kept, counted from ' +
      'its registration. A verified domain is never removed by `odudu reap`.',
  ),
  ODUDU_REAP_ENABLED: {
    group: 'Background passes',
    summary:
      'Whether the server runs the retention pass itself. Set it to `false` when you ' +
      'schedule `odudu reap` externally, for example as a cron entry or a Kubernetes CronJob.',
    secret: false,
  },
  ODUDU_REAP_INTERVAL_SECONDS: {
    group: 'Background passes',
    summary: 'Seconds between retention passes, plus up to a tenth of that as random jitter.',
    secret: false,
  },
  ODUDU_DOMAIN_RECHECK_ENABLED: {
    group: 'Background passes',
    summary:
      'Whether the server rechecks the ownership of custom domains itself. Set it to `false` ' +
      'when you schedule `odudu domains recheck`; with neither running, a domain that stops ' +
      'proving ownership keeps serving.',
    secret: false,
  },
  ODUDU_DOMAIN_RECHECK_INTERVAL_SECONDS: {
    group: 'Background passes',
    summary:
      'Seconds between ownership rechecks of custom domains, plus up to a tenth of that as ' +
      'random jitter.',
    secret: false,
  },
  ODUDU_DOMAIN_RECHECK_FAILURES: {
    group: 'Background passes',
    summary:
      'Consecutive rechecks that find no matching DNS record before a custom domain fails ' +
      'and its tenant returns to the path address. A resolver error counts as nothing.',
    secret: false,
  },
  ODUDU_OUTBOX_ENABLED: {
    group: 'Background passes',
    summary:
      'Whether the server sends queued email itself. Set it to `false` when you schedule ' +
      '`odudu send-mail`; with neither running, queued mail is never sent.',
    secret: false,
  },
  ODUDU_OUTBOX_INTERVAL_SECONDS: {
    group: 'Background passes',
    summary: 'Seconds between passes that send queued email.',
    secret: false,
  },
  ODUDU_OUTBOX_BATCH_SIZE: {
    group: 'Background passes',
    summary:
      'Messages sent per tenant in one pass, so one tenant’s backlog cannot starve another’s.',
    secret: false,
  },
  ODUDU_OUTBOX_MAX_ATTEMPTS: {
    group: 'Background passes',
    summary:
      'Attempts a message gets before it is left for an operator to read. Lowering it ' +
      'reclassifies messages already queued: one past the new ceiling stops being retried and ' +
      'starts its failed-email retention window.',
    secret: false,
  },
  ODUDU_OUTBOX_RETRY_BACKOFF_SECONDS: {
    group: 'Background passes',
    summary: 'The delay before the first retry of a message; each further attempt doubles it.',
    secret: false,
  },
  ODUDU_LOGOUT_SENDER_ENABLED: {
    group: 'Background passes',
    summary:
      'Whether the server delivers back-channel logout tokens itself. Set it to `false` when ' +
      'you schedule `odudu send-logouts`; with neither running, relying parties of an ended ' +
      'session are never told.',
    secret: false,
  },
  ODUDU_LOGOUT_SENDER_INTERVAL_SECONDS: {
    group: 'Background passes',
    summary: 'Seconds between passes that deliver back-channel logout tokens.',
    secret: false,
  },
  ODUDU_LOGOUT_SENDER_BATCH_SIZE: {
    group: 'Background passes',
    summary: 'Deliveries claimed per tenant in one pass.',
    secret: false,
  },
  ODUDU_LOGOUT_SENDER_LEASE_SECONDS: {
    group: 'Background passes',
    summary:
      'How long a claimed delivery stays invisible to other passes: what a process killed ' +
      'between claiming and sending costs.',
    secret: false,
  },
  ODUDU_LOGOUT_SENDER_RESPONSE_TIMEOUT_MS: {
    group: 'Background passes',
    summary:
      'Milliseconds one delivery may take, connecting and answering together, before it is ' +
      'abandoned for this pass.',
    secret: false,
  },
  ODUDU_LOG_LEVEL: {
    group: 'Server',
    summary: 'The lowest severity the server logs. `silent` logs nothing.',
    secret: false,
  },
  ODUDU_KEK: {
    group: 'Encryption',
    summary:
      'The key-encryption key: 32 random bytes, base64-encoded. It wraps every signing key and ' +
      'console session token and keys pagination cursors, so changing it makes the stored ' +
      'keys unreadable. Generate one with `openssl rand -base64 32`.',
    secret: true,
  },
  ODUDU_SMTP_HOST: {
    group: 'Mail',
    summary:
      'The SMTP relay to send mail through. Unset, the server logs each message instead of ' +
      'sending it. Needs `ODUDU_SMTP_FROM`.',
    secret: false,
  },
  ODUDU_SMTP_PORT: { group: 'Mail', summary: 'The port of the SMTP relay.', secret: false },
  ODUDU_SMTP_FROM: {
    group: 'Mail',
    summary: 'The address mail is sent from. Required when `ODUDU_SMTP_HOST` is set.',
    secret: false,
    requiredWhen: '`ODUDU_SMTP_HOST` is set',
  },
  ODUDU_SMTP_USERNAME: {
    group: 'Mail',
    summary: 'The user name to authenticate to the SMTP relay with.',
    secret: false,
  },
  ODUDU_SMTP_PASSWORD: {
    group: 'Mail',
    summary: 'The password to authenticate to the SMTP relay with.',
    secret: true,
  },
  ODUDU_SMTP_STARTTLS: {
    group: 'Mail',
    summary:
      'Whether to require STARTTLS before sending. It is required whenever ' +
      '`ODUDU_SMTP_USERNAME` and `ODUDU_SMTP_PASSWORD` are set, so credentials never travel in ' +
      'the clear.',
    secret: false,
  },
  ODUDU_PUBLIC_BASE_URL: {
    group: 'Server',
    summary:
      'The origin the server is reached at, with no path: the issuer of every tenant, the base ' +
      'every mailed link and the console’s redirect URI are built from, and the source of the ' +
      'passkey relying party id. Never taken from a request header. Required when ' +
      '`NODE_ENV=production`. Without it (local development) the issuer is read from the request.',
    secret: false,
    requiredWhen:
      'the console is on (`ODUDU_CONSOLE`, which defaults to `true`) or `NODE_ENV` is `production`',
  },
  ODUDU_CONSOLE: {
    group: 'Admin console',
    summary:
      'Whether the server serves the admin console under `/console`. While on it needs ' +
      '`ODUDU_PUBLIC_BASE_URL` and `ODUDU_CONSOLE_CLIENT_KEY`.',
    secret: false,
  },
  ODUDU_CONSOLE_CLIENT_KEY: {
    group: 'Admin console',
    summary:
      'The private key the console authenticates with as every tenant’s built-in admin ' +
      'client: an ES256 JWK, base64-encoded. `odudu console keygen` prints a new one. Required ' +
      'while the console is on.',
    secret: true,
    requiredWhen: 'the console is on (`ODUDU_CONSOLE`, which defaults to `true`)',
  },
  ODUDU_CONSOLE_CLIENT_KEY_PREVIOUS: {
    group: 'Admin console',
    summary:
      'The key being replaced, kept registered on every tenant until the pass that drops ' +
      'it. A private or a public JWK, base64-encoded; only the public half is used.',
    secret: true,
  },
  ODUDU_CONSOLE_DIR: {
    group: 'Admin console',
    summary: 'The directory of the built console’s static files, as the release image lays it out.',
    secret: false,
  },
  ODUDU_INSTRUMENT_DIR: {
    group: 'Server',
    summary: 'The directory of the stylesheet and fonts every server-rendered page links.',
    secret: false,
  },
  ODUDU_DOCS: {
    group: 'Server',
    summary:
      'Whether the server serves its documentation under `/docs`, on its own address. Set ' +
      '`false` to turn the route off; `/docs` then answers `404`.',
    secret: false,
  },
  ODUDU_DOCS_DIR: {
    group: 'Server',
    summary:
      'The directory of the built documentation, as the release image lays it out. A ' +
      'directory with no build, or one that is not the build, makes the documentation answer `503` ' +
      'and the log names this variable; the rest of the server starts.',
    secret: false,
  },
  ODUDU_ALLOW_PRIVATE_CLIENT_URLS: {
    group: 'Outbound requests',
    summary:
      'Lets the server fetch a client’s `jwks_uri` or send its back-channel logout to a ' +
      'private address. For development and conformance testing; `NODE_ENV=production` ' +
      'refuses to boot with it on. A loopback address is refused regardless.',
    secret: false,
  },
  ODUDU_ALLOW_PRIVATE_SMTP_HOSTS: {
    group: 'Outbound requests',
    summary:
      'Lets a tenant’s own SMTP relay (set through the admin API) be at a private address, ' +
      'which an internal relay legitimately is. Not refused under `NODE_ENV=production`. ' +
      'Loopback, link-local and multicast addresses are refused regardless.',
    secret: false,
  },
};

// The keys the loader cannot do without, with values it accepts: what the
// effective defaults below are read from.
export const REQUIRED_PROBE = {
  ODUDU_DATABASE_URL: 'postgres://user:password@localhost:5432/odudu',
  ODUDU_KEK: Buffer.alloc(32, 1).toString('base64'),
} as const;

export interface ConfigReference {
  readonly name: ConfigKey;
  readonly group: ConfigGroup;
  readonly kind: 'string' | 'integer' | 'boolean' | 'enum' | 'url';
  readonly required: boolean;
  // What the loader produces when the variable is absent, as it is written in an environment.
  readonly default: string | undefined;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly values?: readonly string[];
  readonly summary: string;
  readonly secret: boolean;
  readonly requiredWhen?: string;
}

interface PropertySchema {
  readonly type?: unknown;
  readonly format?: unknown;
  readonly enum?: unknown;
  readonly minimum?: unknown;
  readonly maximum?: unknown;
}

function kindOf(
  property: PropertySchema,
  values: readonly string[] | undefined,
): ConfigReference['kind'] {
  if (values !== undefined) {
    return values.length === 2 && values.includes('true') && values.includes('false')
      ? 'boolean'
      : 'enum';
  }
  if (property.type === 'integer' || property.type === 'number') return 'integer';
  return property.format === 'uri' ? 'url' : 'string';
}

function written(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function strings(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    ? value
    : undefined;
}

// Read from the loader itself: its schema for type and bounds, and what it
// produces from an environment holding only the required keys for the default,
// since a switch's default lives in a transform the schema cannot show.
export function configReference(): readonly ConfigReference[] {
  const json = z.toJSONSchema(configSchema, { io: 'input', unrepresentable: 'any' });
  const required = new Set(json.required ?? []);
  const loaded: Readonly<Record<string, unknown>> = loadConfig(REQUIRED_PROBE);

  return (Object.keys(configSchema.shape) as ConfigKey[]).map((name) => {
    const property = (json.properties?.[name] ?? {}) as PropertySchema;
    const docs = (CONFIG_DOCS as Partial<Record<ConfigKey, ConfigDoc>>)[name];
    if (docs === undefined) {
      throw new Error(`${name} is accepted by the loader but has no entry in CONFIG_DOCS`);
    }
    const values = strings(property.enum);
    const isRequired = required.has(name);
    return {
      name,
      group: docs.group,
      kind: kindOf(property, values),
      required: isRequired,
      default: docs.secret || isRequired ? undefined : written(loaded[name]),
      ...(typeof property.minimum === 'number' ? { minimum: property.minimum } : {}),
      ...(typeof property.maximum === 'number' ? { maximum: property.maximum } : {}),
      ...(values === undefined || kindOf(property, values) === 'boolean' ? {} : { values }),
      summary: docs.summary,
      secret: docs.secret,
      ...(docs.requiredWhen === undefined ? {} : { requiredWhen: docs.requiredWhen }),
    };
  });
}

// Read from the environment by a command or the image, not by the loader.
export const OUTSIDE_LOADER_ENV = {
  ODUDU_ADMIN_EMAIL:
    'The address `odudu init` gives the first administrator when `--admin-email` is not passed. ' +
    'A blank value counts as unset.',
  ODUDU_ADMIN_PASSWORD:
    'The password `odudu init` gives the first administrator in place of a generated one. It is ' +
    'an environment variable and never an option, so it does not appear in a process listing. ' +
    'A blank value counts as unset.',
  ODUDU_MCP_KEY:
    'The service account key `odudu mcp` signs in with, the one line `odudu mcp --keygen` prints. ' +
    'An environment variable rather than an option so it is not in a process listing; `--key-file` ' +
    'names a file holding the same value instead, and the two are not both given.',
  ODUDU_MCP_CLIENT_ID:
    'The `client_id` of the service account `ODUDU_MCP_KEY` belongs to, when `odudu mcp` is not ' +
    'given `--client-id`.',
  ODUDU_VERSION:
    'The version `odudu --version` prints. The release image sets it; elsewhere it is `dev`.',
} as const;

export type OutsideLoaderKey = keyof typeof OUTSIDE_LOADER_ENV;
