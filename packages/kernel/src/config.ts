import { z } from 'zod';
import { OduduError } from '#/errors';

// z.coerce.boolean() coerces any non-empty string, including "false", to
// true — env vars are always strings, so that reads the literal string
// "false" as truthy. This maps only the two spellings that mean something.
const booleanEnvVar = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => value === 'true');

// The mirror of the above, for a switch that is on unless an operator turns
// it off. Absent means on, so a deployment that says nothing about
// retention still gets it.
const enabledEnvVar = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => value !== 'false');

// Decoded and length-checked here, at the config boundary, so every later
// consumer can assume 32 raw bytes rather than re-validating a base64 string.
const kekBytes = z
  .string()
  .min(1)
  .transform((value, ctx) => {
    const decoded = Buffer.from(value, 'base64');
    if (decoded.length !== 32) {
      ctx.addIssue({
        code: 'custom',
        message: `ODUDU_KEK must decode to exactly 32 bytes, got ${String(decoded.length)}`,
      });
      return z.NEVER;
    }
    return decoded;
  });

// Origin only — no path, query or fragment — because it is the base a
// mailed link is built from (packages/account/src/usecase/register.ts);
// concatenating a path onto something that already carries one produces a
// link nobody asked for. Unset by default: a realm with verify_email and
// registration_allowed both off never builds one, so nothing here forces a
// value on every deployment. When a link does need building, the caller
// fails closed on `undefined` rather than falling back to a request header
// — see ADR-worthy note in registration.ts on why `Host` is untrusted.
const publicBaseUrl = z
  .string()
  .min(1)
  .optional()
  .transform((value, ctx) => {
    if (value === undefined) return undefined;
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'ODUDU_PUBLIC_BASE_URL must be an absolute URL' });
      return z.NEVER;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      ctx.addIssue({
        code: 'custom',
        message: 'ODUDU_PUBLIC_BASE_URL must use http or https',
      });
      return z.NEVER;
    }
    if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
      ctx.addIssue({
        code: 'custom',
        message: 'ODUDU_PUBLIC_BASE_URL must be an origin only — no path, query or fragment',
      });
      return z.NEVER;
    }
    return `${parsed.protocol}//${parsed.host}`;
  });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  ODUDU_HTTP_HOST: z.string().min(1).default('0.0.0.0'),
  ODUDU_HTTP_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  ODUDU_DATABASE_URL: z.url(),
  ODUDU_MIGRATIONS_DIR: z.string().min(1).optional(),
  ODUDU_APP_DATABASE_URL: z.url().optional(),
  ODUDU_TRUST_PROXY: booleanEnvVar,
  // Whether this process itself terminates TLS, or (via a reverse proxy)
  // knows the client's connection to be HTTPS. Off by default: the compose
  // stack serves plain HTTP on :3000 today. Read by @odudu/authn-flows to
  // pick the session cookie's __Host- prefix and to decide whether to warn,
  // and by apps/server's boot guard, which refuses to serve production
  // traffic while it is off.
  ODUDU_TLS: booleanEnvVar,
  // The per-origin request budget on the unauthenticated routes that cost
  // an Argon2id hash or a mail send (ADR 0023). Raise it for a deployment
  // that puts many users behind one address, or for a test suite driving
  // logins in bulk, as infra/conformance/compose.yaml does.
  ODUDU_THROTTLE_LIMIT: z.coerce.number().int().min(1).max(1_000_000).default(10),
  ODUDU_THROTTLE_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86_400).default(60),
  // How long `odudu reap` keeps a row after nothing can still read it
  // (ADR 0021). These are retention windows, not lifespans: a credential's
  // own expiry is enforced at read time and is always the shorter of the
  // two. A window too short for the detection that reads the row is not
  // expressible — the pass floors each one by the life of the grant family
  // or session it belongs to — so these raise retention, never lower it
  // below what reuse detection needs.
  ODUDU_RETENTION_GRANT_SECONDS: z.coerce.number().int().min(60).max(31_536_000).default(604_800),
  ODUDU_RETENTION_OFFLINE_GRANT_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(31_536_000)
    .default(2_592_000),
  // Only a code that never produced a grant is reaped by its own age; one
  // that did is reaped with the family it produced.
  ODUDU_RETENTION_AUTHORIZATION_CODE_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(31_536_000)
    .default(3600),
  // Where nearly all the volume is, and the only one of these tables whose
  // rows no revocation reads back: a replayed consumed row is refused and
  // nothing follows from it.
  ODUDU_RETENTION_AUTHENTICATION_SESSION_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(31_536_000)
    .default(3600),
  ODUDU_RETENTION_ACTION_TOKEN_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(31_536_000)
    .default(604_800),
  // A spent or expired registration token carries no detection value — a
  // replayed unknown token and a replayed spent one are refused
  // identically — so this is on the same footing as ODUDU_RETENTION_ACTION_
  // TOKEN_SECONDS, not the grant-family floor ADR 0021 gives refresh_tokens.
  ODUDU_RETENTION_REGISTRATION_TOKEN_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(31_536_000)
    .default(604_800),
  ODUDU_RETENTION_SESSION_SECONDS: z.coerce.number().int().min(60).max(31_536_000).default(86_400),
  // A delivered message, measured from the delivery. Kept a week, so an
  // operator answering "did that link ever go out?" has something to read.
  ODUDU_RETENTION_EMAIL_SENT_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(31_536_000)
    .default(604_800),
  // A message that spent every attempt and was never delivered, measured
  // from its last attempt. Far longer, because nothing else records the
  // failure: this window is how long an operator has to notice it.
  ODUDU_RETENTION_EMAIL_FAILED_SECONDS: z.coerce
    .number()
    .int()
    .min(3600)
    .max(31_536_000)
    .default(2_592_000),
  // How often the server runs that pass itself, and whether it runs it at
  // all. `false` is for a deployment that schedules `odudu reap` as a cron
  // entry or a Kubernetes CronJob instead — a documented alternative, and
  // the reason this is a switch rather than a fact.
  ODUDU_REAP_ENABLED: enabledEnvVar,
  ODUDU_REAP_INTERVAL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3600),
  // Mail is queued by the request and sent by a pass of its own, which is
  // what keeps an SMTP round trip out of a response and out of the timing
  // of one. `false` is for a deployment that schedules `odudu send-mail`
  // itself; with the schedule off and nothing scheduled elsewhere, queued
  // mail is never sent.
  ODUDU_OUTBOX_ENABLED: enabledEnvVar,
  ODUDU_OUTBOX_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(86_400).default(15),
  // Per realm per pass, so one realm's backlog cannot starve another's.
  ODUDU_OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(20),
  // Attempts a message gets before it is left alone for an operator to
  // read. Nothing deletes it then; `odudu reap` bounds it by
  // ODUDU_RETENTION_EMAIL_FAILED_SECONDS — and reads this same value to
  // decide what "permanently failed" means, so lowering it reclassifies
  // messages already queued: one that has spent the new ceiling stops
  // being retried and starts its retention window, without anything
  // having happened to it.
  ODUDU_OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(5),
  // The first retry's delay; each further attempt doubles it.
  ODUDU_OUTBOX_RETRY_BACKOFF_SECONDS: z.coerce.number().int().min(1).max(86_400).default(60),
  // A back-channel logout is enqueued the instant a session ends, so this
  // pass has no queueing delay of the outbox's kind to hide — it exists to
  // take a relying party's own slowness off the request path. `false` is
  // for a deployment that schedules `odudu send-logouts` itself; with the
  // schedule off and nothing scheduled elsewhere, an ended session's
  // relying parties are never told.
  ODUDU_LOGOUT_SENDER_ENABLED: enabledEnvVar,
  ODUDU_LOGOUT_SENDER_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(86_400).default(15),
  // Deliveries claimed per realm per pass, so one realm's backlog cannot
  // starve another's — the same reasoning as ODUDU_OUTBOX_BATCH_SIZE.
  ODUDU_LOGOUT_SENDER_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(20),
  // How long a claimed delivery stays invisible to other passes; what a
  // process killed between the claim and the send costs.
  ODUDU_LOGOUT_SENDER_LEASE_SECONDS: z.coerce.number().int().min(1).max(3600).default(30),
  // Bounds one delivery end to end (connect and response together): a
  // relying party that accepts the connection and never answers is
  // abandoned for this pass, not for good.
  ODUDU_LOGOUT_SENDER_RESPONSE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(60_000)
    .default(5000),
  ODUDU_LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  ODUDU_KEK: kekBytes,
  // @odudu/email's factory reads these to choose an adapter: unset host
  // means no SMTP server exists to talk to, so it selects the capturing
  // adapter rather than refusing to boot — a realm with verify_email off
  // needs no mail at all. Per-realm SMTP is P4's (ADR 0015 puts these
  // credentials in the environment for now).
  ODUDU_SMTP_HOST: z.string().min(1).optional(),
  ODUDU_SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
  ODUDU_SMTP_FROM: z.string().min(1).optional(),
  ODUDU_SMTP_USERNAME: z.string().min(1).optional(),
  ODUDU_SMTP_PASSWORD: z.string().min(1).optional(),
  ODUDU_SMTP_STARTTLS: booleanEnvVar,
  ODUDU_PUBLIC_BASE_URL: publicBaseUrl,
  // Lets the bounded JWKS fetcher (@odudu/protocol-oidc's client-keys
  // repository) connect to a private or loopback address when a client
  // registers a jwks_uri pointing at one — which the development and
  // conformance stacks both do, since the suite serves its key set from
  // inside the same compose network. Off by default; production refuses
  // to boot with it on (apps/server/src/config-guard.ts).
  ODUDU_ALLOW_PRIVATE_CLIENT_URLS: booleanEnvVar,
});

export type Config = Readonly<z.infer<typeof schema>>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema
    .check((ctx) => {
      // A host with nowhere to say mail came from would fail every send at
      // the SMTP server rather than at boot — catch it here, where every
      // other shape mistake in this file is already caught.
      if (ctx.value.ODUDU_SMTP_HOST !== undefined && ctx.value.ODUDU_SMTP_FROM === undefined) {
        ctx.issues.push({
          code: 'custom',
          message: 'ODUDU_SMTP_FROM is required when ODUDU_SMTP_HOST is set',
          input: ctx.value,
          path: ['ODUDU_SMTP_FROM'],
        });
      }
    })
    .safeParse(env);

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new OduduError('config_invalid', `Invalid configuration — ${detail}`);
  }

  return Object.freeze(parsed.data);
}
