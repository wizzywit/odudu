import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { issuerBaseFor, realmIssuerFor } from '#/view/issuer';

async function probe(
  options: { trustProxy: boolean },
  headers: Record<string, string>,
): Promise<{ base: string; realmIssuer: string }> {
  const app = Fastify(options);
  app.get('/probe', (request) => ({
    base: issuerBaseFor(request),
    realmIssuer: realmIssuerFor(request, 'acme'),
  }));
  try {
    const res = await app.inject({ url: '/probe', headers });
    return res.json<{ base: string; realmIssuer: string }>();
  } finally {
    await app.close();
  }
}

describe('[ODUDU-ISSUER-01] the issuer names the authority a client actually reached', () => {
  it('keeps the port the Host header carries', async () => {
    const { base } = await probe({ trustProxy: false }, { host: 'idp.example:8443' });
    expect(base).toBe('http://idp.example:8443');
  });

  it('omits a port the Host header does not carry', async () => {
    const { base } = await probe({ trustProxy: false }, { host: 'idp.example' });
    expect(base).toBe('http://idp.example');
  });

  // A reverse proxy terminating TLS on a non-default port is the deployment
  // this exists for: the authority the client typed is only in
  // X-Forwarded-Host, port and all.
  it('keeps the port X-Forwarded-Host carries when the proxy is trusted', async () => {
    const { base } = await probe(
      { trustProxy: true },
      {
        host: 'internal:3000',
        'x-forwarded-host': 'idp.example:8443',
        'x-forwarded-proto': 'https',
      },
    );
    expect(base).toBe('https://idp.example:8443');
  });

  it('ignores X-Forwarded-Host when the proxy is not trusted', async () => {
    const { base } = await probe(
      { trustProxy: false },
      { host: 'idp.example:8443', 'x-forwarded-host': 'evil.example' },
    );
    expect(base).toBe('http://idp.example:8443');
  });

  it('appends the realm path to the same base', async () => {
    const { base, realmIssuer } = await probe({ trustProxy: false }, { host: 'idp.example:8443' });
    expect(realmIssuer).toBe(`${base}/realms/acme`);
  });
});

// Two spellings of one authority must not become two issuers. An access
// token is verified against the issuer recomputed from the Host of the
// request presenting it (packages/protocol-oidc/src/usecase/userinfo.ts),
// so a deployment whose clients reach it both ways would hand out tokens
// one half of itself rejects.
describe('[ODUDU-ISSUER-02] the scheme default port never appears in the issuer', () => {
  it('drops :443 from an https authority', async () => {
    const { base } = await probe(
      { trustProxy: true },
      { host: 'idp.example:443', 'x-forwarded-proto': 'https' },
    );
    expect(base).toBe('https://idp.example');
  });

  it('spells an https authority the same whether or not :443 is stated', async () => {
    const explicit = await probe(
      { trustProxy: true },
      { host: 'idp.example:443', 'x-forwarded-proto': 'https' },
    );
    const implicit = await probe(
      { trustProxy: true },
      { host: 'idp.example', 'x-forwarded-proto': 'https' },
    );
    expect(explicit.base).toBe(implicit.base);
    expect(explicit.realmIssuer).toBe(implicit.realmIssuer);
  });

  it('drops :80 from an http authority', async () => {
    const { base } = await probe({ trustProxy: false }, { host: 'idp.example:80' });
    expect(base).toBe('http://idp.example');
  });

  // :80 is the default for http, not for https, and vice versa: dropping
  // either from the other scheme would name an authority nobody listens on.
  it('keeps :80 under https and :443 under http', async () => {
    const httpsOn80 = await probe(
      { trustProxy: true },
      { host: 'idp.example:80', 'x-forwarded-proto': 'https' },
    );
    const httpOn443 = await probe({ trustProxy: false }, { host: 'idp.example:443' });
    expect(httpsOn80.base).toBe('https://idp.example:80');
    expect(httpOn443.base).toBe('http://idp.example:443');
  });

  it('keeps a non-default port', async () => {
    const { base } = await probe(
      { trustProxy: true },
      { host: 'idp.example:8443', 'x-forwarded-proto': 'https' },
    );
    expect(base).toBe('https://idp.example:8443');
  });

  // An IPv6 literal is bracketed and full of colons; only the colon outside
  // the brackets is a port separator.
  it('keeps a non-default port on an IPv6 literal', async () => {
    const { base } = await probe(
      { trustProxy: true },
      { host: '[2001:db8::1]:8443', 'x-forwarded-proto': 'https' },
    );
    expect(base).toBe('https://[2001:db8::1]:8443');
  });

  it('drops the default port from an IPv6 literal without eating the address', async () => {
    const { base } = await probe(
      { trustProxy: true },
      { host: '[2001:db8::1]:443', 'x-forwarded-proto': 'https' },
    );
    expect(base).toBe('https://[2001:db8::1]');
  });

  it('leaves a bare IPv6 literal alone', async () => {
    const { base } = await probe({ trustProxy: false }, { host: '[2001:db8::1]' });
    expect(base).toBe('http://[2001:db8::1]');
  });

  // RFC 3986 §3.2.3 spells the port as `*DIGIT`, so `:00443` and `:443` are
  // one port written two ways, and an empty port is no port at all.
  it('reads a port written with leading zeros as that port', async () => {
    const padded = await probe(
      { trustProxy: true },
      { host: 'idp.example:00443', 'x-forwarded-proto': 'https' },
    );
    expect(padded.base).toBe('https://idp.example');
  });

  it('spells a non-default port without its leading zeros', async () => {
    const padded = await probe(
      { trustProxy: true },
      { host: 'idp.example:08443', 'x-forwarded-proto': 'https' },
    );
    expect(padded.base).toBe('https://idp.example:8443');
  });

  it('drops an empty port and its delimiter', async () => {
    const empty = await probe(
      { trustProxy: true },
      { host: 'idp.example:', 'x-forwarded-proto': 'https' },
    );
    expect(empty.base).toBe('https://idp.example');
  });

  // RFC 3986 §6.2.2.1 makes the host case-insensitive.
  it('spells the host in lower case however the Host header shouted it', async () => {
    const shouted = await probe({ trustProxy: false }, { host: 'IDP.EXAMPLE:8443' });
    expect(shouted.base).toBe('http://idp.example:8443');
  });

  // `idp.example.` states the DNS root label that `idp.example` leaves
  // implicit; both name one host.
  it('drops an explicit DNS root label', async () => {
    const rooted = await probe({ trustProxy: false }, { host: 'idp.example.:8443' });
    expect(rooted.base).toBe('http://idp.example:8443');
  });

  it('gives one issuer to every spelling of one authority', async () => {
    const spellings = await Promise.all(
      ['idp.example', 'idp.example:443', 'idp.example:00443', 'idp.example:', 'IDP.EXAMPLE.'].map(
        (host) => probe({ trustProxy: true }, { host, 'x-forwarded-proto': 'https' }),
      ),
    );
    expect(new Set(spellings.map((s) => s.realmIssuer))).toEqual(
      new Set(['https://idp.example/realms/acme']),
    );
  });

  // light-my-request supplies `localhost:80` when no Host header is sent,
  // which is the same authority as a bare `localhost` and must spell the
  // same.
  it('names a portless authority when no Host header is sent', async () => {
    const { base, realmIssuer } = await probe({ trustProxy: false }, {});
    expect(base).toBe('http://localhost');
    expect(realmIssuer).toBe('http://localhost/realms/acme');
  });
});
