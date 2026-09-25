import { describe, expect, it } from 'vitest';
import { audienceOf, callerIsAddressed } from '#/service/introspection-audience';

describe('audienceOf', () => {
  it('wraps a single string aud in an array', () => {
    expect(audienceOf('https://api.example')).toEqual(['https://api.example']);
  });

  it('passes through an array of strings', () => {
    expect(audienceOf(['https://api.example', 'https://op.example'])).toEqual([
      'https://api.example',
      'https://op.example',
    ]);
  });

  it('is empty for a missing aud', () => {
    expect(audienceOf(undefined)).toEqual([]);
  });

  it('is empty for an array containing a non-string entry', () => {
    expect(audienceOf(['https://api.example', 1])).toEqual([]);
  });
});

describe('callerIsAddressed', () => {
  const aud = ['https://api.example', 'https://op.example/tenants/demo'];

  it('is true when the caller is named through its own client_id', () => {
    const caller = { clientId: 'https://api.example', audiences: [] };
    expect(callerIsAddressed(caller, aud)).toBe(true);
  });

  it('is true when the caller is named through one of its resource audiences', () => {
    const caller = {
      clientId: 'resource-server-a',
      audiences: ['https://op.example/tenants/demo'],
    };
    expect(callerIsAddressed(caller, aud)).toBe(true);
  });

  it('is false when neither identity appears in aud', () => {
    const caller = { clientId: 'unrelated-client', audiences: ['https://elsewhere.example'] };
    expect(callerIsAddressed(caller, aud)).toBe(false);
  });
});
