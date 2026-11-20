import { StrictMode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigate } from '#/adapter/location';
import type * as Location from '#/adapter/location';
import { PENDING_KEY } from '#/adapter/pending-storage';
import { startFakeIssuer, type FakeIssuer } from '#/testing/fake-issuer';
import { providerFor } from '#/testing/wrapper';
import { useAccessToken } from '#/use-cases/use-access-token';
import { useAuth } from '#/use-cases/use-auth';
import { useUser } from '#/use-cases/use-user';
import type { BrowserMode } from '#/types';

vi.mock('#/adapter/location', async (importOriginal) => ({
  ...(await importOriginal<typeof Location>()),
  navigate: vi.fn(),
}));

let fake: FakeIssuer;
let mode: BrowserMode;

beforeAll(async () => {
  fake = await startFakeIssuer();
  mode = {
    kind: 'browser',
    issuer: fake.issuer,
    clientId: 'app',
    redirectUri: `${location.origin}/callback`,
    scope: 'openid offline_access',
    postLogoutRedirectUri: `${location.origin}/`,
    allowInsecureRequests: true,
  };
});

afterAll(async () => {
  await fake.close();
});

beforeEach(() => {
  fake.tokenRequests.length = 0;
  fake.expiresIn = 900;
  fake.claims = {};
});

afterEach(() => {
  vi.mocked(navigate).mockClear();
});

function lastNavigation(): URL {
  const target = vi.mocked(navigate).mock.calls.at(-1)?.[0];
  if (target === undefined) throw new Error('nothing navigated');
  return new URL(target);
}

// Signs in as the app would, then comes back as the issuer's redirect does.
async function comeBackSignedIn(): Promise<void> {
  const first = renderHook(() => useAuth(), { wrapper: providerFor(mode) });
  await waitFor(() => {
    expect(first.result.current.status).toBe('signedOut');
  });
  first.result.current.signIn();
  await waitFor(() => {
    expect(navigate).toHaveBeenCalled();
  });
  first.unmount();
  const authorize = lastNavigation();
  fake.claims = { nonce: authorize.searchParams.get('nonce') };
  const state = authorize.searchParams.get('state') ?? '';
  history.replaceState(
    null,
    '',
    `/callback?code=code-1&state=${state}&iss=${encodeURIComponent(fake.issuer)}`,
  );
}

