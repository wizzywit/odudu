import type { Logger } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { loggingSender } from '#/adapter/logging';

function recording(): { logger: Logger; lines: [object, string | undefined][] } {
  const lines: [object, string | undefined][] = [];
  const logger: Logger = {
    debug: () => undefined,
    info: (obj: object, msg?: string) => {
      lines.push([obj, msg]);
    },
    warn: () => undefined,
    error: () => undefined,
    child: () => logger,
  };
  return { logger, lines };
}

describe('loggingSender', () => {
  it('writes each message to the logger', async () => {
    const { logger, lines } = recording();

    await loggingSender(logger).send({
      to: 'ada@example.test',
      subject: 'Verify',
      text: 't',
      html: '<p>t</p>',
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]?.[0]).toMatchObject({ to: 'ada@example.test' });
    expect(lines[0]?.[1]).toBe('captured email — no SMTP host configured');
  });

  it('keeps nothing: `send` is the whole of it', async () => {
    const { logger } = recording();
    const sender = loggingSender(logger);

    for (let i = 0; i < 100; i += 1) {
      await sender.send({ to: `a${String(i)}@example.test`, subject: 's', text: 't', html: 't' });
    }

    expect(Object.keys(sender)).toEqual(['send']);
  });
});
