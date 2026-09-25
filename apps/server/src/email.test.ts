import { loadConfig } from '@odudu/kernel';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { buildEmailSender } from '#/email';

const base = {
  ODUDU_DATABASE_URL: 'postgres://user:pw@localhost:5432/odudu',
  ODUDU_KEK: Buffer.alloc(32, 9).toString('base64'),
};

const silentLogger = pino({ level: 'silent' });

describe('buildEmailSender', () => {
  // Log-only, never the capturing adapter: this sender lives for the whole
  // process, and `capturingSender`'s `sent` array is appended to and never
  // read back outside a test, so a long-running server would hold every
  // verification and reset mail it ever produced until restart.
  it('logs mail rather than retaining it when ODUDU_SMTP_HOST is unset', async () => {
    const config = loadConfig(base);
    const logged: unknown[] = [];
    const logger = pino(
      { level: 'info' },
      { write: (line: string) => logged.push(JSON.parse(line) as unknown) },
    );

    const sender = buildEmailSender(config, logger);
    await sender.send({ to: 'a@example.test', subject: 's', text: 't', html: '<p>t</p>' });

    expect(logged.some((line) => JSON.stringify(line).includes('capturing outgoing mail'))).toBe(
      true,
    );
    expect(logged.some((line) => JSON.stringify(line).includes('captured email'))).toBe(true);
    expect(sender.kind, 'the unset-host sender must be the log-only one').toBe('logging');
  });

  it('builds an SMTP sender when ODUDU_SMTP_HOST and ODUDU_SMTP_FROM are set', () => {
    const config = loadConfig({
      ...base,
      ODUDU_SMTP_HOST: 'smtp.example.test',
      ODUDU_SMTP_FROM: 'noreply@example.test',
    });

    const sender = buildEmailSender(config, silentLogger);

    expect(sender).not.toHaveProperty('sent');
  });
});
