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
      sentTo: null,
      origins: ['https://evil.example', 'http://127.0.0.1:8123', 'com.example.app:'],
      more: 0,
    });
  });

  it('always names the origin of this request, even when it is the sixth registered', () => {
    const uris = [
      ...Array.from({ length: 6 }, (_, i) => `https://h${String(i)}.example/cb`),
      'https://evil.example/cb',
    ];
    const source = clientSourceOf(
      { clientId: 'abc', registrationOrigin: 'anonymous' },
      uris,
      'https://evil.example/cb?x=1',
    );
    expect(source).toMatchObject({ kind: 'self-registered', sentTo: 'https://evil.example' });
    if (source?.kind !== 'self-registered') throw new Error('no source');
    expect(source.origins).not.toContain('https://evil.example');
    expect(source.origins).toHaveLength(5);
    expect(source.more).toBe(1);
  });

  it('counts the request origin once however many registered uris share it', () => {
    const source = clientSourceOf(
      { clientId: 'abc', registrationOrigin: 'anonymous' },
      ['https://a.example/1', 'https://a.example/2', 'https://b.example/1'],
      'https://a.example/2',
    );
    expect(source).toEqual({
      kind: 'self-registered',
      sentTo: 'https://a.example',
      origins: ['https://b.example'],
      more: 0,
    });
  });

  it('does not throw on a stored address that is not a URL, and shows it as it is', () => {
    const source = clientSourceOf({ clientId: 'abc', registrationOrigin: 'anonymous' }, [
      'not a url',
      'https://a.example/cb',
    ]);
    expect(source).toMatchObject({ origins: ['not a url', 'https://a.example'] });
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
