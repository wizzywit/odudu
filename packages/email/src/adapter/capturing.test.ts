import type { Logger } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { capturingSender } from '#/adapter/capturing';

describe('capturingSender', () => {
  it('records what it was asked to send', async () => {
    const sender = capturingSender();
    await sender.send({ to: 'ada@example.test', subject: 'Verify', text: 't', html: '<p>t</p>' });
    expect(sender.sent).toEqual([
      { to: 'ada@example.test', subject: 'Verify', text: 't', html: '<p>t</p>' },
    ]);
  });

  it('records messages in the order they were sent', async () => {
    const sender = capturingSender();
    await sender.send({ to: 'a@example.test', subject: 'One', text: 't', html: '<p>t</p>' });
    await sender.send({ to: 'b@example.test', subject: 'Two', text: 't', html: '<p>t</p>' });
    expect(sender.sent.map((m) => m.to)).toEqual(['a@example.test', 'b@example.test']);
  });

  it('writes each sent message to the given logger', async () => {
    const infoCalls: [object, string | undefined][] = [];
    const logger: Logger = {
      debug: () => undefined,
      info: (obj: object, msg?: string) => {
        infoCalls.push([obj, msg]);
      },
      warn: () => undefined,
      error: () => undefined,
      child: () => logger,
    };

    const sender = capturingSender(logger);
    await sender.send({ to: 'ada@example.test', subject: 'Verify', text: 't', html: '<p>t</p>' });

    expect(infoCalls).toHaveLength(1);
  });
});
