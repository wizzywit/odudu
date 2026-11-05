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
    ).toEqual({ host: 'app.example.com:8443', redirectUris: URIS });
  });

  it.each(['seeded', 'operator', 'anonymous', 'token'])(
    'names nothing for a %s client',
    (origin) => {
      expect(
        clientSourceOf({ clientId: 'billing-app', registrationOrigin: origin }, URIS),
      ).toBeNull();
    },
  );
});
