import { type ClientRecord } from '@odudu/domain-tenant';
import { describe, expect, it, vi } from 'vitest';
import { type PersistCimdOutcome } from '#/usecase/persist-cimd-client';
import { refreshCimdClient, resolveAuthorizeClient } from '#/usecase/resolve-cimd-client';

const URL_A = 'https://app.example.com/client.json';
const NOW = new Date('2026-11-05T12:00:00.000Z');
const DOCUMENT = {
  client_id: URL_A,
  client_name: 'Example',
  redirect_uris: ['https://app.example.com/cb'],
};

function refreshDeps(overrides: {
  resolved?: Awaited<ReturnType<Parameters<typeof refreshCimdClient>[2]['resolveDocument']>>;
  persisted?: PersistCimdOutcome;
}) {
  const persist = vi.fn().mockResolvedValue(overrides.persisted ?? 'ok');
  const warn = vi.fn();
  return {
    persist,
    warn,
    deps: {
      resolveDocument: vi
        .fn()
        .mockResolvedValue(overrides.resolved ?? { kind: 'ok', body: DOCUMENT }),
      persist,
      now: () => NOW,
      warn,
    },
  };
}

describe('refreshCimdClient', () => {
  it('persists the validated document and says the client is usable', async () => {
    const { deps, persist } = refreshDeps({});
    expect(await refreshCimdClient('t1', URL_A, deps)).toBe(true);
    expect(persist).toHaveBeenCalledWith('t1', expect.objectContaining({ clientId: URL_A }), NOW);
  });

  it('is not usable when the document could not be resolved, and says why', async () => {
    const { deps, persist, warn } = refreshDeps({
      resolved: { kind: 'refused', reason: 'timeout' },
    });
    expect(await refreshCimdClient('t1', URL_A, deps)).toBe(false);
    expect(persist).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('client metadata document refused', {
      tenantId: 't1',
      host: 'app.example.com',
      reason: 'timeout',
    });
  });

  it.each(['at_capacity', 'foreign', 'refused'] as const)(
    'is not usable when persisting says %s',
    async (persisted) => {
      const { deps } = refreshDeps({ persisted });
      expect(await refreshCimdClient('t1', URL_A, deps)).toBe(false);
    },
  );

  it('says so, without the document, when the ceiling could not be made room under', async () => {
    const { deps, warn } = refreshDeps({ persisted: 'at_capacity' });
    expect(await refreshCimdClient('t1', URL_A, deps)).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      'client metadata ceiling reached, no client could be evicted',
      {
        tenantId: 't1',
        host: 'app.example.com',
        reason: 'at_capacity',
      },
    );
  });

  it('is not usable when the resolved body no longer validates', async () => {
    const { deps, persist } = refreshDeps({ resolved: { kind: 'ok', body: { client_id: 'x' } } });
    expect(await refreshCimdClient('t1', URL_A, deps)).toBe(false);
    expect(persist).not.toHaveBeenCalled();
  });
});

function record(origin: ClientRecord['registrationOrigin']): { client: ClientRecord | null } {
  return { client: { registrationOrigin: origin } as ClientRecord };
}
const NONE = { client: null };

function authorizeDeps(held: { client: ClientRecord | null }[], refresh?: boolean) {
  const resolveClient = vi.fn();
  for (const answer of held) resolveClient.mockResolvedValueOnce(answer);
  const refreshCimdClient = vi.fn().mockResolvedValue(refresh ?? true);
  return {
    resolveClient,
    refreshCimdClient,
    deps: { resolveClient, refreshCimdClient, empty: NONE },
  };
}

describe('resolveAuthorizeClient', () => {
  const on = { id: 't1', cimdEnabled: true };
  const off = { id: 't1', cimdEnabled: false };

  it('leaves an id that is not a URL to the ordinary lookup', async () => {
    const { deps, refreshCimdClient } = authorizeDeps([record('seeded')]);
    expect(await resolveAuthorizeClient(deps, on, 'billing-app')).toEqual(record('seeded'));
    expect(refreshCimdClient).not.toHaveBeenCalled();
  });

  it('serves a pre-registered client named by a URL whatever the setting says', async () => {
    const { deps, refreshCimdClient } = authorizeDeps([record('operator')]);
    expect(await resolveAuthorizeClient(deps, off, URL_A)).toEqual(record('operator'));
    expect(refreshCimdClient).not.toHaveBeenCalled();
  });

  it('answers an unknown URL id as no client while the setting is off', async () => {
    const { deps, refreshCimdClient } = authorizeDeps([NONE]);
    expect(await resolveAuthorizeClient(deps, off, URL_A)).toBe(NONE);
    expect(refreshCimdClient).not.toHaveBeenCalled();
  });

  it('answers a stored cimd client as no client while the setting is off', async () => {
    const { deps, refreshCimdClient } = authorizeDeps([record('cimd')]);
    expect(await resolveAuthorizeClient(deps, off, URL_A)).toBe(NONE);
    expect(refreshCimdClient).not.toHaveBeenCalled();
  });

  it('refreshes from the document and reads the client again while the setting is on', async () => {
    const { deps, refreshCimdClient, resolveClient } = authorizeDeps([NONE, record('cimd')]);
    expect(await resolveAuthorizeClient(deps, on, URL_A)).toEqual(record('cimd'));
    expect(refreshCimdClient).toHaveBeenCalledWith('t1', URL_A);
    expect(resolveClient).toHaveBeenCalledTimes(2);
  });

  it('answers no client when the document cannot be refreshed, even with a stored row', async () => {
    const { deps } = authorizeDeps([record('cimd')], false);
    expect(await resolveAuthorizeClient(deps, on, URL_A)).toBe(NONE);
  });

  it('answers no client when no fetcher is wired', async () => {
    const { deps } = authorizeDeps([NONE]);
    const unwired = { resolveClient: deps.resolveClient, empty: NONE };
    expect(await resolveAuthorizeClient(unwired, on, URL_A)).toBe(NONE);
  });
});
