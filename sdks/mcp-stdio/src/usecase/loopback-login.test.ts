import { describe, expect, it } from 'vitest';
import type { LoopbackListener } from '#/service/ports';
import { loopbackLogin, type LoopbackLoginDeps } from '#/usecase/loopback-login';
import { StdioError } from '#/service/stdio-error';
import type { TokenSet } from '#/service/token-set';

const ISSUER = 'https://id.example.com/tenants/acme';
const server = {
  issuer: ISSUER,
  authorizationEndpoint: `${ISSUER}/protocol/openid-connect/auth`,
  tokenEndpoint: `${ISSUER}/protocol/openid-connect/token`,
  issuerAdvertised: true,
};
const TOKENS: TokenSet = {
  accessToken: 'at',
  expiresAt: new Date('2026-11-06T10:05:00Z'),
  refreshToken: 'rt',
  scope: ['mcp:read'],
};

interface Rig {
  readonly deps: LoopbackLoginDeps;
  readonly opened: string[];
  readonly said: string[];
  readonly redeemed: { code: string; verifier: string; redirectUri: string; resource: string }[];
  readonly closed: { count: number };
  readonly listened: { count: number };
}

function rig(
  callback: (state: string) => Promise<URLSearchParams>,
  over: { opens?: boolean; discover?: () => Promise<typeof server> } = {},
): Rig {
  const opened: string[] = [];
  const said: string[] = [];
  const redeemed: Rig['redeemed'] = [];
  const closed = { count: 0 };
  const listened = { count: 0 };
  let counter = 0;
  const deps: LoopbackLoginDeps = {
    oauth: {
      discover: over.discover ?? (() => Promise.resolve(server)),
      redeemCode: (_server, input) => {
        redeemed.push(input);
        return Promise.resolve(TOKENS);
      },
    },
    listen: () => {
      listened.count += 1;
      const listener: LoopbackListener = {
        redirectUri: 'http://127.0.0.1:5555/',
        get callback() {
          const state =
            new URL(opened[opened.length - 1] ?? 'http://x/').searchParams.get('state') ?? '';
          return callback(state);
        },
        close: () => {
          closed.count += 1;
          return Promise.resolve();
        },
      };
      return Promise.resolve(listener);
    },
    openBrowser: (url) => {
      opened.push(url);
      return Promise.resolve(over.opens ?? true);
    },
    entropy: (bytes) => Uint8Array.from({ length: bytes }, () => (counter += 1) % 251),
    say: (line) => said.push(line),
    clientId: 'odudu-mcp',
    resource: 'urn:odudu:params:admin-api',
    scope: 'mcp:read',
  };
  return { deps, opened, said, redeemed, closed, listened };
}

const answer = (state: string, extra = '') =>
  new URLSearchParams(`code=CODE-1&state=${state}&iss=${encodeURIComponent(ISSUER)}${extra}`);

