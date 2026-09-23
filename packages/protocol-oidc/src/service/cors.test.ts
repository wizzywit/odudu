import { describe, expect, it } from 'vitest';
import { corsHeadersForPreflight, corsHeadersForRequest } from '#/service/cors';

const allowed = new Set(['https://app.example']);

describe('preflight', () => {
  it('echoes an allowed origin explicitly and varies on Origin', () => {
    expect(corsHeadersForPreflight('https://app.example', allowed)).toEqual({
      'access-control-allow-origin': 'https://app.example',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-max-age': '600',
      vary: 'Origin',
    });
  });

  it('returns null for an origin nothing in the tenant allows', () => {
    expect(corsHeadersForPreflight('https://evil.example', allowed)).toBeNull();
  });

  it('returns null when there is no Origin header at all', () => {
    expect(corsHeadersForPreflight(undefined, allowed)).toBeNull();
  });

  it('never grants credentials', () => {
    const headers = corsHeadersForPreflight('https://app.example', allowed);
    expect(headers).not.toHaveProperty('access-control-allow-credentials');
  });
});

describe('actual request', () => {
  it('echoes an allowed origin and always varies on Origin', () => {
    expect(corsHeadersForRequest('https://app.example', allowed)).toEqual({
      'access-control-allow-origin': 'https://app.example',
      vary: 'Origin',
    });
  });

  it('omits allow-origin for a disallowed origin but still varies', () => {
    expect(corsHeadersForRequest('https://evil.example', allowed)).toEqual({ vary: 'Origin' });
  });
});
