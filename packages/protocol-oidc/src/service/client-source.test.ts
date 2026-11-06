import { describe, expect, it } from 'vitest';
import { clientSourceOf } from '#/service/client-source';

const URIS = ['https://app.example.com/cb'];

describe('clientSourceOf', () => {
  it('names the host of a metadata document client with its port, and its redirect addresses', () => {
    expect(
      clientSourceOf(
        { clientId: 'https://app.example.com:8443/client.json', registrationOrigin: 'cimd' },
        URIS,
      ),
    ).toEqual({ kind: 'metadata', host: 'app.example.com:8443', redirectUris: URIS });
  });

  it('names the redirect origins of a self-registered client, without their paths', () => {
    expect(
      clientSourceOf({ clientId: 'abc', registrationOrigin: 'anonymous' }, [
        'https://evil.example/cb?x=1',
        'https://evil.example/other',
        'http://127.0.0.1:8123/cb',
        'com.example.app:/oauth',
      ]),
    ).toEqual({
      kind: 'self-registered',
      origins: ['https://evil.example', 'http://127.0.0.1:8123', 'com.example.app:'],
      more: 0,
    });
  });

  it('bounds the origins named and counts the rest', () => {
    const uris = Array.from({ length: 9 }, (_, i) => `https://h${String(i)}.example/cb`);
    const source = clientSourceOf({ clientId: 'abc', registrationOrigin: 'anonymous' }, uris);
    expect(source).toMatchObject({ kind: 'self-registered', more: 4 });
    expect(source !== null && source.kind === 'self-registered' && source.origins).toHaveLength(5);
  });

  it.each(['seeded', 'operator', 'token'])('names nothing for a %s client', (origin) => {
    expect(
      clientSourceOf({ clientId: 'billing-app', registrationOrigin: origin }, URIS),
    ).toBeNull();
  });
});
