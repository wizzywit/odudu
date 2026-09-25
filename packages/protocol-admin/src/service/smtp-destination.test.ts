import { describe, expect, it } from 'vitest';
import { checkSmtpDestination } from '#/service/smtp-destination';

const never: () => Promise<readonly string[]> = () =>
  Promise.reject(new Error('should not have resolved'));

function resolvingTo(...addresses: string[]) {
  return () => Promise.resolve(addresses);
}

describe('checkSmtpDestination', () => {
  it('refuses a loopback literal, so the server cannot be pointed at itself', async () => {
    const outcome = await checkSmtpDestination('127.0.0.1', {
      allowPrivate: false,
      resolve: never,
    });

    expect(outcome).toEqual({
      kind: 'refused',
      reason: 'this server will not connect to 127.0.0.1: address 127.0.0.1 is a loopback address',
    });
  });

  it('refuses a loopback literal even with the escape hatch on', async () => {
    const outcome = await checkSmtpDestination('::1', { allowPrivate: true, resolve: never });

    expect(outcome.kind).toBe('refused');
  });

  it('refuses the link-local metadata address', async () => {
    const outcome = await checkSmtpDestination('169.254.169.254', {
      allowPrivate: false,
      resolve: never,
    });

    expect(outcome.kind).toBe('refused');
  });

  it('refuses a name that resolves into a private range', async () => {
    const outcome = await checkSmtpDestination('relay.internal', {
      allowPrivate: false,
      resolve: resolvingTo('10.0.0.5'),
    });

    expect(outcome).toEqual({
      kind: 'refused',
      reason:
        'this server will not connect to relay.internal: address 10.0.0.5 is a private address',
    });
  });

  it('admits that same name when the deployment says its relay is internal', async () => {
    const outcome = await checkSmtpDestination('relay.internal', {
      allowPrivate: true,
      resolve: resolvingTo('10.0.0.5'),
    });

    expect(outcome.kind).toBe('allowed');
  });

  it('checks every resolved address, not the first', async () => {
    const outcome = await checkSmtpDestination('split.example', {
      allowPrivate: false,
      resolve: resolvingTo('93.184.216.34', '127.0.0.1'),
    });

    expect(outcome.kind).toBe('refused');
  });

  it('refuses a name that does not resolve rather than letting the transport try', async () => {
    const outcome = await checkSmtpDestination('nowhere.invalid', {
      allowPrivate: false,
      resolve: () => Promise.reject(new Error('ENOTFOUND')),
    });

    expect(outcome).toEqual({
      kind: 'refused',
      reason: 'this server will not connect to nowhere.invalid: it resolves to no address',
    });
  });

  it('allows an ordinary public address', async () => {
    const outcome = await checkSmtpDestination('smtp.example.com', {
      allowPrivate: false,
      resolve: resolvingTo('93.184.216.34'),
    });

    expect(outcome.kind).toBe('allowed');
  });

  // ADR 0028's second half: the caller connects to the address that was
  // checked, so nothing between here and the socket can resolve the name a
  // second time and reach an address this refused.
  it('carries the address it checked, so a caller need not resolve again', async () => {
    const outcome = await checkSmtpDestination('relay.example.test', {
      allowPrivate: false,
      resolve: resolvingTo('203.0.113.10', '203.0.113.11'),
    });

    expect(outcome).toEqual({ kind: 'allowed', address: '203.0.113.10' });
  });

  it('carries a literal host through as its own address', async () => {
    const outcome = await checkSmtpDestination('203.0.113.10', {
      allowPrivate: false,
      resolve: never,
    });

    expect(outcome).toEqual({ kind: 'allowed', address: '203.0.113.10' });
  });
});
