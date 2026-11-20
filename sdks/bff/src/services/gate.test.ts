import { describe, expect, it } from 'vitest';
import { gate as routeGate, proxyGate } from '#/services/gate';

const allowed = ['https://app.example'];
const gate = (method: string, customHeader: string | null, origin: string | null): string =>
  proxyGate({ method, customHeader, origin, allowedOrigins: allowed });

describe('proxyGate', () => {
  it('requires the custom header on every method, a safe one included', () => {
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(gate(method, null, 'https://app.example')).toBe('forbidden');
      expect(gate(method, '', 'https://app.example')).toBe('forbidden');
      expect(gate(method, '1', 'https://app.example')).toBe('ok');
    }
  });

  it('lets a safe method omit the Origin and refuses one that is not allowed', () => {
    expect(gate('GET', '1', null)).toBe('ok');
    expect(gate('HEAD', '1', null)).toBe('ok');
    expect(gate('GET', '1', 'https://evil.example')).toBe('forbidden');
    expect(gate('GET', '1', 'null')).toBe('forbidden');
  });

  it('requires an allowed Origin of a method that can change state', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(gate(method, '1', null)).toBe('forbidden');
      expect(gate(method, '1', 'https://evil.example')).toBe('forbidden');
    }
  });
});

describe('gate with requireHeader', () => {
  const base = { method: 'GET', allow: 'GET', allowedOrigins: allowed } as const;
  it('lets a GET through only with the header and an allowed Origin if one is sent', () => {
    const verdict = (customHeader: string | null, origin: string | null): string =>
      routeGate({ ...base, customHeader, origin, requireHeader: true });
    expect(verdict(null, null)).toBe('forbidden');
    expect(verdict('1', null)).toBe('ok');
    expect(verdict('1', 'https://evil.example')).toBe('forbidden');
    expect(routeGate({ ...base, customHeader: null, origin: null, requireHeader: false })).toBe(
      'ok',
    );
  });
});