describe('browser mode', () => {
  it('signIn calls beginSignIn with prompt=create when asked', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: providerFor(mode) });
    await waitFor(() => {
      expect(result.current.status).toBe('signedOut');
    });
    result.current.signIn({ prompt: 'create' });
    await waitFor(() => {
      expect(navigate).toHaveBeenCalled();
    });
    const target = lastNavigation();
    expect(target.pathname).toBe('/tenants/demo/authorize');
    expect(target.searchParams.get('prompt')).toBe('create');
    expect(target.searchParams.get('client_id')).toBe('app');
    expect(target.searchParams.get('code_challenge_method')).toBe('S256');
    expect(sessionStorage.getItem(PENDING_KEY)).not.toBeNull();
  });

  it('keeps tokens in memory only (nothing in storage)', async () => {
    await comeBackSignedIn();
    const { result } = renderHook(() => ({ auth: useAuth(), user: useUser() }), {
      wrapper: providerFor(mode),
    });
    await waitFor(() => {
      expect(result.current.auth.status).toBe('signedIn');
    });
    expect(result.current.user?.sub).toBe('subject-1');
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
    expect(document.cookie).toBe('');
    expect(fake.tokenRequests).toHaveLength(1);
  });

  it('completes a callback once under strict mode', async () => {
    await comeBackSignedIn();
    const Wrapper = providerFor(mode);
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => (
        <StrictMode>
          <Wrapper>{children}</Wrapper>
        </StrictMode>
      ),
    });
    await waitFor(() => {
      expect(result.current.status).toBe('signedIn');
    });
    expect(fake.tokenRequests).toHaveLength(1);
  });

  it('removes the callback params from the URL after sign-in', async () => {
    await comeBackSignedIn();
    const { result } = renderHook(() => useAuth(), { wrapper: providerFor(mode) });
    await waitFor(() => {
      expect(result.current.status).toBe('signedIn');
    });
    expect(location.pathname + location.search).toBe('/callback');
  });

  it('ends signedOut without throwing on an error callback', async () => {
    const first = renderHook(() => useAuth(), { wrapper: providerFor(mode) });
    await waitFor(() => {
      expect(first.result.current.status).toBe('signedOut');
    });
    first.result.current.signIn();
    await waitFor(() => {
      expect(navigate).toHaveBeenCalled();
    });
    first.unmount();
    const state = lastNavigation().searchParams.get('state') ?? '';
    history.replaceState(
      null,
      '',
      `/callback?error=access_denied&state=${state}&iss=${encodeURIComponent(fake.issuer)}`,
    );
    const { result } = renderHook(() => useAuth(), { wrapper: providerFor(mode) });
    await waitFor(() => {
      expect(result.current.status).toBe('signedOut');
    });
    expect(result.current.error).toMatchObject({ code: 'access_denied' });
    expect(location.search).toBe('');
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
    expect(fake.tokenRequests).toHaveLength(0);
  });

  it("useAccessToken refreshes through the core's single flight", async () => {
    fake.expiresIn = 5;
    await comeBackSignedIn();
    const { result } = renderHook(() => ({ auth: useAuth(), token: useAccessToken() }), {
      wrapper: providerFor(mode),
    });
    await waitFor(() => {
      expect(result.current.auth.status).toBe('signedIn');
    });
    const tokens = await Promise.all([result.current.token(), result.current.token()]);
    expect(tokens).toEqual(['access-token-2', 'access-token-2']);
    const refreshes = fake.tokenRequests.filter(
      (form) => form.get('grant_type') === 'refresh_token',
    );
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0]?.get('refresh_token')).toBe('refresh-token-1');
  });

  it('hands out the held token while it is fresh', async () => {
    await comeBackSignedIn();
    const { result } = renderHook(() => ({ auth: useAuth(), token: useAccessToken() }), {
      wrapper: providerFor(mode),
    });
    await waitFor(() => {
      expect(result.current.auth.status).toBe('signedIn');
    });
    expect(await result.current.token()).toBe('access-token-1');
    expect(fake.tokenRequests).toHaveLength(1);
  });

  it('tells the app to sign in again for an audience the sign-in did not carry', async () => {
    await comeBackSignedIn();
    const { result } = renderHook(
      () => ({ auth: useAuth(), token: useAccessToken('https://api.example') }),
      { wrapper: providerFor(mode) },
    );
    await waitFor(() => {
      expect(result.current.auth.status).toBe('signedIn');
    });
    const failure: unknown = await result.current.token().catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'audience_not_granted' });
    expect((failure as Error).message).toContain('signIn({ resource');
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('signOut sends the person to the issuer and forgets the tokens', async () => {
    await comeBackSignedIn();
    vi.mocked(navigate).mockClear();
    const { result } = renderHook(() => ({ auth: useAuth(), token: useAccessToken() }), {
      wrapper: providerFor(mode),
    });
    await waitFor(() => {
      expect(result.current.auth.status).toBe('signedIn');
    });
    result.current.auth.signOut();
    await waitFor(() => {
      expect(navigate).toHaveBeenCalled();
    });
    const target = lastNavigation();
    expect(target.pathname).toBe('/tenants/demo/logout');
    expect(target.searchParams.get('id_token_hint')).not.toBeNull();
    await waitFor(() => {
      expect(result.current.auth.status).toBe('signedOut');
    });
    await expect(result.current.token()).rejects.toMatchObject({ code: 'login_required' });
  });
});
