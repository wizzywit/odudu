import { isIP } from 'node:net';
import { describe, expect, it } from 'vitest';
import { transportOptions } from '#/adapter/smtp';
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
