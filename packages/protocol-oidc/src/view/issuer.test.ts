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
