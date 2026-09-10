import { z } from 'zod';
import { OduduError } from '#/errors';

// z.coerce.boolean() coerces any non-empty string, including "false", to
// true — env vars are always strings, so that reads the literal string
// "false" as truthy. This maps only the two spellings that mean something.
const booleanEnvVar = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => value === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  ODUDU_HTTP_HOST: z.string().min(1).default('0.0.0.0'),
  ODUDU_HTTP_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  ODUDU_DATABASE_URL: z.url(),
  ODUDU_MIGRATIONS_DIR: z.string().min(1).optional(),
  ODUDU_APP_DATABASE_URL: z.url().optional(),
  ODUDU_TRUST_PROXY: booleanEnvVar,
  ODUDU_LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
});

export type Config = Readonly<z.infer<typeof schema>>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new OduduError('config_invalid', `Invalid configuration — ${detail}`);
  }

  return Object.freeze(parsed.data);
}
