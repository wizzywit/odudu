import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { smtpSender } from '#/adapter/smtp';

const SMTP_PORT = 1025;
const HTTP_PORT = 8025;

const mailpitMessages = z.object({
  messages: z.array(
    z.object({
      To: z.array(z.object({ Address: z.string() })),
      Subject: z.string(),
    }),
  ),
});

let container: StartedTestContainer;

beforeAll(async () => {
  container = await new GenericContainer('axllent/mailpit')
    .withExposedPorts(SMTP_PORT, HTTP_PORT)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
}, 120_000);

afterAll(async () => {
  await container.stop();
});

async function listMessages(): Promise<z.infer<typeof mailpitMessages>['messages']> {
  const url = `http://${container.getHost()}:${String(container.getMappedPort(HTTP_PORT))}/api/v1/messages`;
  const response = await fetch(url);
  const body: unknown = await response.json();
  return mailpitMessages.parse(body).messages;
}

describe('smtpSender', () => {
  it('delivers a message an SMTP server accepts and can be read back', async () => {
    const sender = smtpSender({
      host: container.getHost(),
      port: container.getMappedPort(SMTP_PORT),
      from: 'odudu@example.test',
    });

    await sender.send({
      to: 'ada@example.test',
      subject: 'Verify your address',
      text: 'link',
      html: '<p>link</p>',
    });

    const messages = await listMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.To[0]?.Address).toBe('ada@example.test');
  });
});