describe('the loopback sign-in', () => {
  it('sends the browser to /authorize with PKCE, state and resource, then redeems the code', async () => {
    const r = rig((state) => Promise.resolve(answer(state)));
    expect(await loopbackLogin(r.deps)).toBe(TOKENS);
    const url = new URL(r.opened[0] ?? '');
    expect(url.origin + url.pathname).toBe(server.authorizationEndpoint);
    expect(url.searchParams.get('client_id')).toBe('odudu-mcp');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5555/');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('resource')).toBe('urn:odudu:params:admin-api');
    expect(url.searchParams.get('scope')).toBe('mcp:read');
    expect(url.searchParams.get('state')?.length).toBeGreaterThanOrEqual(32);
    expect(r.redeemed).toHaveLength(1);
    expect(r.redeemed[0]).toMatchObject({
      code: 'CODE-1',
      redirectUri: 'http://127.0.0.1:5555/',
      resource: 'urn:odudu:params:admin-api',
    });
    expect(r.redeemed[0]?.verifier).toMatch(/^[A-Za-z0-9\-._~]{43}$/u);
    expect(r.closed.count).toBe(1);
  });

  it('requests mcp:write alone when that is what the run asked for', async () => {
    const r = rig((state) => Promise.resolve(answer(state)));
    await loopbackLogin({ ...r.deps, scope: 'mcp:write' });
    expect(new URL(r.opened[0] ?? '').searchParams.get('scope')).toBe('mcp:write');
  });

  it('never redeems a response from another issuer, and never prints what it said', async () => {
    const r = rig((state) =>
      Promise.resolve(
        new URLSearchParams(
          `code=EVIL&state=${state}&iss=https%3A%2F%2Fevil.example&error=access_denied&error_description=LEAK-TEXT`,
        ),
      ),
    );
    const error = await loopbackLogin(r.deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StdioError);
    expect(r.redeemed).toEqual([]);
    expect(r.closed.count).toBe(1);
    expect(`${(error as Error).message}\n${r.said.join('\n')}`).not.toMatch(
      /LEAK-TEXT|EVIL|evil\.example/u,
    );
  });

  it('never redeems a response that lacks the issuer the server promised', async () => {
    const r = rig((state) => Promise.resolve(new URLSearchParams(`code=C&state=${state}`)));
    await expect(loopbackLogin(r.deps)).rejects.toThrow(/issuer/u);
    expect(r.redeemed).toEqual([]);
  });

  it('never redeems a response whose state is not the one sent', async () => {
    const r = rig(() => Promise.resolve(answer('someone-elses')));
    await expect(loopbackLogin(r.deps)).rejects.toThrow(/state/u);
    expect(r.redeemed).toEqual([]);
  });

  it('reports a refusal by the person as one line with its registered code', async () => {
    const r = rig((state) =>
      Promise.resolve(
        new URLSearchParams(
          `error=access_denied&error_description=LEAK&state=${state}&iss=${encodeURIComponent(ISSUER)}`,
        ),
      ),
    );
    const error = await loopbackLogin(r.deps).catch((e: unknown) => e);
    expect((error as Error).message).toContain('access_denied');
    expect((error as Error).message).not.toContain('LEAK');
    expect(r.redeemed).toEqual([]);
  });

  it('prints the address to the error stream when the browser would not open', async () => {
    const r = rig((state) => Promise.resolve(answer(state)), { opens: false });
    await loopbackLogin(r.deps);
    expect(r.said.some((line) => line.includes(r.opened[0] ?? 'missing'))).toBe(true);
  });

  it('does not print the address when the browser opened, and never prints the verifier or the code', async () => {
    const r = rig((state) => Promise.resolve(answer(state)));
    await loopbackLogin(r.deps);
    const said = r.said.join('\n');
    expect(said).not.toContain('http');
    expect(said).not.toContain('CODE-1');
    expect(said).not.toContain(r.redeemed[0]?.verifier ?? 'missing');
  });

  it('closes the listener and redeems nothing when the wait times out', async () => {
    const r = rig(() => Promise.reject(new StdioError('mcp_login_timeout', 'timed out')));
    await expect(loopbackLogin(r.deps)).rejects.toMatchObject({ code: 'mcp_login_timeout' });
    expect(r.closed.count).toBe(1);
    expect(r.redeemed).toEqual([]);
  });

  it('opens no listener when discovery is refused', async () => {
    const r = rig((state) => Promise.resolve(answer(state)), {
      discover: () => Promise.reject(new StdioError('mcp_discovery_invalid', 'no')),
    });
    await expect(loopbackLogin(r.deps)).rejects.toThrow('no');
    expect(r.listened.count).toBe(0);
  });

  it('uses a new verifier and a new state for each sign-in', async () => {
    const a = rig((state) => Promise.resolve(answer(state)));
    const b = rig((state) => Promise.resolve(answer(state)));
    await loopbackLogin(a.deps);
    await loopbackLogin(b.deps);
    // Both rigs draw the same counter sequence from zero, so draw twice on one.
    const c = rig((state) => Promise.resolve(answer(state)));
    await loopbackLogin(c.deps);
    await loopbackLogin(c.deps);
    expect(c.redeemed[0]?.verifier).not.toBe(c.redeemed[1]?.verifier);
    expect(new URL(c.opened[0] ?? '').searchParams.get('state')).not.toBe(
      new URL(c.opened[1] ?? '').searchParams.get('state'),
    );
  });
});
