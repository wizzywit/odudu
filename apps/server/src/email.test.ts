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
  it('captures mail and logs why when ODUDU_SMTP_HOST is unset', () => {
    const config = loadConfig(base);
    const logged: unknown[] = [];
    const logger = pino(
      { level: 'info' },
      { write: (line: string) => logged.push(JSON.parse(line) as unknown) },
    );

    const sender = buildEmailSender(config, logger);

    expect(logged.some((line) => JSON.stringify(line).includes('capturing outgoing mail'))).toBe(
      true,
    );
    return expect(
      sender.send({ to: 'a@example.test', subject: 's', text: 't', html: '<p>t</p>' }),
    ).resolves.toBeUndefined();
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
