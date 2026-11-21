import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigate } from '#/adapter/location';
import type * as Location from '#/adapter/location';
import { fakeBff, type FakeBff } from '#/testing/fake-bff';
import { providerFor } from '#/testing/wrapper';
import { useAccessToken } from '#/use-cases/use-access-token';
import { useAuth } from '#/use-cases/use-auth';
import { useBffFetch } from '#/use-cases/use-bff-fetch';
import { useUser } from '#/use-cases/use-user';
import { OduduError } from '@odudu-io/oidc';

vi.mock('#/adapter/location', async (importOriginal) => ({
  ...(await importOriginal<typeof Location>()),
  navigate: vi.fn(),
}));

const mode = { kind: 'bff', baseUrl: '/bff' } as const;
let bff: FakeBff;

beforeEach(() => {
  bff = fakeBff('/bff');
  vi.stubGlobal('fetch', bff.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(navigate).mockClear();
});

describe('bff mode', () => {
  it('reads /session and never holds a token', async () => {
    const { result } = renderHook(() => ({ auth: useAuth(), user: useUser() }), {
      wrapper: providerFor(mode),
    });
    expect(result.current.auth.status).toBe('loading');
    await waitFor(() => {
      expect(result.current.auth.status).toBe('signedIn');
    });
    expect(result.current.user?.sub).toBe('subject-1');
    expect(bff.calls).toHaveLength(1);
    expect(bff.calls[0]).toMatchObject({ method: 'GET', url: 'http://localhost:3000/bff/session' });
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
    expect(document.cookie).toBe('');
  });

  it('sends X-Odudu-BFF on session and logout', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: providerFor(mode) });
    await waitFor(() => {
      expect(result.current.status).toBe('signedIn');
    });
    result.current.signOut();
    await waitFor(() => {
      expect(bff.calls).toHaveLength(2);
    });
    expect(bff.calls.map((call) => [call.method, call.header, call.credentials])).toEqual([
      ['GET', '1', 'same-origin'],
      ['POST', '1', 'same-origin'],
    ]);
  });

  it('signOut posts logout and navigates to redirectTo', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: providerFor(mode) });
    await waitFor(() => {
      expect(result.current.status).toBe('signedIn');
    });
    result.current.signOut();
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('https://issuer.example/logout?client_id=app');
    });
  });

  it('ends signedOut without navigating when logout answers 204', async () => {
    bff.logoutRedirect = undefined;
    const { result } = renderHook(() => useAuth(), { wrapper: providerFor(mode) });
    await waitFor(() => {
      expect(result.current.status).toBe('signedIn');
    });
    result.current.signOut();
    await waitFor(() => {
      expect(result.current.status).toBe('signedOut');
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('is signedOut when /session answers 401', async () => {
    bff.authenticated = false;
    const { result } = renderHook(() => ({ auth: useAuth(), user: useUser() }), {
      wrapper: providerFor(mode),
    });
    await waitFor(() => {
      expect(result.current.auth.status).toBe('signedOut');
    });
    expect(result.current.user).toBeUndefined();
  });

  it('a 401 from the BFF flips to signedOut', async () => {
    const { result } = renderHook(() => ({ auth: useAuth(), call: useBffFetch() }), {
      wrapper: providerFor(mode),
    });
    await waitFor(() => {
      expect(result.current.auth.status).toBe('signedIn');
    });
    const ok = await result.current.call('api/items');
    expect(ok.status).toBe(200);
    expect(bff.calls.at(-1)).toMatchObject({
      url: 'http://localhost:3000/bff/proxy/api/items',
      header: '1',
      credentials: 'same-origin',
    });
    bff.authenticated = false;
    const refused = await result.current.call('/api/items');
    expect(refused.status).toBe(401);
    await waitFor(() => {
      expect(result.current.auth.status).toBe('signedOut');
    });
  });

  it('a 401 the API itself answers does not sign the UI out', async () => {
    const { result } = renderHook(() => ({ auth: useAuth(), call: useBffFetch() }), {
      wrapper: providerFor(mode),
    });
    await waitFor(() => {
      expect(result.current.auth.status).toBe('signedIn');
    });
    bff.upstreamStatus = 401;
    const refused = await result.current.call('api/items');
    expect(refused.status).toBe(401);
    expect(refused.headers.has('x-odudu-session')).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.auth.status).toBe('signedIn');
  });

  it('signIn navigates to /login and refuses options the BFF cannot carry', async () => {
    bff.authenticated = false;
    const { result } = renderHook(() => useAuth(), { wrapper: providerFor(mode) });
    await waitFor(() => {
      expect(result.current.status).toBe('signedOut');
    });
    result.current.signIn();
    expect(navigate).toHaveBeenCalledWith('/bff/login');
    expect(() => {
      result.current.signIn({ prompt: 'create' });
    }).toThrow(OduduError);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('useAccessToken in bff mode throws a typed error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let caught: unknown;
    try {
      renderHook(() => useAccessToken(), { wrapper: providerFor(mode) });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OduduError);
    expect(caught).toMatchObject({ code: 'invalid_options' });
    expect((caught as OduduError).message).toContain('useBffFetch');
  });

  it('refuses a logout address that is not http(s) and says so without echoing it', async () => {
    bff.logoutRedirect = 'javascript:alert(1)';
    const { result } = renderHook(() => useAuth(), { wrapper: providerFor(mode) });
    await waitFor(() => {
      expect(result.current.status).toBe('signedIn');
    });
    result.current.signOut();
    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(OduduError);
    });
    expect(navigate).not.toHaveBeenCalled();
    expect(result.current.error?.message).not.toContain('javascript');
  });

  it('a 503 from /session is signedOut with an error that names the status only', async () => {
    bff.sessionStatus = 503;
    const { result } = renderHook(() => useAuth(), { wrapper: providerFor(mode) });
    await waitFor(() => {
      expect(result.current.status).toBe('signedOut');
    });
    expect(result.current.error).toMatchObject({ code: 'request_failed' });
    expect(result.current.error?.message).toContain('503');
    expect(result.current.error?.message).not.toContain('upstream detail');
  });

  it('a network failure on /session is signedOut with an error', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
    const { result } = renderHook(() => useAuth(), { wrapper: providerFor(mode) });
    await waitFor(() => {
      expect(result.current.status).toBe('signedOut');
    });
    expect(result.current.error).toMatchObject({ code: 'request_failed' });
  });
});
