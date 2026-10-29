import { isIP } from 'node:net';
import { describe, expect, it } from 'vitest';
import { mailOptions, transportOptions } from '#/adapter/smtp';
import { OUTBOX_CLAIM_LEASE_SECONDS } from '#/usecase/send-pending';

const BASE = { host: 'smtp.example.test', port: 587, from: 'noreply@example.test' };

describe('transportOptions', () => {
  it('requires TLS whenever a username is configured, whatever starttls asked for', () => {
    const options = transportOptions({ ...BASE, username: 'ada', starttls: false });

    expect(options.requireTLS).toBe(true);
  });

  it('requires TLS whenever a password is configured, whatever starttls asked for', () => {
    const options = transportOptions({ ...BASE, password: 'hunter2', starttls: false });

    expect(options.requireTLS).toBe(true);
  });

  it('carries credentials only over a connection that requires TLS', () => {
    const options = transportOptions({ ...BASE, username: 'ada', password: 'hunter2' });

    expect(options.auth).toEqual({ user: 'ada', pass: 'hunter2' });
    expect(options.requireTLS).toBe(true);
  });

  it('leaves an unauthenticated configuration to decide STARTTLS for itself', () => {
    expect(transportOptions({ ...BASE }).requireTLS).toBe(false);
    expect(transportOptions({ ...BASE, starttls: true }).requireTLS).toBe(true);
  });

  it('bounds every phase of the attempt, well inside the outbox claim lease', () => {
    const options = transportOptions(BASE);

    expect(options.connectionTimeout).toBeGreaterThan(0);
    expect(options.greetingTimeout).toBeGreaterThan(0);
    expect(options.socketTimeout).toBeGreaterThan(0);
    const worstCase = options.connectionTimeout + options.greetingTimeout + options.socketTimeout;
    expect(worstCase).toBeLessThan(OUTBOX_CLAIM_LEASE_SECONDS * 1000);
  });
});

describe('transportOptions, given an address the caller already checked', () => {
  it('connects to that address and carries the hostname only as the TLS name', () => {
    const options = transportOptions({ ...BASE, address: '203.0.113.10' });

    // nodemailer resolves `host` itself unless it is already an IP
    // (`lib/shared/index.js`, `resolveHostname`), and verifies the
    // certificate against `servername` when one is set. Handing it the
    // checked address is what makes a second lookup impossible.
    expect(options.host).toBe('203.0.113.10');
    expect(isIP(options.host)).not.toBe(0);
    expect(options.servername).toBe('smtp.example.test');
  });

  it('leaves an operator-configured relay to resolve its own host', () => {
    const options = transportOptions(BASE);

    expect(options.host).toBe('smtp.example.test');
    expect(options.servername).toBeUndefined();
  });
});

describe('transportOptions, given a host that is already an address', () => {
  it('sends no TLS server name, which RFC 6066 does not permit to be an IP', () => {
    const options = transportOptions({ ...BASE, host: '203.0.113.10', address: '203.0.113.10' });

    expect(options.host).toBe('203.0.113.10');
    expect(options.servername).toBeUndefined();
  });
});

describe('mailOptions', () => {
  const message = { to: 'ada@example.test', subject: 's', text: 't', html: '<p>h</p>' };

  it('sends a message that names no image without attachments', () => {
    expect(mailOptions(BASE, message).attachments).toEqual([]);
  });

  it('attaches the mark inline, under the id the markup names, when the markup names it', () => {
    const options = mailOptions(BASE, { ...message, html: '<img src="cid:odudu-mark" alt="">' });
    expect(options.attachments).toHaveLength(1);
    const [mark] = options.attachments;
    expect(mark?.cid).toBe('odudu-mark');
    expect(mark?.contentDisposition).toBe('inline');
    expect(mark?.contentType).toBe('image/png');
    expect(mark?.content.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });

  it('marks every message as automatically generated (RFC 3834 section 5)', () => {
    expect(mailOptions(BASE, message).headers).toEqual({ 'Auto-Submitted': 'auto-generated' });
  });

  it('leaves the sending address as configured', () => {
    expect(mailOptions(BASE, message).from).toBe('noreply@example.test');
  });
});
