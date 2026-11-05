import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { domainAddress, pathAddress } from '@odudu/kernel';
import {
  configureIssuerBase,
  configureTenantAddress,
  issuerBaseFor,
  tenantIssuerFor,
} from '#/view/issuer';

async function probe(
  options: { trustProxy: boolean },
  headers: Record<string, string>,
): Promise<{ base: string; tenantIssuer: string }> {
  const app = Fastify(options);
  app.get('/probe', (request) => ({
    base: issuerBaseFor(request),
    tenantIssuer: tenantIssuerFor(request, 'acme'),
  }));
  try {
    const res = await app.inject({ url: '/probe', headers });
    return res.json<{ base: string; tenantIssuer: string }>();
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

  it('appends the tenant path to the same base', async () => {
    const { base, tenantIssuer } = await probe({ trustProxy: false }, { host: 'idp.example:8443' });
    expect(tenantIssuer).toBe(`${base}/tenants/acme`);
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
    expect(explicit.tenantIssuer).toBe(implicit.tenantIssuer);
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
    expect(new Set(spellings.map((s) => s.tenantIssuer))).toEqual(
      new Set(['https://idp.example/tenants/acme']),
    );
  });

  // light-my-request supplies `localhost:80` when no Host header is sent,
  // which is the same authority as a bare `localhost` and must spell the
  // same.
  it('names a portless authority when no Host header is sent', async () => {
    const { base, tenantIssuer } = await probe({ trustProxy: false }, {});
    expect(base).toBe('http://localhost');
    expect(tenantIssuer).toBe('http://localhost/tenants/acme');
  });
});

// The issuer is a statement the server makes, so when the deployment states its
// public address it is that address and nothing a request says (RFC 8414 §2:
// the issuer in the metadata is the one used; Host-header injection otherwise
// poisons discovery and `iss`).
describe('[ODUDU-ISSUER-03] a configured public base is the issuer, whatever the request says', () => {
  async function configured(
    base: string | undefined,
    options: { trustProxy: boolean },
    headers: Record<string, string>,
  ): Promise<{ base: string; tenantIssuer: string }> {
    const app = Fastify(options);
    configureIssuerBase(app, base);
    app.get('/probe', (request) => ({
      base: issuerBaseFor(request),
      tenantIssuer: tenantIssuerFor(request, 'acme'),
    }));
    try {
      const res = await app.inject({ url: '/probe', headers });
      return res.json<{ base: string; tenantIssuer: string }>();
    } finally {
      await app.close();
    }
  }

  it('ignores a forged Host header', async () => {
    const { base, tenantIssuer } = await configured(
      'https://id.example.com',
      { trustProxy: false },
      { host: 'evil.example' },
    );
    expect(base).toBe('https://id.example.com');
    expect(tenantIssuer).toBe('https://id.example.com/tenants/acme');
  });

  it('ignores forwarded headers from a trusted proxy, and a Host that dropped the port', async () => {
    const { base } = await configured(
      'https://id.example.com:8443',
      { trustProxy: true },
      { host: 'id.example.com', 'x-forwarded-host': 'other.example', 'x-forwarded-proto': 'http' },
    );
    expect(base).toBe('https://id.example.com:8443');
  });

  it('spells the base the way a request would: lower case, no default port', async () => {
    const { base } = await configured('HTTPS://ID.Example.com:443', { trustProxy: false }, {});
    expect(base).toBe('https://id.example.com');
  });

  it('reads the request as before when no base is configured', async () => {
    const { base } = await configured(
      undefined,
      { trustProxy: false },
      { host: 'idp.example:8443' },
    );
    expect(base).toBe('http://idp.example:8443');
  });
});

describe('configureTenantAddress', () => {
  async function addressAt(url: string, later?: boolean): Promise<unknown> {
    const app = Fastify();
    configureIssuerBase(app, 'https://id.example.com');
    configureTenantAddress(app);
    if (later === true) {
      app.addHook('onRequest', (request, _reply, done) => {
        request.tenantAddress = { origin: 'https://acme.example', prefix: '' };
        done();
      });
    }
    app.get('/tenants/:tenant/x', (request) => ({ address: request.tenantAddress ?? null }));
    app.get('/elsewhere', (request) => ({ address: request.tenantAddress ?? null }));
    try {
      return (await app.inject({ url })).json<{ address: unknown }>().address;
    } finally {
      await app.close();
    }
  }

  it("is the path address of the route's tenant, on the issuer base", async () => {
    expect(await addressAt('/tenants/acme/x')).toEqual(
      pathAddress('https://id.example.com', 'acme'),
    );
  });

  it('is undefined off a tenant route', async () => {
    expect(await addressAt('/elsewhere')).toBeNull();
  });

  it('is what a hook registered after it sets', async () => {
    expect(await addressAt('/tenants/acme/x', true)).toEqual({
      origin: 'https://acme.example',
      prefix: '',
    });
  });
});

describe('a request served at a tenant`s own domain', () => {
  const base = {
    protocol: 'http' as const,
    host: 'internal:3000',
    configuredIssuerBase: 'https://id.example',
  };

  it('states the domain as the issuer, never the configured base', () => {
    const tenantAddress = domainAddress('login.acme.com', true);
    expect(tenantIssuerFor({ ...base, tenantAddress }, 'acme')).toBe('https://login.acme.com');
  });

  it('answers the domain whatever tenant name the caller passes', () => {
    const tenantAddress = domainAddress('login.acme.com', true);
    expect(tenantIssuerFor({ ...base, tenantAddress }, 'other')).toBe('https://login.acme.com');
  });

  it('keeps the path address for a request at the path', () => {
    const tenantAddress = pathAddress('https://id.example', 'acme');
    expect(tenantIssuerFor({ ...base, tenantAddress }, 'acme')).toBe(
      'https://id.example/tenants/acme',
    );
    expect(tenantIssuerFor(base, 'other')).toBe('https://id.example/tenants/other');
  });
});
