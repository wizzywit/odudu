import { describe, expect, it, vi } from 'vitest';
import { createLogoutDeliveryTransport } from '#/logout-delivery-transport';

const ENDPOINT = 'https://rp.example/backchannel';
const TOKEN = 'signed-logout-token';
const SIGNAL = new AbortController().signal;

describe('createLogoutDeliveryTransport', () => {
  it('connects to the address the lookup returned, pinning past the hostname it resolved', async () => {
    const request = vi.fn().mockResolvedValue({ status: 200 });
    const transport = createLogoutDeliveryTransport({
      lookup: () => Promise.resolve(['203.0.113.10']),
      request,
    });

    const response = await transport(ENDPOINT, TOKEN, SIGNAL);

    expect(response).toEqual({ status: 200 });
    expect(request).toHaveBeenCalledWith(new URL(ENDPOINT), '203.0.113.10', TOKEN, SIGNAL);
  });

  it('refuses a loopback address without ever posting to it', async () => {
    const request = vi.fn();
    const transport = createLogoutDeliveryTransport({
      lookup: () => Promise.resolve(['127.0.0.1']),
      request,
    });

    await expect(transport(ENDPOINT, TOKEN, SIGNAL)).rejects.toThrow(/loopback address/u);
    expect(request).not.toHaveBeenCalled();
  });

  it('refuses a private address by default, since the endpoint is client-registered', async () => {
    const request = vi.fn();
    const transport = createLogoutDeliveryTransport({
      lookup: () => Promise.resolve(['10.0.0.5']),
      request,
    });

    await expect(transport(ENDPOINT, TOKEN, SIGNAL)).rejects.toThrow(/private address/u);
    expect(request).not.toHaveBeenCalled();
  });

  it('admits a private address once the guard is explicitly relaxed', async () => {
    const request = vi.fn().mockResolvedValue({ status: 200 });
    const transport = createLogoutDeliveryTransport({
      lookup: () => Promise.resolve(['10.0.0.5']),
      allowPrivate: true,
      request,
    });

    const response = await transport(ENDPOINT, TOKEN, SIGNAL);

    expect(response).toEqual({ status: 200 });
    expect(request).toHaveBeenCalledWith(new URL(ENDPOINT), '10.0.0.5', TOKEN, SIGNAL);
  });

  it('refuses an endpoint that never resolves to any address', async () => {
    const request = vi.fn();
    const transport = createLogoutDeliveryTransport({ lookup: () => Promise.resolve([]), request });

    await expect(transport(ENDPOINT, TOKEN, SIGNAL)).rejects.toThrow(
      /did not resolve to any address/u,
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('refuses a non-https endpoint before ever resolving it', async () => {
    const lookup = vi.fn();
    const request = vi.fn();
    const transport = createLogoutDeliveryTransport({ lookup, request });

    await expect(transport('http://rp.example/backchannel', TOKEN, SIGNAL)).rejects.toThrow(
      /scheme must be https/u,
    );
    expect(lookup).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
});
