import type { MintAgentTokenInput } from '@odudu/protocol-oidc';
import { AgentTokenRefused } from '@odudu/protocol-oidc';
import { describe, expect, it } from 'vitest';
import type { McpCallDeps } from '#/service/deps';
import { newRequestScope } from '#/service/request-scope';
import { ToolProblem } from '#/service/tool';
import { unverifiedTokenForTests } from '#/testing/token';
import { exchangeForAdmin } from '#/usecase/exchange';

const NOW = new Date('2026-11-06T12:00:00Z');

interface Minted {
  readonly calls: MintAgentTokenInput[];
}

function depsWith(
  request = newRequestScope('r1', '127.0.0.1'),
  mint?: () => Promise<{ accessToken: string; expiresAt: Date }>,
): McpCallDeps & Minted {
  const calls: MintAgentTokenInput[] = [];
  let n = 0;
  return {
    calls,
    request,
    now: () => NOW,
    adminAudience: 'urn:odudu:admin',
    logger: { debug: () => undefined, error: () => undefined },
    inject: () => Promise.reject(new Error('not used')),
    mintAgentToken: (_token, input) => {
      calls.push(input);
      n += 1;
      return (
        mint?.() ??
        Promise.resolve({
          accessToken: `bearer-${String(n)}`,
          expiresAt: new Date(NOW.getTime() + 300_000),
        })
      );
    },
  };
}

describe('exchanging an MCP token for an admin bearer', () => {
  it("mints in-process for the owner grant, as the token's client, bounded by its exp", async () => {
    const deps = depsWith();
    const token = unverifiedTokenForTests({ scope: ['mcp:read', 'mcp:write'] });
    const bearer = await exchangeForAdmin(deps, token, ['mcp:read']);
    expect(bearer.bearer).toBe('bearer-1');
    expect(deps.calls).toEqual([
      {
        subjectGrantId: token.grantId,
        expectedSubjectId: token.subjectId,
        agentClientId: token.clientId,
        audience: 'urn:odudu:admin',
        scope: ['mcp:read'],
        notAfter: token.expiresAt,
        now: NOW,
      },
    ]);
  });

  it('refuses a scope the presented token does not hold, without minting', async () => {
    const deps = depsWith();
    await expect(
      exchangeForAdmin(deps, unverifiedTokenForTests({ scope: ['mcp:read'] }), ['mcp:write']),
    ).rejects.toMatchObject({ problemType: 'mcp:insufficient_scope', status: 403 });
    expect(deps.calls).toEqual([]);
  });

  it('refuses any scope that is not an MCP scope, without minting', async () => {
    const deps = depsWith();
    await expect(
      exchangeForAdmin(deps, unverifiedTokenForTests({ scope: ['mcp:read', 'openid'] }), [
        'openid',
      ]),
    ).rejects.toBeInstanceOf(ToolProblem);
    expect(deps.calls).toEqual([]);
  });

  it('reuses the bearer for one request, per scope', async () => {
    const deps = depsWith();
    const token = unverifiedTokenForTests({ scope: ['mcp:read', 'mcp:write'] });
    const a = await exchangeForAdmin(deps, token, ['mcp:read']);
    const b = await exchangeForAdmin(deps, token, ['mcp:read']);
    const w = await exchangeForAdmin(deps, token, ['mcp:write']);
    expect(b).toBe(a);
    expect(w.bearer).not.toBe(a.bearer);
    expect(deps.calls).toHaveLength(2);
  });

  it('shares nothing between two requests', async () => {
    const one = depsWith(newRequestScope('r1', '1.1.1.1'));
    const two = depsWith(newRequestScope('r2', '2.2.2.2'));
    const other = unverifiedTokenForTests({
      grantId: '0194f0a0-0000-7000-8000-0000000000ff',
      clientId: 'other',
    });
    const [a, b] = await Promise.all([
      exchangeForAdmin(one, unverifiedTokenForTests(), ['mcp:read']),
      exchangeForAdmin(two, other, ['mcp:read']),
    ]);
    expect(a.bearer).toBe('bearer-1');
    expect(b.bearer).toBe('bearer-1');
    expect(one.calls[0]?.subjectGrantId).toBe(unverifiedTokenForTests().grantId);
    expect(two.calls[0]?.subjectGrantId).toBe(other.grantId);
    expect(one.request.bearers).not.toBe(two.request.bearers);
  });

  it('does not reuse a bearer that has expired within the request', async () => {
    let at = NOW;
    const deps = { ...depsWith(), now: () => at };
    await exchangeForAdmin(deps, unverifiedTokenForTests(), ['mcp:read']);
    at = new Date(NOW.getTime() + 301_000);
    await exchangeForAdmin(
      deps,
      unverifiedTokenForTests({ expSeconds: Math.floor((at.getTime() + 60_000) / 1000) }),
      ['mcp:read'],
    );
    expect(deps.calls).toHaveLength(2);
  });

  it('answers a refusal as a problem that names neither the reason nor a token', async () => {
    const deps = depsWith(newRequestScope('r', 'ip'), () =>
      Promise.reject(new AgentTokenRefused('grant_revoked')),
    );
    const error = await exchangeForAdmin(deps, unverifiedTokenForTests(), ['mcp:read']).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ToolProblem);
    expect(error).toMatchObject({ problemType: 'mcp:access_ended', status: 401 });
    expect(JSON.stringify(error)).not.toContain('grant_revoked');
    expect((error as Error).message).not.toContain('grant_revoked');
  });

  it('lets an unexpected failure through rather than calling it a refusal', async () => {
    const deps = depsWith(newRequestScope('r', 'ip'), () => Promise.reject(new Error('db down')));
    await expect(exchangeForAdmin(deps, unverifiedTokenForTests(), ['mcp:read'])).rejects.toThrow(
      'db down',
    );
  });
});
