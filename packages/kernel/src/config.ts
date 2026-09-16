import { z } from 'zod';
import { OduduError } from '#/errors';

// z.coerce.boolean() coerces any non-empty string, including "false", to
// true — env vars are always strings, so that reads the literal string
// "false" as truthy. This maps only the two spellings that mean something.
const booleanEnvVar = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => value === 'true');

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
