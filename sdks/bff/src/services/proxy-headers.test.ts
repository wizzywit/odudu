import { describe, expect, it } from 'vitest';
import { browserResponseHeaders, upstreamRequestHeaders } from '#/services/proxy-headers';

describe('upstreamRequestHeaders', () => {
  it('drops the cookie, the hop-by-hop headers and what the BFF owns, and keeps the rest', () => {
    const incoming = new Headers({
      cookie: '__Host-odudu=abc',
      connection: 'close, X-Secret',
      'keep-alive': 'timeout=5',
      'proxy-authenticate': 'x',
      'proxy-authorization': 'Basic eA==',
      te: 'trailers',
      trailer: 'x',
      'transfer-encoding': 'chunked',
      upgrade: 'websocket',
      'x-secret': 'named by connection',
      host: 'app.example',
      origin: 'https://app.example',
      'x-odudu-bff': '1',
      authorization: 'Bearer forged',
      accept: 'application/json',
      'content-type': 'text/plain',
      'x-request-id': 'r1',
      'x-forwarded-for': '1.2.3.4',
      'x-forwarded-proto': 'https',
      forwarded: 'for=1.2.3.4',
      'x-real-ip': '1.2.3.4',
      'proxy-connection': 'keep-alive',
    });
    const headers = upstreamRequestHeaders(incoming, 'tok');
    expect([...headers.keys()].sort()).toEqual([
      'accept',
      'accept-encoding',
      'authorization',
      'content-type',
      'x-request-id',
    ]);
    expect(headers.get('authorization')).toBe('Bearer tok');
  });
});

describe('browserResponseHeaders', () => {
  it('drops every cookie the upstream sets and the hop-by-hop headers', () => {
    const upstream = new Headers({
      'content-type': 'application/json',
      location: 'https://elsewhere.example/x',
      'x-upstream': 'yes',
      connection: 'x-named',
      'x-named': 'gone',
      'keep-alive': 'timeout=5',
      'transfer-encoding': 'chunked',
      upgrade: 'h2c',
    });
    upstream.append('set-cookie', 'a=1');
    upstream.append('set-cookie', 'b=2');
    const headers = browserResponseHeaders(upstream);
    expect([...headers.keys()].sort()).toEqual(['content-type', 'location', 'x-upstream']);
    expect(headers.getSetCookie()).toEqual([]);
    expect(headers.get('location')).toBe('https://elsewhere.example/x');
  });

  it('drops the encoding and the length of a body the client library already decoded', () => {
    const decoded = browserResponseHeaders(
      new Headers({ 'content-encoding': 'gzip', 'content-length': '20', vary: 'accept-encoding' }),
    );
    expect([...decoded.keys()]).toEqual(['vary']);
    const plain = browserResponseHeaders(new Headers({ 'content-length': '20' }));
    expect(plain.get('content-length')).toBe('20');
  });
});
